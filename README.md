# PostgreSQL to Cloudflare D1 Migration

Production-ready migration scripts for transferring large datasets from PostgreSQL to Cloudflare D1 with resume capability, checkpoint tracking, and optimized performance.

## Features

### ✅ Resumable Migration
- **Checkpoint system** - Divides migration into manageable chunks (default: 50,000 records)
- **Automatic resume** - Restarts from last successful checkpoint on failure
- **Progress tracking** - Stores checkpoint status in D1 database
- **Zero data loss** - Failed checkpoints are retried on next run

### ⚡ Performance Optimizations
- **ID-based pagination** - Consistent fast queries vs degrading OFFSET performance
- **Chunked processing** - Prevents PostgreSQL connection timeouts
- **Configurable batch sizes** - Respects D1's SQL variable limits (99 variables)
- **Rate limiting** - Prevents API throttling with 200ms delays

### 🛡️ Reliability
- **Retry logic** - 3 attempts with exponential backoff for failed requests
- **Error handling** - Detailed error messages and recovery guidance
- **Credential validation** - Pre-flight checks for all API credentials
- **Connection management** - Keeps PostgreSQL connection active during migration

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Required environment variables
export DATABASE_URL="postgresql://user:pass@host:port/database"
export CLOUDFLARE_API_TOKEN="your_api_token"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export D1_DATABASE_ID="your_database_id"
```

### Setup Database Schema

```bash
# Create tables and indexes in D1
npm run setup-db
```

### Run Migration

**Option 1: Resumable Migration (Recommended)**

```bash
# Migrate coordinate_speed_new table
npm run migrate:resume

# Migrate camera_locations table
npm run migrate:resume:camera

# Migrate both tables
npm run migrate:resume:all
```

**Option 2: Traditional Migration**

```bash
# Migrate coordinate_speed_new table
npm run migrate

# Migrate camera_locations table
npm run migrate:camera

# Migrate both tables
npm run migrate:all
```

### Validate Credentials

```bash
# Test API credentials before migration
npm run validate
```

## Migration Strategies

### Resumable Migration (migrate-with-resume.js)

**Best for:**
- Large datasets (500k+ records)
- Production environments
- Long-running migrations
- Unreliable network connections

**Features:**
- Checkpoint-based progress tracking
- Resume from failure automatically
- ID-based pagination (fast)
- Configurable checkpoint sizes

**Configuration:**
```bash
# Custom checkpoint size (default: 50,000)
CHECKPOINT_SIZE=100000 npm run migrate:resume

# Start fresh (ignore existing checkpoints)
RESUME_MODE=false npm run migrate:resume
```

### Traditional Migration (migrate.js)

**Best for:**
- Small datasets (< 100k records)
- One-time migrations
- Testing and development

**Features:**
- Simple, straightforward process
- Chunk-based loading (10,000 records)
- Memory efficient

## Architecture

### Tables

**coordinate_speed_new** (5 columns)
- Max batch size: 19 rows (19 × 5 = 95 variables < 99 limit)
- ~2.2M records

**camera_locations** (6 columns)
- Max batch size: 16 rows (16 × 6 = 96 variables < 99 limit)

**migration_checkpoints** (tracking table)
- Stores checkpoint status, ID ranges, errors
- Enables resume functionality

### Database Schema

```sql
-- Migration tracking table
CREATE TABLE migration_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    start_id INTEGER NOT NULL,
    end_id INTEGER NOT NULL,
    records_processed INTEGER DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

## Performance

### ID-Based vs OFFSET Pagination

| Records Processed | OFFSET Query Time | ID-Based Query Time |
|------------------|-------------------|---------------------|
| 0 - 50k          | ~0.5s             | ~0.5s               |
| 500k - 550k      | ~15s              | ~0.5s               |
| 1M - 1.05M       | ~30s              | ~0.5s               |
| 2M - 2.05M       | ~60s              | ~0.5s               |

**Result:** Consistent performance throughout entire migration

### Estimated Migration Times

For 2,210,059 records:

| Checkpoint Size | Checkpoints | Time per Checkpoint | Total Time |
|----------------|-------------|---------------------|------------|
| 25,000         | 89          | ~4-5 min            | ~6-7.5h    |
| 50,000         | 45          | ~8-10 min           | ~6-7.5h    |
| 100,000        | 23          | ~15-20 min          | ~5.75-7.5h |

## Monitoring Progress

### Query Checkpoint Status

```sql
-- Overall progress
SELECT
  status,
  COUNT(*) as checkpoints,
  SUM(records_processed) as total_records
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new'
GROUP BY status;

-- Completion percentage
SELECT
  CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100 as progress_percent
FROM migration_checkpoints
WHERE table_name = 'coordinate_speed_new';

-- Failed checkpoints
SELECT id, start_id, end_id, error_message
FROM migration_checkpoints
WHERE status = 'failed'
ORDER BY start_id;
```

### Reset Stuck Checkpoints

If a checkpoint is stuck in 'in_progress':

```sql
UPDATE migration_checkpoints
SET status = 'pending'
WHERE status = 'in_progress';
```

Then re-run the migration.

## GitHub Actions

### Workflow Files

1. **migrate-resume.yml** - Resumable migration with checkpoint tracking
2. **migrate.yml** - Traditional migration
3. **migrate-all.yml** - Migrate both tables sequentially
4. **migrate-camera-locations.yml** - Camera locations only

### Running Workflows

1. Go to **Actions** tab in GitHub
2. Select desired workflow
3. Click **Run workflow**
4. Configure options:
   - Setup schema (first run only)
   - Checkpoint size (for resume workflows)
   - Table name

### Handling Timeouts

If GitHub Actions times out (6-hour limit):

1. Simply re-run the workflow
2. Migration will resume from last checkpoint
3. No data loss or duplication

## Troubleshooting

### Issue: "too many SQL variables" Error

**Cause:** Batch size exceeds D1's 99 variable limit

**Solution:** Scripts automatically cap batch size:
- coordinate_speed_new: Max 19 rows
- camera_locations: Max 16 rows

### Issue: "read ECONNRESET" Error

**Cause:** PostgreSQL connection timeout during long operations

**Solution:** Use resumable migration (migrate-with-resume.js):
- Fetches data in smaller chunks
- Keeps connection active

### Issue: "Unexpected token '<'" Error

**Cause:** D1 API rate limiting or server errors

**Solution:** Scripts have built-in:
- 3 retry attempts with exponential backoff
- 200ms delay between batches
- Automatic recovery

### Issue: Migration Fails at Same Checkpoint

**Diagnosis:**
```sql
SELECT * FROM migration_checkpoints WHERE status = 'failed';
```

**Solutions:**
1. Check error_message for specific issue
2. Fix underlying problem (credentials, network, etc.)
3. Re-run migration to retry failed checkpoints

### Issue: Want to Start Over

**Solution 1:** Use RESUME_MODE=false
```bash
RESUME_MODE=false npm run migrate:resume
```

**Solution 2:** Clear checkpoints manually
```sql
DELETE FROM migration_checkpoints WHERE table_name = 'coordinate_speed_new';
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `CLOUDFLARE_API_TOKEN` | D1 API token with Edit permissions | `abc123...` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | `def456...` |
| `D1_DATABASE_ID` | D1 database ID | `ghi789...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `TABLE_NAME` | Table to migrate | `coordinate_speed_new` |
| `CHECKPOINT_SIZE` | Records per checkpoint | `50000` |
| `BATCH_SIZE` | Records per D1 insert | Auto-calculated |
| `RESUME_MODE` | Enable resume capability | `true` |

## Getting Cloudflare Credentials

### Account ID
```bash
wrangler whoami
```
Or find in Cloudflare Dashboard → Workers & Pages (right sidebar)

### D1 Database ID
```bash
wrangler d1 list
```

### API Token
1. Go to Cloudflare Dashboard → My Profile → API Tokens
2. Create Token → Create Custom Token
3. Permissions: **Account → D1 → Edit**
4. Copy token immediately

## Files

### Migration Scripts

- `migrate-with-resume.js` - Resumable migration with checkpoints
- `migrate.js` - Traditional migration for coordinate_speed_new
- `migrate-camera-locations.js` - Traditional migration for camera_locations
- `setup-d1-schema.js` - Create database schema in D1
- `validate-credentials.js` - Test API credentials

### Documentation

- `README.md` - This file
- `MIGRATION-RESUME.md` - Detailed resumable migration guide
- `TROUBLESHOOTING.md` - Common issues and solutions

### Configuration

- `schema.sql` - Database schema for D1
- `package.json` - NPM scripts and dependencies
- `.github/workflows/` - GitHub Actions workflows

## Best Practices

1. **Always run schema setup first**: `npm run setup-db`
2. **Validate credentials before migration**: `npm run validate`
3. **Use resumable migration for large datasets**: `npm run migrate:resume`
4. **Monitor progress via checkpoint queries**
5. **Test on smaller table first** (camera_locations)
6. **Keep logs of migration runs**
7. **Verify record counts after completion**

## Support

### Common Commands

```bash
# Test credentials
npm run validate

# Setup database
npm run setup-db

# Run resumable migration
npm run migrate:resume

# Check progress (in D1 console)
SELECT status, COUNT(*) FROM migration_checkpoints GROUP BY status;
```

### Getting Help

1. Check `TROUBLESHOOTING.md` for common issues
2. Review `MIGRATION-RESUME.md` for detailed guide
3. Check checkpoint status for stuck migrations
4. Review error messages in migration_checkpoints table

## License

MIT
