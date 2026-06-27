var express = require('express');
var crypto = require('crypto');
var options = require('../config/options');
var store = require('../services/store');

var router = express.Router();
var allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf'
];
var maxReceiptSize = 5 * 1024 * 1024;

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseAmount(value) {
  var amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function monthOf(date) {
  return String(date || '').slice(0, 7);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  var parts = value.split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2];
}

function publicExpense(expense) {
  return {
    id: expense.id,
    branch: expense.branch,
    route: expense.route,
    category: expense.category,
    spentBy: expense.spentBy,
    amount: expense.amount,
    date: expense.date,
    note: expense.note,
    receipts: expense.receipts || [],
    createdAt: expense.createdAt
  };
}

function validPassword(value) {
  return String(value || '') === String(process.env.BUDGET_PASSWORD || '280836');
}

function summarize(data, month) {
  var monthlyExpenses = data.expenses.filter(function(expense) {
    return monthOf(expense.date) === month;
  });
  var budget = data.budgets[month] || { HN: 0, HCM: 0 };
  var spent = {};
  var reports = { branch: {}, route: {}, category: {}, person: {} };

  options.branches.forEach(function(branch) {
    spent[branch] = 0;
  });

  monthlyExpenses.forEach(function(expense) {
    spent[expense.branch] = (spent[expense.branch] || 0) + expense.amount;
    reports.branch[expense.branch] = (reports.branch[expense.branch] || 0) + expense.amount;
    reports.route[expense.route] = (reports.route[expense.route] || 0) + expense.amount;
    reports.category[expense.category] = (reports.category[expense.category] || 0) + expense.amount;
    reports.person[expense.spentBy] = (reports.person[expense.spentBy] || 0) + expense.amount;
  });

  return {
    month: month,
    budget: budget,
    spent: spent,
    balance: {
      HN: budget.HN - spent.HN,
      HCM: budget.HCM - spent.HCM
    },
    totalSpent: Object.keys(spent).reduce(function(total, branch) {
      return total + spent[branch];
    }, 0),
    totalBudget: budget.HN + budget.HCM,
    missingReceipts: data.expenses.filter(function(expense) {
      return !expense.receipts || expense.receipts.length === 0;
    }).length,
    reports: reports
  };
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function prepareReceipts(receipts) {
  if (!Array.isArray(receipts)) return [];
  if (receipts.length > 2) throw new Error('Chỉ được tải lên tối đa 2 chứng từ');
  return receipts.map(function(receipt) {
    receipt = receipt || {};
    if (allowedMimeTypes.indexOf(receipt.type) === -1) {
      throw new Error('Chứng từ phải là ảnh JPG, PNG, GIF, WEBP hoặc PDF');
    }
    var match = String(receipt.data || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match || match[1] !== receipt.type) throw new Error('Dữ liệu chứng từ không hợp lệ');

    var buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > maxReceiptSize) {
      throw new Error('Mỗi chứng từ phải có dung lượng từ 1 byte đến 5 MB');
    }
    return {
      id: crypto.randomBytes(16).toString('hex'),
      name: cleanText(receipt.name, 160) || 'chung-tu',
      type: receipt.type,
      size: buffer.length,
      data: buffer
    };
  });
}

router.get('/bootstrap', async function(req, res, next) {
  try {
    var month = validMonth(req.query.month) ? req.query.month : currentMonth();
    var data = await store.read();
    res.json({
      options: options,
      expenses: data.expenses.map(publicExpense),
      auditLogs: data.auditLogs || [],
      summary: summarize(data, month)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/health', async function(req, res, next) {
  try {
    var health = await store.health();
    res.json({
      status: 'ok',
      database: health.database,
      time: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/receipts/:id', async function(req, res, next) {
  try {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) {
      return sendError(res, 400, 'Mã chứng từ không hợp lệ');
    }
    var receipt = await store.getReceipt(req.params.id);
    if (!receipt) return sendError(res, 404, 'Không tìm thấy chứng từ');

    var content = receipt.data && receipt.data.buffer
      ? Buffer.from(receipt.data.buffer)
      : Buffer.from(receipt.data || []);
    res.set('Content-Type', receipt.type);
    res.set('Content-Length', String(content.length));
    res.set('Content-Disposition', 'inline; filename="' + encodeURIComponent(receipt.name) + '"');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(content);
  } catch (error) {
    next(error);
  }
});

router.put('/budgets/:month', async function(req, res, next) {
  try {
    if (!validMonth(req.params.month)) return sendError(res, 400, 'Tháng không hợp lệ');
    if (!validPassword(req.body.password)) {
      return sendError(res, 403, 'Sai mật khẩu điều chỉnh ngân sách');
    }

    var hn = Number(req.body.HN);
    var hcm = Number(req.body.HCM);
    if (!Number.isSafeInteger(hn) || hn < 0 || !Number.isSafeInteger(hcm) || hcm < 0) {
      return sendError(res, 400, 'Ngân sách phải là số nguyên không âm');
    }

    var budget = await store.setBudget(req.params.month, { HN: hn, HCM: hcm });
    res.json({ budget: budget });
  } catch (error) {
    next(error);
  }
});

router.post('/expenses', async function(req, res, next) {
  var receipts = [];
  try {
    var body = req.body || {};
    var amount = parseAmount(body.amount);
    if (options.branches.indexOf(body.branch) === -1) return sendError(res, 400, 'Chi nhánh không hợp lệ');
    if (options.routes.indexOf(body.route) === -1) return sendError(res, 400, 'Chiều vận chuyển không hợp lệ');
    if (options.categories.indexOf(body.category) === -1) return sendError(res, 400, 'Danh mục không hợp lệ');
    if (options.people.indexOf(body.spentBy) === -1) return sendError(res, 400, 'Người chi không hợp lệ');
    if (!amount) return sendError(res, 400, 'Số tiền phải là số nguyên lớn hơn 0');
    if (!validDate(body.date)) {
      return sendError(res, 400, 'Ngày chi không hợp lệ');
    }

    receipts = prepareReceipts(body.receipts);
    var expense = {
      id: crypto.randomBytes(12).toString('hex'),
      branch: body.branch,
      route: body.route,
      category: body.category,
      spentBy: body.spentBy,
      amount: amount,
      date: body.date,
      note: cleanText(body.note, 1000),
      receipts: receipts,
      createdAt: new Date().toISOString()
    };

    await store.createExpense(expense);
    res.status(201).json({ expense: publicExpense(expense) });
  } catch (error) {
    if (error.message && error.message.toLocaleLowerCase('vi').indexOf('chứng từ') !== -1) {
      return sendError(res, 400, error.message);
    }
    next(error);
  }
});

router.post('/expenses/:id/receipts', async function(req, res, next) {
  try {
    var receipts = prepareReceipts(req.body.receipts);
    if (!receipts.length) return sendError(res, 400, 'Vui lòng chọn ít nhất một chứng từ');

    var added = await store.addReceipts(req.params.id, receipts);
    if (!added) return sendError(res, 404, 'Không tìm thấy khoản chi');
    res.status(201).json({ receipts: added });
  } catch (error) {
    if (error.code === 'RECEIPT_LIMIT' ||
        (error.message && error.message.toLocaleLowerCase('vi').indexOf('chứng từ') !== -1)) {
      return sendError(res, 400, error.message);
    }
    next(error);
  }
});

router.patch('/expenses/:id/amount', async function(req, res, next) {
  try {
    var body = req.body || {};
    if (!validPassword(body.password)) {
      return sendError(res, 403, 'Sai mật khẩu chỉnh sửa khoản chi');
    }

    var actor = cleanText(body.actor, 100);
    if (!actor) return sendError(res, 400, 'Vui lòng nhập người chỉnh sửa');

    var amount = parseAmount(body.amount);
    if (!amount) return sendError(res, 400, 'Số tiền phải là số nguyên lớn hơn 0');

    var updated = await store.updateExpenseAmount(req.params.id, amount);
    if (!updated) return sendError(res, 404, 'Không tìm thấy khoản chi');

    await store.createAuditLog({
      id: crypto.randomBytes(12).toString('hex'),
      action: 'update_amount',
      actor: actor,
      expenseId: req.params.id,
      before: updated.before,
      after: updated.after,
      createdAt: new Date().toISOString()
    });

    res.json({ expense: publicExpense(updated.after) });
  } catch (error) {
    next(error);
  }
});

router.delete('/expenses/:expenseId/receipts/:receiptId', async function(req, res, next) {
  try {
    if (!/^[a-f0-9]{32}$/.test(req.params.receiptId)) {
      return sendError(res, 400, 'Mã chứng từ không hợp lệ');
    }
    var deleted = await store.deleteReceipt(req.params.expenseId, req.params.receiptId);
    if (!deleted) return sendError(res, 404, 'Không tìm thấy chứng từ');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.delete('/expenses/:id', async function(req, res, next) {
  try {
    var body = req.body || {};
    if (!validPassword(body.password)) {
      return sendError(res, 403, 'Sai mật khẩu xóa khoản chi');
    }

    var actor = cleanText(body.actor, 100);
    if (!actor) return sendError(res, 400, 'Vui lòng nhập người xóa');

    var deleted = await store.deleteExpense(req.params.id);

    if (!deleted) return sendError(res, 404, 'Không tìm thấy khoản chi');

    await store.createAuditLog({
      id: crypto.randomBytes(12).toString('hex'),
      action: 'delete_expense',
      actor: actor,
      expenseId: req.params.id,
      before: deleted,
      after: null,
      createdAt: new Date().toISOString()
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/expenses.csv', async function(req, res, next) {
  try {
    var data = await store.read();
    var rows = [
      ['Ngày', 'Chi nhánh', 'Chiều vận chuyển', 'Danh mục', 'Ai chi', 'Số tiền', 'Ghi chú', 'Số chứng từ']
    ];
    data.expenses.forEach(function(expense) {
      rows.push([
        expense.date,
        expense.branch,
        expense.route,
        expense.category,
        expense.spentBy,
        expense.amount,
        expense.note,
        (expense.receipts || []).length
      ]);
    });
    var csv = rows.map(function(row) {
      return row.map(function(cell) {
        return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="amamy-chi-tieu.csv"');
    res.send('\ufeff' + csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
