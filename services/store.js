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
      database.collection('expenses').createIndex({ spentBy: 1 })
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
  await database.collection('expenses').insertOne({
    id: expense.id,
    branch: expense.branch,
    route: expense.route,
    category: expense.category,
    spentBy: expense.spentBy,
    amount: expense.amount,
    date: expense.date,
    note: expense.note,
    receipts: expense.receipts,
    createdAt: new Date(expense.createdAt)
  });
  return expense;
}

async function deleteExpense(id) {
  await initialize();
  var deleted = await database.collection('expenses').findOneAndDelete({ id: id });
  return deleted ? publicExpense(deleted) : null;
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
  deleteExpense: deleteExpense,
  health: health,
  dropDatabase: dropDatabase,
  close: close
};
