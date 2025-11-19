# Resumable Migration Guide

## Overview

The resumable migration system divides large migrations into manageable checkpoints, allowing you to:
- **Resume from failures** - If migration fails, restart from last successful checkpoint
- **Track progress** - See exactly which ranges have been migrated
- **Optimize performance** - Uses ID-based pagination instead of OFFSET
- **Handle 2M+ records** - Efficiently processes large datasets

## How It Works

### Checkpoint System

1. **Initialization**: Divides migration into 50,000 record chunks based on ID ranges
2. **Tracking**: Stores checkpoint status in `migration_checkpoints` table in D1
3. **Processing**: Migrates one checkpoint at a time
4. **Resume**: On restart, skips completed checkpoints and continues from where it left off

### Checkpoint States

- `pending` - Not yet started
- `in_progress` - Currently being processed
- `completed` - Successfully migrated
- `failed` - Encountered an error (will be retried on next run)

## Usage

### Basic Commands

```bash
# Migrate coordinate_speed_new table with resume capability
npm run migrate:resume

# Migrate camera_locations table with resume capability
npm run migrate:resume:camera

# Migrate both tables sequentially with resume capability
npm run migrate:resume:all
```

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:port/db
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
D1_DATABASE_ID=your_database_id

# Optional
TABLE_NAME=coordinate_speed_new          # Table to migrate
CHECKPOINT_SIZE=50000                     # Records per checkpoint (default: 50,000)
BATCH_SIZE=19                             # Records per D1 insert (default: 19 for coordinate_speed_new, 16 for camera_locations)
RESUME_MODE=true                          # Enable resume (default: true)
```

### Custom Configuration

```bash
# Use smaller checkpoints for more granular control
CHECKPOINT_SIZE=25000 npm run migrate:resume

# Start fresh (ignore existing checkpoints)
RESUME_MODE=false npm run migrate:resume

# Migrate specific table
TABLE_NAME=my_custom_table CHECKPOINT_SIZE=100000 node migrate-with-resume.js
```

## Migration Process

### First Run

```
🚀 Starting resumable migration from PostgreSQL to Cloudflare D1

Configuration:
  Table: coordinate_speed_new
  Checkpoint Size: 50000 records
  D1 Batch Size: 19 rows
  Resume Mode: Enabled

📊 Analyzing coordinate_speed_new...
   Total records: 2210059
   ID range: 1 - 2210059

📋 Initializing checkpoints for coordinate_speed_new...
   Creating 45 checkpoints (50000 records each)...
   ✅ Created 45 checkpoints

📊 Migration Status:
   Pending checkpoints: 45

📤 Processing 45 checkpoints...

[1/45] (2.2% of remaining)
📦 Checkpoint 1: Processing ID range 1-50000 (up to 50000 records)
   ✅ Fetched 50000 records
   Batch 1/2632: Inserted 19 records (0.0% of checkpoint)
   ...
   ✅ Checkpoint 1 completed (50000 records)

[2/45] (4.4% of remaining)
📦 Checkpoint 2: Processing ID range 50001-100000 (up to 50000 records)
   ...
```

### Resume After Failure

If migration fails at checkpoint 15:

```bash
# Simply run the same command again
npm run migrate:resume
```

Output:
```
📊 Migration Status:
   Last completed: ID 700001-750000 (checkpoint 14)
   Resuming from: ID 750001
   Pending checkpoints: 31

📤 Processing 31 checkpoints...

[1/31] (3.2% of remaining)
📦 Checkpoint 15: Processing ID range 750001-800000
   ...
```

## Performance Optimization

### ID-Based Pagination

Instead of using OFFSET (slow for large datasets):
```sql
-- ❌ Slow: OFFSET scans all previous rows
SELECT * FROM table LIMIT 50000 OFFSET 1000000;
```

We use ID ranges (fast):
```sql
-- ✅ Fast: Direct ID lookup with index
SELECT * FROM table WHERE id >= 1000001 AND id <= 1050000;
```

### Benefits

For 2.2 million records:
- **OFFSET-based**: Each query gets slower (1s → 30s → 60s)
- **ID-based**: Consistent fast queries (~0.5s each)

### Checkpoint Size Recommendations

| Total Records | Recommended Checkpoint Size | Number of Checkpoints |
|--------------|----------------------------|----------------------|
| < 100k       | 10,000                     | < 10                 |
| 100k - 500k  | 25,000                     | 4-20                 |
| 500k - 2M    | 50,000                     | 10-40                |
| 2M+          | 100,000                    | 20+                  |

### Rate Limiting

- 200ms delay between D1 batch inserts
- 3 retries with exponential backoff for failed requests
- Checkpoint-based progress allows safe restarts

## GitHub Actions Integration

### Update Workflow

Replace the migration step in `.github/workflows/migrate.yml`:

```yaml
- name: Run Migration with Resume
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
    CHECKPOINT_SIZE: 50000
  run: npm run migrate:resume
```

### Handling Timeouts

GitHub Actions has a 6-hour timeout. For very large migrations:

```yaml
# Split into multiple jobs with different ranges
jobs:
  migrate-part-1:
    steps:
      - name: Migrate first 500k records
        env:
          CHECKPOINT_SIZE: 50000
        run: npm run migrate:resume
        timeout-minutes: 180  # 3 hours

  migrate-part-2:
    needs: migrate-part-1
    steps:
      - name: Resume migration
        run: npm run migrate:resume
        timeout-minutes: 180
```

## Monitoring Progress

### Check Checkpoint Status

Use D1 console or API to query checkpoint status:

```sql
-- See overall progress
SELECT
  status,
  COUNT(*) as checkpoints,
  SUM(records_processed) as total_records
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new'
GROUP BY status;

-- See pending checkpoints
SELECT
  id,
  start_id,
  end_id,
  status,
  error_message
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new' AND status IN ('pending', 'failed')
ORDER BY start_id;

-- See progress percentage
SELECT
  CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100 as progress_percent
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new';
```

### View Failed Checkpoints

```sql
SELECT
  id,
  start_id,
  end_id,
  error_message,
  created_at
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new' AND status = 'failed'
ORDER BY start_id;
```

## Troubleshooting

### Problem: Migration Stuck on Same Checkpoint

**Cause**: Checkpoint marked as 'in_progress' but process died

**Solution**: Manually reset checkpoint status

```sql
UPDATE migration_checkpoints
SET status = 'pending'
WHERE status = 'in_progress' AND table_name = 'coordinate_speed_new';
```

Then re-run migration.

### Problem: Want to Start Fresh

**Solution**: Clear all checkpoints

```bash
# Set RESUME_MODE=false to clear and recreate checkpoints
RESUME_MODE=false npm run migrate:resume
```

Or manually:
```sql
DELETE FROM migration_checkpoints WHERE table_name = 'coordinate_speed_new';
```

### Problem: Some ID Ranges Have No Records

This is normal! The script handles sparse ID ranges gracefully:
- Fetches records in ID range
- If no records found, marks checkpoint as completed with 0 records
- Continues to next checkpoint

### Problem: Checkpoint Failed with Specific Error

1. Check error message:
```sql
SELECT error_message FROM migration_checkpoints WHERE status = 'failed';
```

2. Common issues:
   - Rate limiting → Increase delay between batches
   - Network timeout → Reduce checkpoint size
   - API errors → Check credentials and D1 status

3. After fixing, re-run to retry failed checkpoints

## Best Practices

1. **Start with default settings** (50k checkpoint size)
2. **Monitor first few checkpoints** to ensure smooth operation
3. **Use resume mode** for production migrations
4. **Keep logs** of each migration run
5. **Verify counts** after completion
6. **Test on smaller table first** (camera_locations)

## Comparison: Old vs New Approach

| Feature | Old Script | Resume Script |
|---------|-----------|---------------|
| **Failure handling** | Start over from beginning | Resume from last checkpoint |
| **Progress tracking** | Console only | Persistent in database |
| **Large dataset performance** | Degrades with OFFSET | Consistent with ID ranges |
| **Memory usage** | Loads all data first | Processes chunks |
| **Monitoring** | None | Query checkpoint table |
| **Flexibility** | Fixed flow | Configurable checkpoints |

## Migration Time Estimates

For 2,210,059 records with default settings:

- **Checkpoints**: 45 (50,000 records each)
- **Time per checkpoint**: ~8-10 minutes
- **Total time**: ~6-7.5 hours
- **Resume capability**: Can stop/start anytime

With optimized settings (100k checkpoints):
- **Checkpoints**: 23
- **Time per checkpoint**: ~15-20 minutes
- **Total time**: ~5.75-7.5 hours
