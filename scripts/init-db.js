require('dotenv').config({ quiet: true });

var store = require('../services/store');

store.initialize()
  .then(function() {
    console.log('Đã kết nối MongoDB Atlas và khởi tạo indexes thành công.');
    return store.close();
  })
  .catch(function(error) {
    console.error('Không thể khởi tạo MongoDB:', error.message);
    process.exitCode = 1;
  });
