# Scheduled Migration với Auto-Resume

## Tổng Quan

Workflow tự động chạy migration mỗi 7 giờ với khả năng resume, cho phép migration lớn (2M+ records) được xử lý theo từng phiên 5.5 giờ.

## Cách Hoạt Động

### Chu Kỳ 7 Giờ

```
┌─────────────────────────────────────────────────────────────┐
│  00:00 UTC          07:00 UTC          14:00 UTC            │
│    ▼                  ▼                  ▼                   │
│  ┌─────────┐  Rest  ┌─────────┐  Rest  ┌─────────┐         │
│  │ Run 1   │  1.5h  │ Run 2   │  1.5h  │ Run 3   │         │
│  │ 5.5h    │───────▶│ 5.5h    │───────▶│ 5.5h    │         │
│  └─────────┘        └─────────┘        └─────────┘         │
│                                                              │
│  Resume từ          Resume từ          Resume từ           │
│  checkpoint 0       checkpoint 10      checkpoint 20        │
└─────────────────────────────────────────────────────────────┘
```

### Lịch Chạy Hàng Ngày

| Thời gian (UTC) | Hoạt động | Thời lượng |
|-----------------|-----------|------------|
| 00:00 - 05:30   | 🏃 Chạy migration | 5.5 giờ |
| 05:30 - 07:00   | 😴 Nghỉ | 1.5 giờ |
| 07:00 - 12:30   | 🏃 Chạy migration | 5.5 giờ |
| 12:30 - 14:00   | 😴 Nghỉ | 1.5 giờ |
| 14:00 - 19:30   | 🏃 Chạy migration | 5.5 giờ |
| 19:30 - 21:00   | 😴 Nghỉ | 1.5 giờ |
| 21:00 - 02:30   | 🏃 Chạy migration | 5.5 giờ |

## Tính Năng

### ✅ Auto-Resume
- Tự động resume từ checkpoint cuối cùng
- Không cần can thiệp thủ công
- Không duplicate hoặc mất dữ liệu

### ⏱️ Timeout Protection
- Chạy tối đa 5.5 giờ mỗi lần
- Nghỉ 1.5 giờ giữa các lần chạy
- Tránh quá tải API và database

### 🔄 Continuous Migration
- Chạy liên tục cho đến khi hoàn thành
- Tự động xử lý lỗi và retry
- Không cần monitor thường xuyên

## Kích Hoạt Scheduled Workflow

### Option 1: Enable Schedule (Recommended)

Workflow đã được cấu hình với schedule. Để enable:

1. Đảm bảo file `.github/workflows/migrate-scheduled.yml` có trong repository
2. Push lên GitHub
3. Workflow sẽ tự động chạy theo schedule

**Lưu ý:** GitHub Actions schedule có thể delay 5-10 phút từ thời điểm chính xác.

### Option 2: Manual Trigger

Để test hoặc chạy ngay lập tức:

1. Vào GitHub Actions
2. Chọn "Scheduled Migration with Auto-Resume"
3. Click "Run workflow"
4. Chọn table và checkpoint size (optional)
5. Click "Run workflow"

## Ước Tính Thời Gian Hoàn Thành

### Với 2,210,059 Records

**Checkpoint size: 50,000 records**

| Metric | Value |
|--------|-------|
| Total checkpoints | 45 |
| Records per checkpoint | 50,000 |
| Time per checkpoint | ~8-10 phút |
| Records per 5.5h run | ~300,000-400,000 |
| Checkpoints per run | ~6-8 |
| Total runs needed | ~6-8 runs |
| Total time | ~2-3 ngày |

**Timeline Example:**

```
Day 1:
  00:00-05:30: Checkpoint 1-7   (350k records) ✅
  07:00-12:30: Checkpoint 8-14  (350k records) ✅
  14:00-19:30: Checkpoint 15-21 (350k records) ✅
  21:00-02:30: Checkpoint 22-28 (350k records) ✅

Day 2:
  00:00-05:30: Checkpoint 29-35 (350k records) ✅
  07:00-12:30: Checkpoint 36-42 (350k records) ✅
  14:00-19:30: Checkpoint 43-45 (160k records) ✅

✅ COMPLETED: 2,210,059 records in ~2 days
```

## Monitoring Progress

### Real-time Status

Xem progress trong GitHub Actions:
1. Vào tab "Actions"
2. Chọn workflow "Scheduled Migration with Auto-Resume"
3. Xem runs gần nhất

### Database Queries

```sql
-- Tổng quan progress
SELECT
  status,
  COUNT(*) as checkpoints,
  SUM(records_processed) as total_records
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new'
GROUP BY status;

-- Phần trăm hoàn thành
SELECT
  ROUND(
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) * 100.0 / COUNT(*),
    2
  ) as progress_percent,
  SUM(records_processed) as records_completed,
  COUNT(*) as total_checkpoints
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new';

-- Last completed checkpoint
SELECT
  id,
  start_id,
  end_id,
  records_processed,
  completed_at
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new'
  AND status = 'completed'
ORDER BY end_id DESC
LIMIT 1;

-- Next pending checkpoint
SELECT
  id,
  start_id,
  end_id
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new'
  AND status = 'pending'
ORDER BY start_id
LIMIT 1;

-- Estimate time to completion
WITH stats AS (
  SELECT
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_checkpoints,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_checkpoints,
    AVG(
      CAST((julianday(completed_at) - julianday(started_at)) * 24 * 60 AS REAL)
    ) as avg_minutes_per_checkpoint
  FROM migration_checkpoints
  WHERE table_name = 'coordinate_speed_new'
    AND status = 'completed'
)
SELECT
  completed_checkpoints,
  pending_checkpoints,
  ROUND(avg_minutes_per_checkpoint, 2) as avg_minutes_per_checkpoint,
  ROUND(pending_checkpoints * avg_minutes_per_checkpoint / 60, 2) as estimated_hours_remaining
FROM stats;
```

## Troubleshooting

### Issue: Schedule Không Chạy

**Nguyên nhân:**
- Repository không có activity gần đây
- Schedule bị disabled
- GitHub Actions quota exceeded

**Giải pháp:**
1. Check Actions tab → Chọn workflow → Enable nếu disabled
2. Run manual trigger để test
3. Check repository settings → Actions → General

### Issue: Workflow Timeout Quá Sớm

**Nguyên nhân:**
- API rate limiting
- Network issues
- Database slow queries

**Giải pháp:**
1. Kiểm tra error logs trong Actions
2. Tăng delay giữa các batch (hiện tại: 200ms)
3. Giảm checkpoint size để xử lý nhanh hơn

```bash
# Workflow sẽ tự động retry lần sau
# Không cần làm gì
```

### Issue: Muốn Tạm Dừng Schedule

**Giải pháp:**
1. Vào `.github/workflows/migrate-scheduled.yml`
2. Comment out phần schedule:
```yaml
# schedule:
#   - cron: '0 0,7,14,21 * * *'
```
3. Commit và push

### Issue: Muốn Chạy Nhiều Hơn 4 Lần/Ngày

**Giải pháp:**

Sửa cron schedule để chạy thường xuyên hơn:

```yaml
# Mỗi 6 giờ (4 lần/ngày)
- cron: '0 0,6,12,18 * * *'

# Mỗi 4 giờ (6 lần/ngày)
- cron: '0 0,4,8,12,16,20 * * *'

# Mỗi 3 giờ (8 lần/ngày)
- cron: '0 */3 * * *'
```

**Lưu ý:** Giảm thời gian nghỉ khi tăng tần suất chạy.

### Issue: Muốn Thay Đổi Timeout

**Giải pháp:**

Sửa `timeout-minutes` trong workflow:

```yaml
jobs:
  migrate-scheduled:
    timeout-minutes: 330  # 5.5 giờ (mặc định)
    # Hoặc:
    # timeout-minutes: 240  # 4 giờ
    # timeout-minutes: 180  # 3 giờ
```

Cập nhật schedule tương ứng để phù hợp với chu kỳ nghỉ.

## Best Practices

### 1. Kiểm Tra Secrets

Đảm bảo các secrets được set đúng:

```bash
# Required secrets:
- DATABASE_URL
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- D1_DATABASE_ID
```

### 2. Monitor First Few Runs

Theo dõi 2-3 runs đầu tiên để đảm bảo:
- Schedule chạy đúng giờ
- Resume hoạt động chính xác
- Không có lỗi recurring

### 3. Setup Notifications (Optional)

Thêm notification khi migration hoàn thành:

```yaml
- name: Notify on Complete
  if: success()
  run: |
    # Add your notification logic here
    # E.g., send email, Slack message, etc.
```

### 4. Backup Progress

Query checkpoint status định kỳ và lưu vào file:

```bash
# Export checkpoint status
wrangler d1 execute <DB_ID> \
  --command "SELECT * FROM migration_checkpoints" \
  > checkpoint-backup-$(date +%Y%m%d).json
```

## Advanced Configuration

### Multi-Table Schedule

Để migrate nhiều tables tuần tự:

```yaml
- name: Migrate coordinate_speed_new
  env:
    TABLE_NAME: coordinate_speed_new
  run: npm run migrate:resume

- name: Migrate camera_locations
  if: success()  # Only if first table succeeds
  env:
    TABLE_NAME: camera_locations
  run: npm run migrate:resume:camera
```

### Conditional Schedule

Chỉ chạy vào ngày trong tuần:

```yaml
schedule:
  # Monday to Friday at 00:00, 07:00, 14:00, 21:00
  - cron: '0 0,7,14,21 * * 1-5'
```

Hoặc chỉ cuối tuần:

```yaml
schedule:
  # Saturday and Sunday
  - cron: '0 0,7,14,21 * * 6-7'
```

## Performance Tuning

### Tăng Tốc Migration

1. **Tăng checkpoint size**
   ```yaml
   env:
     CHECKPOINT_SIZE: 100000  # 100k instead of 50k
   ```
   - Pro: Ít checkpoints hơn, overhead ít hơn
   - Con: Ít granular, retry mất thời gian hơn

2. **Giảm delay giữa batches**
   - Sửa trong `migrate-with-resume.js`
   - Giảm từ 200ms xuống 100ms
   - Risk: Có thể bị rate limit

3. **Chạy song song nhiều tables**
   ```yaml
   strategy:
     matrix:
       table: [coordinate_speed_new, camera_locations]
     max-parallel: 2
   ```

### Giảm Chi Phí API

1. **Tăng batch size** (nếu có thể)
2. **Tối ưu query PostgreSQL**
3. **Cache kết quả trung gian**

## Logs và Debugging

### View Logs

```bash
# Via GitHub CLI
gh run list --workflow=migrate-scheduled.yml
gh run view <run-id> --log

# Web UI
GitHub → Actions → Scheduled Migration → Select run → View logs
```

### Debug Checkpoints

```sql
-- Find stuck checkpoints
SELECT * FROM migration_checkpoints
WHERE status = 'in_progress'
  AND datetime(started_at, '+1 hour') < datetime('now');

-- Reset stuck checkpoints
UPDATE migration_checkpoints
SET status = 'pending', started_at = NULL
WHERE status = 'in_progress'
  AND datetime(started_at, '+1 hour') < datetime('now');
```

## FAQ

**Q: Có thể dừng migration giữa chừng không?**
A: Có, chỉ cần cancel workflow. Lần chạy sau sẽ tự động resume.

**Q: Nếu 1 checkpoint fail nhiều lần?**
A: Workflow sẽ retry trong lần chạy tiếp theo. Check error_message trong migration_checkpoints để debug.

**Q: Có thể chạy manual trong khi schedule đang active?**
A: Có, nhưng chỉ nên chạy 1 instance tại một thời điểm để tránh conflict.

**Q: Schedule có chạy nếu repository private?**
A: Có, miễn là bạn có GitHub Actions minutes còn.

**Q: Làm sao biết migration đã hoàn thành?**
A: Query checkpoint status, hoặc check workflow logs. Khi tất cả checkpoints = 'completed', migration xong.

## Summary

- ✅ **Tự động**: Chạy mỗi 7 giờ không cần can thiệp
- ✅ **An toàn**: Resume từ checkpoint, không mất dữ liệu
- ✅ **Hiệu quả**: 5.5h chạy + 1.5h nghỉ
- ✅ **Theo dõi**: Monitor qua Actions hoặc D1 queries
- ✅ **Linh hoạt**: Có thể tùy chỉnh schedule và timeout

Với 2.2M records, migration sẽ hoàn thành trong ~2-3 ngày tự động! 🚀
