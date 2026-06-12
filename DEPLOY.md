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
curl http://localhost:3100/api/health   # {"ok":true,"db":"connected"}  (host map 127.0.0.1:3100)
docker compose logs -f app              # xem log ứng dụng
```

Lúc này app chỉ chạy nội bộ trên server (`127.0.0.1:3000`) — truy cập qua domain sau bước 6.
Đăng nhập: `skhcn.laocai` / `Skhcn@2026` (đổi mật khẩu ngay sau khi vào).

> App đã được cấu hình **chỉ bind `127.0.0.1:3000`** (không expose trực tiếp ra Internet).
> PostgreSQL **không mở cổng** ra ngoài. Việc truy cập public đi qua Nginx ở mục 6.

## 6. Cấu hình domain pms.foxai.com.vn + HTTPS (Nginx + Let's Encrypt)

### 6.1. Trỏ DNS (làm trước)
Tại nhà cung cấp DNS của `foxai.com.vn`, tạo bản ghi:

```
A    pms    <IP-public-cua-server>
```

Đợi DNS có hiệu lực, kiểm tra: `dig +short pms.foxai.com.vn` → ra đúng IP server.

### 6.2. Cài Certbot
> Server **đã có Nginx chạy sẵn** (đang phục vụ nhiều site khác trên cổng 80).
> KHÔNG gỡ/đổi Nginx, chỉ **thêm 1 site mới** cho domain này. Chỉ cần cài thêm Certbot:

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
```

### 6.3. Nạp cấu hình reverse proxy (thêm site mới, KHÔNG đụng site cũ)
File mẫu có sẵn trong repo: `deploy/nginx/pms.foxai.com.vn.conf` (đã proxy tới cổng `3100`).

```bash
sudo cp deploy/nginx/pms.foxai.com.vn.conf /etc/nginx/sites-available/pms.foxai.com.vn
sudo ln -s /etc/nginx/sites-available/pms.foxai.com.vn /etc/nginx/sites-enabled/
# KHÔNG xoá default / các site khác — chỉ kiểm tra cú pháp rồi reload
sudo nginx -t && sudo systemctl reload nginx
```

### 6.4. Cấp chứng chỉ SSL (tự động cấu hình HTTPS)

```bash
sudo certbot --nginx -d pms.foxai.com.vn --agree-tos -m admin@foxai.com.vn --redirect
```

Certbot tự chèn khối SSL cổng 443 + chuyển hướng 80→443 vào file cấu hình, và tự gia hạn
(qua systemd timer `certbot.timer`). Kiểm tra gia hạn: `sudo certbot renew --dry-run`.

### 6.5. Mở firewall (nếu dùng ufw)

```bash
sudo ufw allow 'Nginx Full'      # mở cổng 80 + 443
sudo ufw enable
```

> Không cần mở cổng 3000 ra ngoài — Nginx proxy nội bộ tới `127.0.0.1:3000`.

Xong: truy cập **https://pms.foxai.com.vn**.

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
