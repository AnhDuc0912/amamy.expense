var express = require('express');
var router = express.Router();
var doanhThuAccess = require('../services/doanhThuAccess');

var DOANH_THU_COOKIE = 'doanhThuAccess';
var DOANH_THU_COOKIE_MAX_AGE = 12 * 60 * 60 * 1000;
var DOANH_THU_PROTECTED_PAGES = {
  '/doanh-thu': { title: 'Amamy - Doanh thu', navDoanhThuChiTiet: true, pageLabel: 'Doanh thu' },
  '/doanh-thu-gia-von': { title: 'Amamy - Báo cáo lãi gộp', navDoanhThu: true, pageLabel: 'Báo cáo lãi gộp' },
  '/bao-cao-hoat-dong-kinh-doanh': { title: 'Amamy - Báo cáo hoạt động kinh doanh', navBaoCao: true, pageLabel: 'Báo cáo hoạt động kinh doanh' }
};

function hasDoanhThuAccess(req) {
  return doanhThuAccess.isValid(req.cookies && req.cookies[DOANH_THU_COOKIE]);
}

function validDoanhThuPassword(value) {
  return String(value || '') === String(process.env.BUDGET_PASSWORD || '280836');
}

function safeDoanhThuRedirect(value) {
  return Object.prototype.hasOwnProperty.call(DOANH_THU_PROTECTED_PAGES, value) ? value : '/doanh-thu';
}

function renderDoanhThuLogin(req, res, redirectPath, error) {
  var meta = DOANH_THU_PROTECTED_PAGES[redirectPath];
  res.render('pages/doanh_thu_login', {
    title: meta.title,
    navDoanhThuChiTiet: meta.navDoanhThuChiTiet,
    navDoanhThu: meta.navDoanhThu,
    navBaoCao: meta.navBaoCao,
    pageLabel: meta.pageLabel,
    redirectPath: redirectPath,
    error: error
  });
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
    title: 'Amamy - Marketing',
    navNoiBo: true
  });
});

router.get('/chi-tieu-van-hanh', function(req, res) {
  res.render('pages/amamy_mvp_chi_tieu_van_hanh', {
    title: 'Amamy - Chi tiêu vận hành',
    navVanHanh: true
  });
});

router.get('/gia-von', function(req, res) {
  res.render('pages/amamy_mvp_gia_von', {
    title: 'Amamy - Giá vốn',
    navGiaVon: true
  });
});

router.get('/chi-phi-viettel-post', function(req, res) {
  res.render('pages/amamy_mvp_chi_phi_viettel_post', {
    title: 'Amamy - Chi phí Viettel Post',
    navChiPhiViettelPost: true
  });
});

router.get('/lich-lam-tu-van', function(req, res) {
  res.render('pages/mvp_xep_lich_tinh_luong', {
    title: 'Amamy - Lịch làm tư vấn',
    navLichTuVan: true
  });
});

router.get('/doanh-thu-gia-von', function(req, res) {
  if (!hasDoanhThuAccess(req)) {
    return renderDoanhThuLogin(req, res, '/doanh-thu-gia-von');
  }
  res.render('pages/amamy_mvp_doanh_thu_gia_von_ban_dep', {
    title: 'Amamy - Báo cáo lãi gộp',
    navDoanhThu: true
  });
});

router.get('/doanh-thu', function(req, res) {
  if (!hasDoanhThuAccess(req)) {
    return renderDoanhThuLogin(req, res, '/doanh-thu');
  }
  res.render('pages/amamy_mvp_doanh_thu', {
    title: 'Amamy - Doanh thu',
    navDoanhThuChiTiet: true
  });
});

router.get('/bao-cao-hoat-dong-kinh-doanh', function(req, res) {
  if (!hasDoanhThuAccess(req)) {
    return renderDoanhThuLogin(req, res, '/bao-cao-hoat-dong-kinh-doanh');
  }
  res.render('pages/amamy_mvp_bao_cao_hoat_dong_kinh_doanh', {
    title: 'Amamy - Báo cáo hoạt động kinh doanh',
    navBaoCao: true
  });
});

router.post('/doanh-thu/login', function(req, res) {
  var redirectPath = safeDoanhThuRedirect(req.body && req.body.redirect);
  if (!validDoanhThuPassword(req.body && req.body.password)) {
    return renderDoanhThuLogin(req, res, redirectPath, 'Sai mật khẩu, vui lòng thử lại.');
  }
  var token = doanhThuAccess.grant();
  res.cookie(DOANH_THU_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DOANH_THU_COOKIE_MAX_AGE
  });
  res.redirect(redirectPath);
});

router.get('/doanh-thu/logout', function(req, res) {
  var token = req.cookies && req.cookies[DOANH_THU_COOKIE];
  if (token) doanhThuAccess.revoke(token);
  res.clearCookie(DOANH_THU_COOKIE);
  res.redirect(safeDoanhThuRedirect(req.query && req.query.redirect));
});

module.exports = router;
