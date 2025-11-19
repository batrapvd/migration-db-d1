# PostgreSQL to Cloudflare D1 Migration

Production-ready migration scripts for transferring large datasets from PostgreSQL to Cloudflare D1 with resume capability, checkpoint tracking, and optimized performance.

## Features

### ✅ Resumable Migration
- **Checkpoint system** - Divides migration into manageable chunks (default: 50,000 records)
- **Automatic resume** - Restarts from last successful checkpoint on failure
- **Progress tracking** - Stores checkpoint status in D1 database
- **Zero data loss** - Failed checkpoints are retried on next run

### ⏰ Scheduled Migration
- **Auto-scheduling** - Runs every 7 hours (5.5h work + 1.5h rest)
- **Continuous migration** - Automatically continues until completion
- **Timeout protection** - Prevents GitHub Actions 6-hour timeout
- **Zero maintenance** - No manual intervention needed

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

**Option 1: Auto-Setup (Recommended for D1 API approach)**

The migration scripts automatically create required tables if they don't exist:

```bash
# Tables are auto-created during migration - no setup needed!
npm run migrate:resume
```

**Option 2: Wrangler CLI Migrations (Recommended for production)**

Use Wrangler CLI for versioned migrations with rollback support:

```bash
# Install dependencies (includes Wrangler)
npm install

# Apply migrations to remote D1 database
npx wrangler d1 migrations apply speedlimit --remote

# List applied migrations
npx wrangler d1 migrations list speedlimit --remote

# View migration history
npx wrangler d1 execute speedlimit --remote --command "SELECT * FROM d1_migrations"
```

**Option 3: Manual Setup via API**

```bash
# Create tables and indexes in D1 manually (optional)
npm run setup-db
```

## Migration Approaches

This project supports two approaches for migration:

### 🔷 Approach 1: D1 API (Direct REST API calls)

**How it works:**
- Uses `fetch()` to call Cloudflare D1 REST API directly
- Auto-creates tables if they don't exist
- No additional CLI tools needed

**Best for:**
- Quick start and testing
- Simple setup with minimal configuration
- GitHub Actions automation (already configured)

**Files:**
- `migrate-with-resume.js` - Resumable migration with checkpoints
- `migrate.js` - Traditional migration
- `.github/workflows/migrate-scheduled.yml` - Scheduled automation

### 🔶 Approach 2: Wrangler CLI (Official Cloudflare tooling)

**How it works:**
- Uses Wrangler CLI (`npx wrangler d1`) for schema migrations
- Versioned migrations stored in `migrations/` folder
- Migration history tracked in `d1_migrations` table
- Data migration still uses resumable scripts (migrate-with-resume.js)

**Best for:**
- Production environments
- Version-controlled schema changes
- Teams needing rollback capability
- Integration with existing Wrangler workflows

**Files:**
- `wrangler.toml` - Wrangler configuration
- `migrations/0001_initial_schema.sql` - Initial schema migration
- `.github/workflows/migrate-wrangler.yml` - Wrangler-based automation

**Workflow:**
1. Apply schema using Wrangler: `npx wrangler d1 migrations apply`
2. Migrate data using resumable scripts: `npm run migrate:resume`
3. Track progress via `migration_checkpoints` table

### Run Migration

#### Using D1 API Approach (Approach 1)

**Resumable Migration (Recommended for large datasets)**

```bash
# Migrate coordinate_speed_new table
npm run migrate:resume

# Migrate camera_locations table
npm run migrate:resume:camera

# Migrate both tables
npm run migrate:resume:all
```

**Traditional Migration (For smaller datasets)**

```bash
# Migrate coordinate_speed_new table
npm run migrate

# Migrate camera_locations table
npm run migrate:camera

# Migrate both tables
npm run migrate:all
```

#### Using Wrangler CLI Approach (Approach 2)

**Via GitHub Actions (Recommended)**

1. Go to **Actions** tab in GitHub
2. Select "Migration with Wrangler CLI (Option 2)"
3. Click **Run workflow**
4. Configure options:
   - ✅ Apply schema migrations
   - ✅ Migrate data
   - Choose table name
   - Set checkpoint size
   - Select remote/local database
5. Click **Run workflow**

**Via Command Line (Local/Manual)**

```bash
# Step 1: Configure wrangler.toml with your database ID
# Edit wrangler.toml and replace "your-d1-database-id" with actual ID

# Step 2: Apply schema migrations
npx wrangler d1 migrations apply speedlimit --remote

# Step 3: Migrate data using resumable scripts
export DATABASE_URL="postgresql://user:pass@host:port/database"
export CLOUDFLARE_API_TOKEN="your_api_token"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export D1_DATABASE_ID="your_database_id"

npm run migrate:resume  # or migrate:resume:camera, migrate:resume:all
```

### Validate Credentials

```bash
# Test API credentials before migration
npm run validate
```

### Scheduled Automatic Migration (Recommended for Large Datasets)

**Set it and forget it!** For datasets with 1M+ records, use scheduled migration:

```yaml
# Migration runs automatically every 7 hours
# Schedule: 00:00, 07:00, 14:00, 21:00 UTC daily
# - 5.5 hours runtime per session
# - 1.5 hours rest between sessions
# - Auto-resumes from last checkpoint
```

**Setup:**
1. Ensure `.github/workflows/migrate-scheduled.yml` is in your repository
2. Set required secrets in GitHub (see Environment Variables below)
3. Push to GitHub - workflow starts automatically!

**Benefits:**
- ✅ Runs continuously until completion (~2-3 days for 2M records)
- ✅ No manual intervention needed
- ✅ Survives GitHub Actions 6-hour timeout
- ✅ Automatically resumes on failure

**See [SCHEDULED-MIGRATION.md](SCHEDULED-MIGRATION.md) for detailed guide.**

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

## Choosing the Right Approach

### Quick Comparison

| Feature | D1 API Approach | Wrangler CLI Approach |
|---------|----------------|---------------------|
| **Setup Complexity** | ⭐ Simple | ⭐⭐ Moderate |
| **Schema Management** | Auto-created | Versioned migrations |
| **Rollback Support** | ❌ No | ✅ Yes |
| **Migration History** | Via checkpoints only | Via `d1_migrations` table |
| **GitHub Actions** | ✅ Pre-configured | ✅ Pre-configured |
| **Local Development** | ✅ Easy | ✅ Easy (with Wrangler) |
| **Production Ready** | ✅ Yes | ✅✅ Highly recommended |
| **Team Collaboration** | ⭐⭐ Good | ⭐⭐⭐ Excellent |
| **CLI Tool Required** | ❌ No | ✅ Yes (Wrangler) |

### When to Use D1 API Approach

✅ **Choose this if:**
- Quick prototyping or testing
- Simple one-time migration
- Minimal setup requirements
- Don't need schema versioning
- Working solo on the project

### When to Use Wrangler CLI Approach

✅ **Choose this if:**
- Production environment
- Team collaboration with version control
- Need rollback capability
- Want migration history tracking
- Already using Wrangler for Workers/Pages
- Need to manage multiple environments (dev, staging, prod)

### Can I Switch Between Approaches?

✅ **Yes!** You can:
1. Start with D1 API for quick migration
2. Switch to Wrangler CLI later for better schema management
3. Use both: Wrangler for schema, D1 API for data migration
4. Export current schema and create migration files

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

#### D1 API Approach (Approach 1)
1. **migrate-scheduled.yml** - Scheduled migration (every 7 hours with auto-resume)
2. **migrate-resume.yml** - Resumable migration with checkpoint tracking
3. **migrate.yml** - Traditional migration
4. **migrate-all.yml** - Migrate both tables sequentially
5. **migrate-camera-locations.yml** - Camera locations only

#### Wrangler CLI Approach (Approach 2)
6. **migrate-wrangler.yml** - Schema + data migration using Wrangler CLI

### Running Workflows

**For D1 API workflows (1-5):**
1. Go to **Actions** tab in GitHub
2. Select desired workflow
3. Click **Run workflow**
4. Configure options:
   - Setup schema (first run only)
   - Checkpoint size (for resume workflows)
   - Table name

**For Wrangler CLI workflow (6):**
1. Go to **Actions** tab in GitHub
2. Select "Migration with Wrangler CLI (Option 2)"
3. Click **Run workflow**
4. Configure options:
   - Apply schema migrations (✅ recommended for first run)
   - Migrate data (✅ recommended)
   - Table name (coordinate_speed_new, camera_locations, or all)
   - Checkpoint size (default: 50000)
   - Use remote database (✅ for production)

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

### Migration Scripts (D1 API)

- `migrate-with-resume.js` - Resumable migration with checkpoints
- `migrate.js` - Traditional migration for coordinate_speed_new
- `migrate-camera-locations.js` - Traditional migration for camera_locations
- `setup-d1-schema.js` - Create database schema in D1
- `validate-credentials.js` - Test API credentials

### Wrangler CLI Files

- `wrangler.toml` - Wrangler configuration for D1 database
- `migrations/0001_initial_schema.sql` - Initial schema migration
- `migrations/` - Directory for versioned migrations

### Documentation

- `README.md` - This file (comprehensive guide)
- `MIGRATION-RESUME.md` - Detailed resumable migration guide
- `TROUBLESHOOTING.md` - Common issues and solutions
- `SCHEDULED-MIGRATION.md` - Scheduled migration guide

### Configuration

- `schema.sql` - Database schema for D1 (reference)
- `package.json` - NPM scripts and dependencies
- `.github/workflows/` - GitHub Actions workflows
  - `migrate-scheduled.yml` - Scheduled migration (D1 API)
  - `migrate-resume.yml` - Resumable migration (D1 API)
  - `migrate-wrangler.yml` - Wrangler CLI migration
  - `migrate.yml`, `migrate-all.yml`, `migrate-camera-locations.yml` - Additional workflows

## Best Practices

### General

1. **Validate credentials before migration**: `npm run validate`
2. **Use resumable migration for large datasets**: `npm run migrate:resume`
3. **Monitor progress via checkpoint queries**
4. **Test on smaller table first** (camera_locations)
5. **Keep logs of migration runs**
6. **Verify record counts after completion**

### For D1 API Approach

1. **Schema auto-setup**: No manual setup needed, tables are auto-created
2. **Use scheduled workflow** for datasets > 1M records
3. **Monitor via checkpoint queries** in D1 console

### For Wrangler CLI Approach

1. **Apply migrations first**: `npx wrangler d1 migrations apply speedlimit --remote`
2. **Check migration status**: `npx wrangler d1 migrations list speedlimit --remote`
3. **Use version control** for migration files in `migrations/` folder
4. **Test locally first**: Run migrations without `--remote` flag for testing
5. **Create new migration files** for schema changes instead of editing existing ones

## Support

### Common Commands

**D1 API Approach:**
```bash
# Test credentials
npm run validate

# Setup database (optional - auto-created)
npm run setup-db

# Run resumable migration
npm run migrate:resume

# Check progress (in D1 console)
SELECT status, COUNT(*) FROM migration_checkpoints GROUP BY status;
```

**Wrangler CLI Approach:**
```bash
# Test credentials
npm run validate

# Apply schema migrations
npx wrangler d1 migrations apply speedlimit --remote

# List applied migrations
npx wrangler d1 migrations list speedlimit --remote

# Run data migration
npm run migrate:resume

# Check migration history
npx wrangler d1 execute speedlimit --remote --command "SELECT * FROM d1_migrations"

# Check progress
npx wrangler d1 execute speedlimit --remote --command "SELECT status, COUNT(*) FROM migration_checkpoints GROUP BY status"
```

### Getting Help

1. Check `TROUBLESHOOTING.md` for common issues
2. Review `MIGRATION-RESUME.md` for detailed guide
3. Check checkpoint status for stuck migrations
4. Review error messages in migration_checkpoints table

## License

MIT
