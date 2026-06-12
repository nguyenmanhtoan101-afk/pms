# Triển khai trên server Ubuntu

Hướng dẫn build & chạy hệ thống PMS Lào Cai bằng Docker trên Ubuntu 22.04/24.04.

## 1. Cài Docker Engine + Compose plugin

```bash
# Gỡ bản cũ (nếu có) rồi cài Docker chính thức
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# (tuỳ chọn) chạy docker không cần sudo
sudo usermod -aG docker $USER && newgrp docker

docker --version && docker compose version
```

## 2. Lấy mã nguồn

```bash
git clone https://github.com/nguyenmanhtoan101-afk/pms.git
cd pms
```

## 3. Cấu hình biến môi trường (BẮT BUỘC đổi bí mật)

```bash
cp .env.example .env
nano .env
```

Sửa trong `.env`:
```
PGPASSWORD=<mat-khau-postgres-manh>
JWT_SECRET=<chuoi-ngau-nhien-dai>     # tạo nhanh: openssl rand -hex 32
SEED_DEMO=0                            # 0 = chỉ seed 2 dự án thật; 1 = kèm dữ liệu demo
```

## 4. Build & chạy

```bash
docker compose up -d --build
```

Lần đầu sẽ tự: tạo schema PostgreSQL → seed dữ liệu → khởi động app.

## 5. Kiểm tra

```bash
docker compose ps                       # cả 2 service phải "running"/"healthy"
curl http://localhost:3000/api/health   # {"ok":true,"db":"connected"}
docker compose logs -f app              # xem log ứng dụng
```

Mở `http://<IP-server>:3000`. Đăng nhập: `skhcn.laocai` / `Skhcn@2026` (đổi mật khẩu ngay sau khi vào).

## 6. Mở firewall (nếu dùng ufw)

```bash
sudo ufw allow 3000/tcp
```

> **Khuyến nghị production:** không expose cổng PostgreSQL ra ngoài. Trong `docker-compose.yml`, xoá khối `ports: ["5432:5432"]` của service `postgres` (các container vẫn nối nhau qua mạng nội bộ). Nên đặt Nginx reverse proxy + HTTPS (Let's Encrypt) trước cổng 3000.

## Vận hành

```bash
# Cập nhật phiên bản mới
git pull && docker compose up -d --build

# Dừng / khởi động lại
docker compose down
docker compose restart app

# Backup database
docker compose exec postgres pg_dump -U pms pms_laocai > backup_$(date +%F).sql

# Restore
cat backup_2026-06-12.sql | docker compose exec -T postgres psql -U pms -d pms_laocai

# Reset dữ liệu seed
docker compose exec app node src/db/seed.js
```
