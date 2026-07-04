var test = require('node:test');
var assert = require('node:assert/strict');
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

test('bootstrap exposes company payer options', async function() {
  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  assert.ok(bootstrap.body.options.branches.includes('Công ty chi trả'));
  assert.ok(bootstrap.body.options.people.includes('Tài khoản công ty'));
  assert.ok(bootstrap.body.options.paymentReceivers.includes('Trung Cao'));
  assert.ok(bootstrap.body.options.categories.includes('Phí COD (không thu vào hóa đơn KH)'));
  assert.ok(bootstrap.body.options.categories.includes('Phí COD (thu hóa đơn KH)'));
  assert.equal(bootstrap.body.options.categories.includes('Phí Shopee'), false);
  assert.deepEqual(bootstrap.body.options.materialCategories, [
    'Chi phí carton',
    'Chi phí băng keo',
    'Chi phí màng co',
    'Chi phí chống sốc',
    'Chi phí khác'
  ]);
});

test('store payment requires receipt and updates cash summary', async function() {
  var missingReceipt = await jsonRequest('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      receiver: 'Trung Cao',
      customerCode: 'KH001',
      amount: 5000000,
      date: '2026-06-24'
    })
  });
  assert.equal(missingReceipt.response.status, 400);

  var receiptContent = Buffer.from('payment-receipt');
  var payment = await jsonRequest('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      receiver: 'Nguyễn A',
      customerCode: 'KH001',
      amount: 5000000,
      date: '2026-06-24',
      note: 'Khách nạp tiền mặt',
      receipts: [{
        name: 'hoa-don.pdf',
        type: 'application/pdf',
        data: 'data:application/pdf;base64,' + receiptContent.toString('base64')
      }]
    })
  });
  assert.equal(payment.response.status, 201);
  assert.equal(payment.body.payment.receipts.length, 1);

  var expense = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      category: 'Phí khác',
      spentBy: 'Kế toán',
      amount: 3000000,
      date: '2026-06-25'
    })
  });
  assert.equal(expense.response.status, 201);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  var savedPayment = bootstrap.body.payments.find(function(item) {
    return item.id === payment.body.payment.id;
  });
  assert.equal(savedPayment.customerCode, 'KH001');
  assert.equal(bootstrap.body.summary.cash.received.HN, 5000000);
  assert.equal(bootstrap.body.summary.cash.spent.HN, 3000000);
  assert.equal(bootstrap.body.summary.cash.balance.HN, 2000000);
  assert.equal(bootstrap.body.summary.cash.totalBalance, 2000000);

  await fetch(baseUrl + '/api/expenses/' + expense.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
});

test('COD expense categories enforce reason or customer invoice proof', async function() {
  var withoutReason = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      category: 'Phí COD (không thu vào hóa đơn KH)',
      spentBy: 'Kế toán',
      amount: 40000,
      date: '2026-06-26'
    })
  });
  assert.equal(withoutReason.response.status, 400);

  var noInvoiceCod = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      category: 'Phí COD (không thu vào hóa đơn KH)',
      spentBy: 'Kế toán',
      amount: 40000,
      date: '2026-06-26',
      codReason: 'Khách không bị thu khoản COD này'
    })
  });
  assert.equal(noInvoiceCod.response.status, 201);
  assert.equal(noInvoiceCod.body.expense.codReason, 'Khách không bị thu khoản COD này');

  var withoutProof = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HCM',
      route: 'Việt Mỹ',
      category: 'Phí COD (thu hóa đơn KH)',
      spentBy: 'Kế toán',
      amount: 50000,
      date: '2026-06-26',
      customerCode: 'KH-COD'
    })
  });
  assert.equal(withoutProof.response.status, 400);

  var withInvoiceCod = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HCM',
      route: 'Việt Mỹ',
      category: 'Phí COD (thu hóa đơn KH)',
      spentBy: 'Kế toán',
      amount: 50000,
      date: '2026-06-26',
      customerCode: 'KH-COD',
      receipts: [{
        name: 'cod-invoice.png',
        type: 'image/png',
        data: 'data:image/png;base64,' + Buffer.from('cod-invoice').toString('base64')
      }]
    })
  });
  assert.equal(withInvoiceCod.response.status, 201);
  assert.equal(withInvoiceCod.body.expense.customerCode, 'KH-COD');
  assert.equal(withInvoiceCod.body.expense.receipts.length, 1);

  await fetch(baseUrl + '/api/expenses/' + noInvoiceCod.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
  await fetch(baseUrl + '/api/expenses/' + withInvoiceCod.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
});

test('material route only accepts material expense categories', async function() {
  var regularCategory = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Vật liệu',
      category: 'Phí khác',
      spentBy: 'Kế toán',
      amount: 60000,
      date: '2026-06-27'
    })
  });
  assert.equal(regularCategory.response.status, 400);

  var materialCategory = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Vật liệu',
      category: 'Chi phí carton',
      spentBy: 'Kế toán',
      amount: 60000,
      date: '2026-06-27'
    })
  });
  assert.equal(materialCategory.response.status, 201);
  assert.equal(materialCategory.body.expense.category, 'Chi phí carton');

  var materialOnRegularRoute = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Mỹ',
      category: 'Chi phí carton',
      spentBy: 'Kế toán',
      amount: 60000,
      date: '2026-06-27'
    })
  });
  assert.equal(materialOnRegularRoute.response.status, 400);

  await fetch(baseUrl + '/api/expenses/' + materialCategory.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
});

test('expense lifecycle updates summary and removes receipt file', async function() {
  var receiptContent = Buffer.alloc(300 * 1024, 7);
  var invalid = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Nhật',
      category: 'Phí khác',
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
      category: 'Phí khác',
      spentBy: 'Kế toán',
      amount: 45000,
      date: '2026-06-21',
      note: 'Kiểm thử API',
      receipts: [{
        name: 'receipt.png',
        type: 'image/png',
        data: 'data:image/png;base64,' + receiptContent.toString('base64')
      }]
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.expense.receipts.length, 1);

  var receiptUrl = created.body.expense.receipts[0].url;
  var receiptResponse = await fetch(baseUrl + receiptUrl);
  assert.equal(receiptResponse.status, 200);
  assert.equal(receiptResponse.headers.get('content-type'), 'image/png');
  assert.equal((await receiptResponse.arrayBuffer()).byteLength, receiptContent.length);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  assert.equal(bootstrap.body.expenses.length, 1);
  assert.equal(bootstrap.body.summary.spent.HN, 45000);
  assert.equal(bootstrap.body.summary.balance.HN, 955000);

  var addedReceipt = await jsonRequest('/api/expenses/' + created.body.expense.id + '/receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      receipts: [{
        name: 'receipt-2.pdf',
        type: 'application/pdf',
        data: 'data:application/pdf;base64,' + Buffer.from('%PDF-test').toString('base64')
      }]
    })
  });
  assert.equal(addedReceipt.response.status, 201);
  assert.equal(addedReceipt.body.receipts.length, 1);

  var addedReceiptResponse = await fetch(baseUrl + addedReceipt.body.receipts[0].url);
  assert.equal(addedReceiptResponse.status, 200);
  assert.equal(addedReceiptResponse.headers.get('content-type'), 'application/pdf');

  var removedReceipt = await fetch(
    baseUrl + '/api/expenses/' + created.body.expense.id +
    '/receipts/' + created.body.expense.receipts[0].id,
    { method: 'DELETE' }
  );
  assert.equal(removedReceipt.status, 204);
  var removedReceiptResponse = await fetch(baseUrl + receiptUrl);
  assert.equal(removedReceiptResponse.status, 404);

  var replacementReceipt = await jsonRequest('/api/expenses/' + created.body.expense.id + '/receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      receipts: [{
        name: 'replacement.png',
        type: 'image/png',
        data: 'data:image/png;base64,' + Buffer.from('replacement').toString('base64')
      }]
    })
  });
  assert.equal(replacementReceipt.response.status, 201);

  var deleted = await fetch(baseUrl + '/api/expenses/' + created.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
  assert.equal(deleted.status, 204);

  var missingAddedReceipt = await fetch(baseUrl + addedReceipt.body.receipts[0].url);
  assert.equal(missingAddedReceipt.status, 404);
  var missingReplacementReceipt = await fetch(baseUrl + replacementReceipt.body.receipts[0].url);
  assert.equal(missingReplacementReceipt.status, 404);
});

test('amount updates require password and are written to audit history', async function() {
  var created = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HCM',
      route: 'Việt Đức',
      category: 'Phí khác',
      spentBy: 'Trung Cao',
      amount: 85000,
      date: '2026-06-23'
    })
  });
  assert.equal(created.response.status, 201);

  var denied = await jsonRequest('/api/expenses/' + created.body.expense.id + '/amount', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'wrong', amount: 95000 })
  });
  assert.equal(denied.response.status, 403);

  var updated = await jsonRequest('/api/expenses/' + created.body.expense.id + '/amount', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password', amount: 95000 })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.expense.amount, 95000);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  assert.equal(bootstrap.body.summary.spent.HCM, 95000);
  var updateLog = bootstrap.body.auditLogs.find(function(log) {
    return log.action === 'update_amount' && log.expenseId === created.body.expense.id;
  });
  assert.equal(updateLog.actor, 'Tester');
  assert.equal(updateLog.before.amount, 85000);
  assert.equal(updateLog.after.amount, 95000);

  var deleted = await fetch(baseUrl + '/api/expenses/' + created.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
  assert.equal(deleted.status, 204);
});

test('company-paid expense is included in branch and total summaries', async function() {
  var created = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'Công ty chi trả',
      route: 'Nhật Việt',
      category: 'Phí khác',
      spentBy: 'Tài khoản công ty',
      amount: 123000,
      date: '2026-06-22',
      note: 'Công ty chi hộ'
    })
  });
  assert.equal(created.response.status, 201);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06');
  assert.equal(bootstrap.body.summary.spent['Công ty chi trả'], 123000);
  assert.equal(bootstrap.body.summary.reports.branch['Công ty chi trả'], 123000);
  assert.equal(bootstrap.body.summary.reports.person['Tài khoản công ty'], 123000);
  assert.equal(bootstrap.body.summary.totalSpent, 123000);

  var deniedDelete = await fetch(baseUrl + '/api/expenses/' + created.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'wrong' })
  });
  assert.equal(deniedDelete.status, 403);

  var deleted = await fetch(baseUrl + '/api/expenses/' + created.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
  assert.equal(deleted.status, 204);

  var bootstrapAfterDelete = await jsonRequest('/api/bootstrap?month=2026-06');
  var deleteLog = bootstrapAfterDelete.body.auditLogs.find(function(log) {
    return log.action === 'delete_expense' && log.expenseId === created.body.expense.id;
  });
  assert.equal(deleteLog.actor, 'Tester');
  assert.equal(deleteLog.before.amount, 123000);
});

test('bootstrap and CSV respect date range filters', async function() {
  var early = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Nhật',
      category: 'Phí khác',
      spentBy: 'Kế toán',
      amount: 11000,
      date: '2026-06-05',
      note: 'Ngoài khoảng lọc'
    })
  });
  assert.equal(early.response.status, 201);

  var inRange = await jsonRequest('/api/expenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      branch: 'HN',
      route: 'Việt Nhật',
      category: 'Phí khác',
      spentBy: 'Kế toán',
      amount: 22000,
      date: '2026-06-15',
      note: 'Trong khoảng lọc'
    })
  });
  assert.equal(inRange.response.status, 201);

  var bootstrap = await jsonRequest('/api/bootstrap?month=2026-06&dateFrom=2026-06-10&dateTo=2026-06-20');
  assert.equal(bootstrap.body.summary.spent.HN, 22000);
  assert.equal(bootstrap.body.summary.totalSpent, 22000);
  assert.equal(bootstrap.body.summary.missingReceipts, 1);

  var csvResponse = await fetch(
    baseUrl + '/api/expenses.csv?month=2026-06&dateFrom=2026-06-10&dateTo=2026-06-20'
  );
  var csv = await csvResponse.text();
  assert.equal(csvResponse.status, 200);
  assert.match(csv, /Trong khoảng lọc/);
  assert.doesNotMatch(csv, /Ngoài khoảng lọc/);

  var rangeOverridesMonth = await jsonRequest('/api/bootstrap?month=2026-07&dateFrom=2026-06-10&dateTo=2026-06-20');
  assert.equal(rangeOverridesMonth.body.summary.spent.HN, 22000);

  await fetch(baseUrl + '/api/expenses/' + early.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
  await fetch(baseUrl + '/api/expenses/' + inRange.body.expense.id, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'Tester', password: 'test-password' })
  });
});
