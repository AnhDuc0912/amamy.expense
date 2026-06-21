# Amamy - Quản lý chi tiêu

Ứng dụng Express + MongoDB Atlas quản lý ngân sách và khoản chi cho hai chi nhánh HN/HCM.

## Chạy dự án

```bash
npm install
npm run db:init
npm start
```

Mở `http://localhost:3000`.

Sao chép `.env.example` thành `.env`, sau đó cấu hình `MONGODB_URI` và
`MONGODB_DB`.

Lệnh `npm run db:init` kiểm tra kết nối Atlas và tự tạo các collection/index.

## Chạy bằng Docker với MongoDB Atlas

Docker Compose chỉ chạy ứng dụng Node. Database sử dụng MongoDB Atlas qua
chuỗi kết nối trong `.env`.

```bash
docker compose up -d --build
docker compose ps
```

Mở `http://localhost:3000`. Có thể đổi cổng web bằng `APP_PORT` trong `.env`.

Nếu API health báo lỗi kết nối, kiểm tra Atlas Network Access đã cho phép IP
của máy chạy Docker và database user có quyền đọc/ghi.

Các lệnh thường dùng:

```bash
docker compose logs -f app
docker compose restart app
docker compose down
```

## Lưu trữ

- Ngân sách và khoản chi: MongoDB Atlas (`budgets`, `expenses`)
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
