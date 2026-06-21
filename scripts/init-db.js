require('dotenv').config({ quiet: true });

var store = require('../services/store');

store.initialize()
  .then(function() {
    console.log('Đã khởi tạo MySQL database và các bảng thành công.');
    return store.close();
  })
  .catch(function(error) {
    console.error('Không thể khởi tạo MySQL:', error.message);
    process.exitCode = 1;
  });
