var fs = require('fs');
var path = require('path');
var mysql = require('mysql2/promise');

var databaseName = process.env.DB_NAME || 'quanlychitieu';
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('DB_NAME chỉ được chứa chữ cái, số và dấu gạch dưới');
}

var connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'mysql',
  charset: 'utf8mb4',
  dateStrings: true
};
var pool;
var initialization;

async function initialize() {
  if (initialization) return initialization;

  initialization = (async function() {
    var bootstrapConnection = await mysql.createConnection(connectionOptions);
    try {
      await bootstrapConnection.query(
        'CREATE DATABASE IF NOT EXISTS `' + databaseName + '` ' +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } finally {
      await bootstrapConnection.end();
    }

    pool = mysql.createPool(Object.assign({}, connectionOptions, {
      database: databaseName,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
      queueLimit: 0,
      multipleStatements: true
    }));

    var schema = await fs.promises.readFile(
      path.join(__dirname, '..', 'database', 'schema.sql'),
      'utf8'
    );
    await pool.query(schema);
  })().catch(function(error) {
    initialization = null;
    throw error;
  });

  return initialization;
}

function mapExpense(row) {
  return {
    id: row.id,
    branch: row.branch,
    route: row.route,
    category: row.category,
    spentBy: row.spentBy,
    amount: Number(row.amount),
    date: row.date,
    note: row.note || '',
    receipts: [],
    createdAt: row.createdAt
  };
}

async function read() {
  await initialize();
  var results = await Promise.all([
    pool.query(
      'SELECT id, branch, route, category, spent_by AS spentBy, amount, ' +
      'DATE_FORMAT(expense_date, "%Y-%m-%d") AS date, note, ' +
      'DATE_FORMAT(created_at, "%Y-%m-%dT%H:%i:%s.%fZ") AS createdAt ' +
      'FROM expenses ORDER BY expense_date DESC, created_at DESC'
    ),
    pool.query(
      'SELECT expense_id AS expenseId, original_name AS name, mime_type AS type, file_url AS url ' +
      'FROM receipts ORDER BY id ASC'
    ),
    pool.query('SELECT budget_month AS month, hn_amount AS HN, hcm_amount AS HCM FROM budgets')
  ]);

  var expenses = results[0][0].map(mapExpense);
  var expenseMap = new Map(expenses.map(function(expense) {
    return [expense.id, expense];
  }));
  results[1][0].forEach(function(receipt) {
    var expense = expenseMap.get(receipt.expenseId);
    if (expense) {
      expense.receipts.push({
        name: receipt.name,
        type: receipt.type,
        url: receipt.url
      });
    }
  });

  var budgets = {};
  results[2][0].forEach(function(budget) {
    budgets[budget.month] = {
      HN: Number(budget.HN),
      HCM: Number(budget.HCM)
    };
  });

  return { budgets: budgets, expenses: expenses };
}

async function setBudget(month, budget) {
  await initialize();
  await pool.execute(
    'INSERT INTO budgets (budget_month, hn_amount, hcm_amount) VALUES (?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE hn_amount = VALUES(hn_amount), hcm_amount = VALUES(hcm_amount)',
    [month, budget.HN, budget.HCM]
  );
  return budget;
}

async function createExpense(expense) {
  await initialize();
  var connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      'INSERT INTO expenses ' +
      '(id, branch, route, category, spent_by, amount, expense_date, note, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        expense.id,
        expense.branch,
        expense.route,
        expense.category,
        expense.spentBy,
        expense.amount,
        expense.date,
        expense.note,
        expense.createdAt.replace('T', ' ').replace('Z', '')
      ]
    );

    for (var i = 0; i < expense.receipts.length; i += 1) {
      var receipt = expense.receipts[i];
      await connection.execute(
        'INSERT INTO receipts (expense_id, original_name, mime_type, file_url) VALUES (?, ?, ?, ?)',
        [expense.id, receipt.name, receipt.type, receipt.url]
      );
    }
    await connection.commit();
    return expense;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteExpense(id) {
  await initialize();
  var connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    var expenseRows = await connection.execute('SELECT id FROM expenses WHERE id = ? FOR UPDATE', [id]);
    if (!expenseRows[0].length) {
      await connection.rollback();
      return null;
    }

    var receiptRows = await connection.execute(
      'SELECT original_name AS name, mime_type AS type, file_url AS url FROM receipts WHERE expense_id = ?',
      [id]
    );
    await connection.execute('DELETE FROM expenses WHERE id = ?', [id]);
    await connection.commit();
    return { id: id, receipts: receiptRows[0] };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function health() {
  await initialize();
  await pool.query('SELECT 1');
  return { database: databaseName };
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    initialization = null;
  }
}

module.exports = {
  initialize: initialize,
  read: read,
  setBudget: setBudget,
  createExpense: createExpense,
  deleteExpense: deleteExpense,
  health: health,
  close: close
};
