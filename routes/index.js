var express = require('express');
var router = express.Router();
var doanhThuAccess = require('../services/doanhThuAccess');

var DOANH_THU_COOKIE = 'doanhThuAccess';
var DOANH_THU_COOKIE_MAX_AGE = 12 * 60 * 60 * 1000;

function hasDoanhThuAccess(req) {
  return doanhThuAccess.isValid(req.cookies && req.cookies[DOANH_THU_COOKIE]);
}

function validDoanhThuPassword(value) {
  return String(value || '') === String(process.env.BUDGET_PASSWORD || '280836');
}

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Amamy - Quản lý chi tiêu',
    appScript: true,
    navDashboard: true
  });
});

router.get('/khieu-nai-den-bu', function(req, res) {
  res.render('pages/amamy_mvp_khieu_nai_den_bu_full_fixed', {
    title: 'Amamy - Khiếu nại & Đền bù',
    navKhieuNai: true
  });
});

router.get('/chi-tieu-noi-bo', function(req, res) {
  res.render('pages/amamy_mvp_chi_tieu_noi_bo_full_fixed_ads_chung', {
    title: 'Amamy - Chi tiêu nội bộ',
    navNoiBo: true
  });
});

router.get('/chi-tieu-van-hanh', function(req, res) {
  res.render('pages/amamy_mvp_chi_tieu_van_hanh', {
    title: 'Amamy - Chi tiêu vận hành',
    navVanHanh: true
  });
});

router.get('/doanh-thu-gia-von', function(req, res) {
  res.render('pages/amamy_mvp_doanh_thu_gia_von_ban_dep', {
    title: 'Amamy - Doanh thu và giá vốn',
    navDoanhThu: true
  });
});

router.get('/doanh-thu', function(req, res) {
  if (!hasDoanhThuAccess(req)) {
    return res.render('pages/doanh_thu_login', {
      title: 'Amamy - Doanh thu',
      navDoanhThuChiTiet: true
    });
  }
  res.render('pages/amamy_mvp_doanh_thu', {
    title: 'Amamy - Doanh thu',
    navDoanhThuChiTiet: true
  });
});

router.post('/doanh-thu/login', function(req, res) {
  if (!validDoanhThuPassword(req.body && req.body.password)) {
    return res.render('pages/doanh_thu_login', {
      title: 'Amamy - Doanh thu',
      navDoanhThuChiTiet: true,
      error: 'Sai mật khẩu, vui lòng thử lại.'
    });
  }
  var token = doanhThuAccess.grant();
  res.cookie(DOANH_THU_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DOANH_THU_COOKIE_MAX_AGE
  });
  res.redirect('/doanh-thu');
});

router.get('/doanh-thu/logout', function(req, res) {
  var token = req.cookies && req.cookies[DOANH_THU_COOKIE];
  if (token) doanhThuAccess.revoke(token);
  res.clearCookie(DOANH_THU_COOKIE);
  res.redirect('/doanh-thu');
});

module.exports = router;
