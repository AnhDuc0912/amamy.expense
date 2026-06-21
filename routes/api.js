var express = require('express');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var options = require('../config/options');
var store = require('../services/store');

var router = express.Router();
var uploadsDirectory = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
var allowedMimeTypes = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};
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

function summarize(data, month) {
  var monthlyExpenses = data.expenses.filter(function(expense) {
    return monthOf(expense.date) === month;
  });
  var budget = data.budgets[month] || { HN: 0, HCM: 0 };
  var spent = { HN: 0, HCM: 0 };
  var reports = { route: {}, category: {}, person: {} };

  monthlyExpenses.forEach(function(expense) {
    spent[expense.branch] += expense.amount;
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
    totalSpent: spent.HN + spent.HCM,
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

async function saveReceipts(receipts) {
  if (!Array.isArray(receipts)) return [];
  if (receipts.length > 2) throw new Error('Chỉ được tải lên tối đa 2 chứng từ');

  await fs.promises.mkdir(uploadsDirectory, { recursive: true });
  var saved = [];

  try {
    for (var i = 0; i < receipts.length; i += 1) {
      var receipt = receipts[i] || {};
      var extension = allowedMimeTypes[receipt.type];
      if (!extension) throw new Error('Chứng từ phải là ảnh JPG, PNG, GIF, WEBP hoặc PDF');

      var match = String(receipt.data || '').match(/^data:[^;]+;base64,(.+)$/);
      if (!match) throw new Error('Dữ liệu chứng từ không hợp lệ');

      var buffer = Buffer.from(match[1], 'base64');
      if (!buffer.length || buffer.length > maxReceiptSize) {
        throw new Error('Mỗi chứng từ phải có dung lượng từ 1 byte đến 5 MB');
      }

      var fileName = crypto.randomBytes(16).toString('hex') + extension;
      await fs.promises.writeFile(path.join(uploadsDirectory, fileName), buffer);
      saved.push({
        name: cleanText(receipt.name, 160) || ('chung-tu' + extension),
        type: receipt.type,
        url: '/uploads/' + fileName
      });
    }
  } catch (error) {
    await Promise.all(saved.map(function(receipt) {
      return fs.promises.unlink(path.join(uploadsDirectory, path.basename(receipt.url))).catch(function() {});
    }));
    throw error;
  }

  return saved;
}

async function deleteReceiptFiles(receipts) {
  await Promise.all((receipts || []).map(function(receipt) {
    var fileName = path.basename(receipt.url || '');
    if (!fileName) return Promise.resolve();
    return fs.promises.unlink(path.join(uploadsDirectory, fileName)).catch(function() {});
  }));
}

router.get('/bootstrap', async function(req, res, next) {
  try {
    var month = validMonth(req.query.month) ? req.query.month : currentMonth();
    var data = await store.read();
    res.json({
      options: options,
      expenses: data.expenses.map(publicExpense),
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

router.put('/budgets/:month', async function(req, res, next) {
  try {
    if (!validMonth(req.params.month)) return sendError(res, 400, 'Tháng không hợp lệ');
    if (String(req.body.password || '') !== String(process.env.BUDGET_PASSWORD || '280836')) {
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

    receipts = await saveReceipts(body.receipts);
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
    if (receipts.length) await deleteReceiptFiles(receipts);
    if (error.message && error.message.toLocaleLowerCase('vi').indexOf('chứng từ') !== -1) {
      return sendError(res, 400, error.message);
    }
    next(error);
  }
});

router.delete('/expenses/:id', async function(req, res, next) {
  try {
    var deleted = await store.deleteExpense(req.params.id);

    if (!deleted) return sendError(res, 404, 'Không tìm thấy khoản chi');
    await deleteReceiptFiles(deleted.receipts);
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
