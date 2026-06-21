var MongoClient = require('mongodb').MongoClient;

var mongoUri = process.env.MONGODB_URI;
var databaseName = process.env.MONGODB_DB || 'quanlychitieu';
var client;
var database;
var initialization;

if (!mongoUri) {
  throw new Error('Thiếu biến môi trường MONGODB_URI');
}

if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
  throw new Error('MONGODB_DB chỉ được chứa chữ cái, số, gạch ngang và gạch dưới');
}

async function initialize() {
  if (initialization) return initialization;

  initialization = (async function() {
    client = new MongoClient(mongoUri, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 10000)
    });
    await client.connect();
    database = client.db(databaseName);
    await database.command({ ping: 1 });

    await Promise.all([
      database.collection('budgets').createIndex({ month: 1 }, { unique: true }),
      database.collection('expenses').createIndex({ id: 1 }, { unique: true }),
      database.collection('expenses').createIndex({ date: -1, createdAt: -1 }),
      database.collection('expenses').createIndex({ branch: 1, date: -1 }),
      database.collection('expenses').createIndex({ route: 1 }),
      database.collection('expenses').createIndex({ category: 1 }),
      database.collection('expenses').createIndex({ spentBy: 1 }),
      database.collection('receipts').createIndex({ id: 1 }, { unique: true }),
      database.collection('receipts').createIndex({ expenseId: 1 })
    ]);
  })().catch(async function(error) {
    initialization = null;
    if (client) await client.close().catch(function() {});
    client = null;
    database = null;
    throw error;
  });

  return initialization;
}

function publicExpense(document) {
  return {
    id: document.id,
    branch: document.branch,
    route: document.route,
    category: document.category,
    spentBy: document.spentBy,
    amount: Number(document.amount),
    date: document.date,
    note: document.note || '',
    receipts: document.receipts || [],
    createdAt: document.createdAt instanceof Date
      ? document.createdAt.toISOString()
      : document.createdAt
  };
}

async function read() {
  await initialize();
  var results = await Promise.all([
    database.collection('expenses')
      .find({}, { projection: { _id: 0 } })
      .sort({ date: -1, createdAt: -1 })
      .toArray(),
    database.collection('budgets')
      .find({}, { projection: { _id: 0 } })
      .toArray()
  ]);

  var budgets = {};
  results[1].forEach(function(budget) {
    budgets[budget.month] = {
      HN: Number(budget.HN),
      HCM: Number(budget.HCM)
    };
  });

  return {
    budgets: budgets,
    expenses: results[0].map(publicExpense)
  };
}

async function setBudget(month, budget) {
  await initialize();
  await database.collection('budgets').updateOne(
    { month: month },
    {
      $set: { HN: budget.HN, HCM: budget.HCM, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return budget;
}

async function createExpense(expense) {
  await initialize();
  var receiptDocuments = expense.receipts.map(function(receipt) {
    return {
      id: receipt.id,
      expenseId: expense.id,
      name: receipt.name,
      type: receipt.type,
      size: receipt.size,
      data: receipt.data,
      createdAt: new Date()
    };
  });
  var receiptMetadata = expense.receipts.map(function(receipt) {
    return {
      id: receipt.id,
      name: receipt.name,
      type: receipt.type,
      size: receipt.size,
      url: '/api/receipts/' + receipt.id
    };
  });

  try {
    if (receiptDocuments.length) {
      await database.collection('receipts').insertMany(receiptDocuments);
    }
    await database.collection('expenses').insertOne({
      id: expense.id,
      branch: expense.branch,
      route: expense.route,
      category: expense.category,
      spentBy: expense.spentBy,
      amount: expense.amount,
      date: expense.date,
      note: expense.note,
      receipts: receiptMetadata,
      createdAt: new Date(expense.createdAt)
    });
    expense.receipts = receiptMetadata;
    return expense;
  } catch (error) {
    if (receiptDocuments.length) {
      await database.collection('receipts').deleteMany({ expenseId: expense.id }).catch(function() {});
    }
    throw error;
  }
}

async function addReceipts(expenseId, receipts) {
  await initialize();
  var expenses = database.collection('expenses');
  var currentExpense = await expenses.findOne(
    { id: expenseId },
    { projection: { _id: 0, receipts: 1 } }
  );
  if (!currentExpense) return null;

  var currentReceipts = currentExpense.receipts || [];
  if (currentReceipts.length + receipts.length > 2) {
    var limitError = new Error('Mỗi khoản chi chỉ được có tối đa 2 chứng từ');
    limitError.code = 'RECEIPT_LIMIT';
    throw limitError;
  }

  var receiptDocuments = receipts.map(function(receipt) {
    return {
      id: receipt.id,
      expenseId: expenseId,
      name: receipt.name,
      type: receipt.type,
      size: receipt.size,
      data: receipt.data,
      createdAt: new Date()
    };
  });
  var metadata = receipts.map(function(receipt) {
    return {
      id: receipt.id,
      name: receipt.name,
      type: receipt.type,
      size: receipt.size,
      url: '/api/receipts/' + receipt.id
    };
  });

  try {
    if (receiptDocuments.length) {
      await database.collection('receipts').insertMany(receiptDocuments);
    }
    var updated = await expenses.updateOne(
      {
        id: expenseId,
        $expr: {
          $lte: [
            { $size: { $ifNull: ['$receipts', []] } },
            2 - metadata.length
          ]
        }
      },
      { $push: { receipts: { $each: metadata } } }
    );
    if (!updated.modifiedCount) {
      await database.collection('receipts').deleteMany({
        id: { $in: metadata.map(function(receipt) { return receipt.id; }) }
      });
      var concurrentLimitError = new Error('Mỗi khoản chi chỉ được có tối đa 2 chứng từ');
      concurrentLimitError.code = 'RECEIPT_LIMIT';
      throw concurrentLimitError;
    }
    return metadata;
  } catch (error) {
    if (receiptDocuments.length) {
      await database.collection('receipts').deleteMany({
        id: { $in: receiptDocuments.map(function(receipt) { return receipt.id; }) }
      }).catch(function() {});
    }
    throw error;
  }
}

async function deleteReceipt(expenseId, receiptId) {
  await initialize();
  var expenses = database.collection('expenses');
  var expense = await expenses.findOne(
    { id: expenseId, 'receipts.id': receiptId },
    { projection: { _id: 0, receipts: 1 } }
  );
  if (!expense) return null;

  var receipt = (expense.receipts || []).find(function(item) {
    return item.id === receiptId;
  });
  var updated = await expenses.updateOne(
    { id: expenseId, 'receipts.id': receiptId },
    { $pull: { receipts: { id: receiptId } } }
  );
  if (!updated.modifiedCount) return null;

  try {
    await database.collection('receipts').deleteOne({
      id: receiptId,
      expenseId: expenseId
    });
  } catch (error) {
    await expenses.updateOne(
      { id: expenseId },
      { $push: { receipts: receipt } }
    ).catch(function() {});
    throw error;
  }
  return receipt;
}

async function deleteExpense(id) {
  await initialize();
  var deleted = await database.collection('expenses').findOneAndDelete({ id: id });
  if (!deleted) return null;
  await database.collection('receipts').deleteMany({ expenseId: id });
  return publicExpense(deleted);
}

async function getReceipt(id) {
  await initialize();
  return database.collection('receipts').findOne(
    { id: id },
    { projection: { _id: 0, name: 1, type: 1, size: 1, data: 1 } }
  );
}

async function health() {
  await initialize();
  await database.command({ ping: 1 });
  return { database: databaseName };
}

async function dropDatabase() {
  await initialize();
  await database.dropDatabase();
}

async function close() {
  if (client) await client.close();
  client = null;
  database = null;
  initialization = null;
}

module.exports = {
  initialize: initialize,
  read: read,
  setBudget: setBudget,
  createExpense: createExpense,
  addReceipts: addReceipts,
  deleteReceipt: deleteReceipt,
  deleteExpense: deleteExpense,
  getReceipt: getReceipt,
  health: health,
  dropDatabase: dropDatabase,
  close: close
};
