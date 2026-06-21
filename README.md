# Amamy - Quản lý chi tiêu

Ứng dụng Express + MySQL quản lý ngân sách và khoản chi cho hai chi nhánh HN/HCM.

## Chạy dự án

```bash
npm install
npm run db:init
npm start
```

Mở `http://localhost:3000`.

MySQL mặc định chạy tại `127.0.0.1:3306`. Sao chép `.env.example` thành `.env`
và sửa thông tin kết nối nếu môi trường của bạn khác.

Lệnh `npm run db:init` tự tạo database `quanlychitieu` và các bảng nếu chưa có.

## Lưu trữ

- Ngân sách và khoản chi: MySQL, cấu trúc tại `database/schema.sql`
- Ảnh/PDF chứng từ: `public/uploads/`
- Tối đa 2 chứng từ cho mỗi khoản chi, 5 MB mỗi file

Có thể đổi vị trí file chứng từ bằng biến môi trường `UPLOAD_DIR`.

## API

- `GET /api/health`
- `GET /api/bootstrap?month=YYYY-MM`
- `PUT /api/budgets/:month`
- `POST /api/expenses`
- `DELETE /api/expenses/:id`
- `GET /api/expenses.csv`
