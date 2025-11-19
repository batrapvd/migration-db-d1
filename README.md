# Migration PostgreSQL to Cloudflare D1

Script tự động migration dữ liệu từ PostgreSQL sang Cloudflare D1 Database, được thiết kế để chạy trên GitHub Actions.

## 📋 Tổng quan

Script này migration dữ liệu từ PostgreSQL sang Cloudflare D1 Database. Hỗ trợ migration cho 2 bảng:

### 1. Bảng `coordinate_speed_new`
- `id` - Primary key (AUTOINCREMENT)
- `latitude` - Tọa độ vĩ độ (REAL)
- `longitude` - Tọa độ kinh độ (REAL)
- `api_speed_limit` - Giới hạn tốc độ từ API (REAL)
- `bearing` - Hướng (REAL)
- `display_name` - Tên hiển thị (TEXT)

### 2. Bảng `camera_locations`
- `id` - Primary key (AUTOINCREMENT)
- `location_id` - ID vị trí (TEXT)
- `longitude` - Kinh độ (REAL)
- `latitude` - Vĩ độ (REAL)
- `altitude` - Độ cao (REAL)
- `created_at` - Thời gian tạo (TEXT/ISO8601)
- `updated_at` - Thời gian cập nhật (TEXT/ISO8601)

## 🚀 Setup GitHub Actions

### Bước 1: Setup GitHub Secrets

Vào repository của bạn trên GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Thêm các secrets sau:

| Secret Name | Mô tả | Ví dụ |
|------------|-------|-------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | `your_api_token_here` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | `your_account_id_here` |
| `D1_DATABASE_ID` | D1 Database ID | `your_database_id_here` |

### Bước 2: Setup D1 Database (Chỉ làm 1 lần)

1. Vào tab **Actions** trong GitHub repository
2. Chọn workflow **Migrate All Tables to D1** (hoặc workflow riêng lẻ)
3. Click **Run workflow**
4. Chọn **Setup D1 schema before migration** = `true`
5. Click **Run workflow**

Lần đầu tiên cần setup schema cho D1 database. Sau đó không cần làm lại bước này.

### Bước 3: Chạy Migration

Có 3 workflows để chọn:

#### Option 1: Migration TẤT CẢ bảng (Khuyến nghị)
1. Vào tab **Actions**
2. Chọn workflow **Migrate All Tables to D1**
3. Click **Run workflow**
4. Để **Setup D1 schema before migration** = `false`
5. Click **Run workflow**

Workflow này sẽ migrate cả 2 bảng: `coordinate_speed_new` và `camera_locations`

#### Option 2: Migration từng bảng riêng lẻ

**Migrate coordinate_speed_new:**
- Chọn workflow **Migrate PostgreSQL to Cloudflare D1**
- Click **Run workflow**

**Migrate camera_locations:**
- Chọn workflow **Migrate Camera Locations to D1**
- Click **Run workflow**

Mỗi workflow sẽ tự động:
- ✅ Kết nối với PostgreSQL
- ✅ Đọc toàn bộ dữ liệu từ bảng tương ứng
- ✅ Xóa dữ liệu cũ trong D1 (nếu có)
- ✅ Insert dữ liệu vào D1 theo batch
- ✅ Verify số lượng records sau khi migration

## 💻 Chạy Local (Development)

### Yêu cầu

- Node.js 20+
- npm

### Setup

1. Clone repository:
```bash
git clone <repository-url>
cd migration-db-d1
```

2. Install dependencies:
```bash
npm install
```

3. Tạo file `.env` từ template:
```bash
cp .env.example .env
```

4. Điền thông tin vào file `.env`:
```env
DATABASE_URL=postgresql://username:password@host/database?sslmode=require
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
D1_DATABASE_ID=your_d1_database_id_here
D1_DATABASE_NAME=database-speedlimit
```

### Chạy Migration

1. Setup schema (chỉ lần đầu):
```bash
npm run setup-db
```

2. Chạy migration:

**Migration tất cả bảng:**
```bash
npm run migrate:all
```

**Migration từng bảng riêng lẻ:**
```bash
# Migrate coordinate_speed_new
npm run migrate

# Migrate camera_locations
npm run migrate:camera
```

## ⚙️ Cấu hình

### Batch Size

Mặc định script insert 100 records/batch. Để thay đổi:

**GitHub Actions:**
- Vào **Settings** → **Secrets and variables** → **Actions** → **Variables** tab
- Tạo variable `BATCH_SIZE` với giá trị mong muốn (ví dụ: `50`, `200`)

**Local:**
- Thêm vào file `.env`:
```env
BATCH_SIZE=50
```

### Auto Migration Schedule

Để bật auto migration theo lịch, uncomment phần `schedule` trong `.github/workflows/migrate.yml`:

```yaml
schedule:
  - cron: '0 0 * * 0'  # Chạy mỗi Chủ nhật lúc 00:00 UTC
```

## 📊 Monitoring

Sau khi chạy migration, check:

1. **GitHub Actions logs** - Xem chi tiết quá trình migration
2. **Migration Summary** - Tóm tắt kết quả hiển thị trong GitHub Actions
3. **Cloudflare Dashboard** - Verify dữ liệu trong D1 database

## 🔒 Bảo mật

- ✅ Không commit file `.env` vào git
- ✅ Sử dụng GitHub Secrets để lưu credentials
- ✅ API tokens được mask trong logs
- ✅ Database password được ẩn trong output

## 📝 Cấu trúc Project

```
migration-db-d1/
├── .github/
│   └── workflows/
│       ├── migrate.yml                    # Workflow: coordinate_speed_new
│       ├── migrate-camera-locations.yml   # Workflow: camera_locations
│       └── migrate-all.yml               # Workflow: All tables
├── migrate.js                            # Script migration coordinate_speed_new
├── migrate-camera-locations.js          # Script migration camera_locations
├── setup-d1-schema.js                   # Script setup schema D1
├── schema.sql                            # Schema definition (all tables)
├── package.json                          # Dependencies & scripts
├── .env.example                         # Environment variables template
├── .gitignore                           # Git ignore rules
└── README.md                            # Documentation
```

## 🐛 Troubleshooting

### Error: "Missing required environment variables"

Đảm bảo đã setup đầy đủ GitHub Secrets hoặc file `.env`

### Error: "D1 API Error"

- Kiểm tra `CLOUDFLARE_API_TOKEN` có quyền truy cập D1
- Verify `D1_DATABASE_ID` đúng
- Check API token chưa expire

### Error: "Connection timeout" (PostgreSQL)

- Kiểm tra `DATABASE_URL` format đúng
- Verify database cho phép kết nối từ GitHub Actions IPs
- Check SSL mode requirements

### Migration không khớp số lượng records

- Check PostgreSQL connection stability
- Tăng timeout hoặc giảm batch size
- Review logs để tìm records bị lỗi

## 📄 License

MIT

## 🤝 Contributing

Pull requests are welcome!
