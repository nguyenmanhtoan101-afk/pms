# Hệ thống Quản lý dự án CNTT tỉnh Lào Cai

Quản lý danh mục dự án đầu tư ứng dụng CNTT theo **Nghị định 45/2026/NĐ-CP**.

## Kiến trúc

- **Backend:** Node.js 20 + Express · PostgreSQL 16 · JWT auth · ExcelJS
- **Frontend:** HTML/CSS/JS thuần (1 trang), gọi REST API
- **Triển khai:** Docker Compose

## Chạy bằng Docker (khuyến nghị)

```bash
cp .env.example .env       # sửa JWT_SECRET, PGPASSWORD
docker compose up -d
# Mở http://localhost:3000
```

Lần đầu chạy sẽ tự tạo schema + seed dữ liệu (4 tài khoản, 4 quy trình chuẩn, 16 dự án trong đó 2 dự án thật: KPI công chức & LaoCai-S). Đặt `SEED_DEMO=0` để chỉ seed 2 dự án thật.

## Chạy thủ công (dev)

```bash
# 1. PostgreSQL
createuser pms --pwprompt          # mật khẩu: pms2026
createdb pms_laocai -O pms
psql -U pms -d pms_laocai -f backend/src/db/schema.sql

# 2. Backend
cd backend
cp ../.env.example .env
npm install
npm run seed
npm start                          # http://localhost:3000
```

## Tài khoản mặc định

| Vai trò | Tài khoản | Mật khẩu | Phạm vi |
|---|---|---|---|
| Lãnh đạo tỉnh | `lanhdao.laocai` | `Laocai@2026` | Xem toàn bộ |
| Sở KH&CN | `skhcn.laocai` | `Skhcn@2026` | Toàn quyền (Điều 36) |
| Chủ đầu tư (Sở Y tế) | `soyte.laocai` | `Soyte@2026` | Dự án của đơn vị |
| Nhà thầu (FOXAI) | `foxai.nt` | `Foxai@2026` | Gói thầu tham gia |

**Đổi toàn bộ mật khẩu trước khi triển khai thật** (POST /api/users với role=so).

## Cấu trúc API chính

```
POST /api/auth/login                       Đăng nhập → JWT
GET  /api/projects                         Danh mục (tự lọc theo vai trò)
POST /api/projects                         Tạo dự án từ quy trình chuẩn
POST /api/steps/:id/complete               Ghi nhận hoàn thành bước
POST /api/steps/:id/submit                 Nhà thầu gửi cập nhật
POST /api/steps/:id/confirm                CĐT/Sở xác nhận
POST /api/steps/:id/skip                   Bỏ qua bước bắt buộc (cần lý do)
POST /api/projects/:id/baselines           Điều chỉnh kế hoạch (rebaseline)
POST /api/projects/:id/steps               Thêm bước tùy biến
POST /api/urge                             Gửi đôn đốc (Điều 36, chỉ Sở)
GET  /api/portfolio/stats|kpi|alerts|bc35  Phân tích danh mục
GET  /api/export/checklist/:id             Excel checklist (công thức =E+D)
GET  /api/export/list                      Excel danh mục
GET  /api/activity                         Nhật ký thao tác
```

## Logic nghiệp vụ lõi (server-side)

- **Timeline engine:** `due[i] = override[i] ?? due[i-1] + days[i]` — sửa số ngày một bước, toàn chuỗi sau tự tính lại (backend/src/services/timeline.js)
- **KPI 100 điểm:** đúng hạn 40 + độ trễ 25 + điều chỉnh kế hoạch 15 + giải ngân 20 → A/B/C/D (backend/src/services/kpi.js)
- **SLA NĐ 45:** thẩm định ≤20 ngày, phê duyệt ≤3 ngày (Đ34); báo cáo hoàn thành 20/30 ngày (Đ35) — gắn cờ tự động trong /api/portfolio/alerts
- **Audit:** mọi thao tác ghi vào `activity_log` (ai, lúc nào, làm gì)

## Bảo trì

```bash
# Backup
docker compose exec postgres pg_dump -U pms pms_laocai > backup_$(date +%F).sql
# Reset dữ liệu demo
docker compose exec app node src/db/seed.js
```
