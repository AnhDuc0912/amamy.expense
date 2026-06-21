var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amamy-expense-test-'));
process.env.UPLOAD_DIR = path.join(temporaryDirectory, 'uploads');
process.env.BUDGET_PASSWORD = 'test-password';
process.env.MONGODB_DB = 'quanlychitieu_test_' + process.pid;

var app = require('../app');
var store = require('../services/store');
var server;
var baseUrl;

test.before(async function() {
  await new Promise(function(resolve) {
    server = app.listen(0, '127.0.0.1', function() {
      baseUrl = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
  });
});

test.after(async function() {
  await new Promise(function(resolve) {
    server.close(resolve);
  });
  await store.dropDatabase();
  await store.close();
  await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
});

async function jsonRequest(url, options) {
  var response = await fetch(baseUrl + url, options);
  var body = response.status === 204 ? null : await response.json();
  return { response: response, body: body };
}

test('health endpoint responds', async function() {
  var result = await jsonRequest('/api/health');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'ok');
  assert.equal(result.body.database, process.env.MONGODB_DB);
});

test('budget endpoint checks password and persists monthly budget', async function() {
  var denied = await jsonRequest('/api/budgets/2026-06', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ HN: 1000000, HCM: 2000000, password: 'wrong' })
  });
  assert.equal(denied.response.status, 403);

  var saved = await jsonRequest('/api/budgets/2026-06', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ HN: 1000000, HCM: 2000000, password: 'test-password' })
  });
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body.budget, { HN: 1000000, HCM: 2000000 });
});

test('expense lifecycle updates summary and removes receipt file', async function() {
  var invalid = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Nhật',
      category: 'Phí COD',
      spentBy: 'Kế toán',
      amount: 45000,
      date: '2026-02-31'
    })
  });
  assert.equal(invalid.response.status, 400);

  var created = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Nhật',
      category: 'Phí COD',
      spentBy: 'Kế toán',
      amount: 45000,
      date: '2026-06-21',
      note: 'Kiểm thử API',
      receipts: [{
        name: 'receipt.png',
        type: 'image/png',
        data: 'data:image/png;base64,iVBORw0KGgo='
      }]
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.expense.receipts.length, 1);

  var receiptUrl = created.body.expense.receipts[0].url;
  var receiptResponse = await fetch(baseUrl + receiptUrl);
  assert.equal(receiptResponse.status, 200);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  assert.equal(bootstrap.body.expenses.length, 1);
  assert.equal(bootstrap.body.summary.spent.HN, 45000);
  assert.equal(bootstrap.body.summary.balance.HN, 955000);

  var deleted = await fetch(baseUrl + '/api/expenses/' + created.body.expense.id, {
    method: 'DELETE'
  });
  assert.equal(deleted.status, 204);

  var missingReceipt = await fetch(baseUrl + receiptUrl);
  assert.equal(missingReceipt.status, 404);
});
