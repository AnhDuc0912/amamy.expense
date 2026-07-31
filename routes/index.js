var express = require('express');
var router = express.Router();

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
  res.render('pages/amamy_mvp_doanh_thu', {
    title: 'Amamy - Doanh thu',
    navDoanhThuChiTiet: true
  });
});

module.exports = router;
