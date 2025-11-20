#!/usr/bin/env node

import pg from 'pg';
import fetch from 'node-fetch';

const { Client } = pg;

// Load environment variables if .env exists (for local testing)
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch (err) {
  console.log('Running without dotenv (using environment variables)');
}

const DATABASE_URL = process.env.DATABASE_URL;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID;
const TABLE_NAME = process.env.TABLE_NAME || 'coordinate_speed_new';

// Configuration
const COLUMNS_COUNT = TABLE_NAME === 'coordinate_speed_new' ? 5 : 6;
const MAX_SQL_VARIABLES = 100; // Cloudflare D1's limit (maximum bound parameters per query)
const MAX_BATCH_SIZE = Math.floor(MAX_SQL_VARIABLES / COLUMNS_COUNT);
const BATCH_SIZE = Math.min(parseInt(process.env.BATCH_SIZE || MAX_BATCH_SIZE.toString(), 10), MAX_BATCH_SIZE);
const CHECKPOINT_SIZE = parseInt(process.env.CHECKPOINT_SIZE || '100000', 10); // 100k records per checkpoint (increased from 50k)
const RESUME_MODE = process.env.RESUME_MODE !== 'false'; // Default: true

// Validate environment variables
if (!DATABASE_URL || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !D1_DATABASE_ID) {
  console.error('❌ Missing required environment variables:');
  console.error('  - DATABASE_URL');
  console.error('  - CLOUDFLARE_API_TOKEN');
  console.error('  - CLOUDFLARE_ACCOUNT_ID');
  console.error('  - D1_DATABASE_ID');
  process.exit(1);
}

async function executeD1SQL(sql, params = [], retries = 3) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: sql,
          params: params
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`D1 API HTTP ${response.status}: ${text.substring(0, 200)}`);
      }

      let result;
      try {
        result = await response.json();
      } catch (jsonError) {
        const text = await response.text();
        throw new Error(`D1 API returned non-JSON response: ${text.substring(0, 200)}`);
      }

      if (!result.success) {
        throw new Error(`D1 API Error: ${JSON.stringify(result.errors)}`);
      }

      return result;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);
      console.log(`   ⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Create checkpoint for a range
async function createCheckpoint(tableName, startId, endId) {
  await executeD1SQL(
    `INSERT INTO migration_checkpoints (table_name, start_id, end_id, status) VALUES (?, ?, ?, 'pending')`,
    [tableName, startId, endId]
  );
}

// Update checkpoint status
async function updateCheckpointStatus(checkpointId, status, recordsProcessed, errorMessage = null) {
  const now = new Date().toISOString();
  const field = status === 'in_progress' ? 'started_at' : 'completed_at';

  await executeD1SQL(
    `UPDATE migration_checkpoints
     SET status = ?, records_processed = ?, error_message = ?, ${field} = ?
     WHERE id = ?`,
    [status, recordsProcessed, errorMessage, now, checkpointId]
  );
}

// Get pending or failed checkpoints
async function getPendingCheckpoints(tableName) {
  const result = await executeD1SQL(
    `SELECT * FROM migration_checkpoints
     WHERE table_name = ? AND status IN ('pending', 'failed')
     ORDER BY start_id`,
    [tableName]
  );
  return result.result[0].results;
}

// Get last completed checkpoint
async function getLastCompletedCheckpoint(tableName) {
  const result = await executeD1SQL(
    `SELECT * FROM migration_checkpoints
     WHERE table_name = ? AND status = 'completed'
     ORDER BY end_id DESC LIMIT 1`,
    [tableName]
  );
  return result.result[0].results[0] || null;
}

// Ensure migration_checkpoints table exists
async function ensureCheckpointsTableExists() {
  try {
    // Try to query the table
    await executeD1SQL(`SELECT COUNT(*) FROM migration_checkpoints LIMIT 1`);
  } catch (error) {
    // Table doesn't exist, create it
    if (error.message.includes('no such table')) {
      console.log(`   📋 Creating migration_checkpoints table...`);

      await executeD1SQL(`
        CREATE TABLE migration_checkpoints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          start_id INTEGER NOT NULL,
          end_id INTEGER NOT NULL,
          records_processed INTEGER DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
          error_message TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      await executeD1SQL(`CREATE INDEX idx_checkpoint_table_status ON migration_checkpoints(table_name, status)`);
      await executeD1SQL(`CREATE INDEX idx_checkpoint_table_range ON migration_checkpoints(table_name, start_id, end_id)`);

      console.log(`   ✅ Created migration_checkpoints table with indexes`);
    } else {
      throw error;
    }
  }
}

// Initialize checkpoints for a table
async function initializeCheckpoints(tableName, totalRecords, minId, maxId) {
  console.log(`\n📋 Initializing checkpoints for ${tableName}...`);

  // Ensure checkpoints table exists
  await ensureCheckpointsTableExists();

  // Check if checkpoints already exist
  const existing = await executeD1SQL(
    `SELECT COUNT(*) as count FROM migration_checkpoints WHERE table_name = ?`,
    [tableName]
  );

  const existingCount = existing.result[0].results[0].count;

  if (existingCount > 0 && RESUME_MODE) {
    console.log(`   ℹ️  Found ${existingCount} existing checkpoints (resume mode enabled)`);
    return;
  }

  if (existingCount > 0 && !RESUME_MODE) {
    console.log(`   🗑️  Clearing ${existingCount} existing checkpoints...`);
    await executeD1SQL(`DELETE FROM migration_checkpoints WHERE table_name = ?`, [tableName]);
  }

  // Create checkpoints based on ID ranges (more efficient than OFFSET)
  const checkpoints = [];
  let currentStart = minId;

  while (currentStart <= maxId) {
    const currentEnd = Math.min(currentStart + CHECKPOINT_SIZE - 1, maxId);
    checkpoints.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd + 1;
  }

  console.log(`   Creating ${checkpoints.length} checkpoints (${CHECKPOINT_SIZE} records each)...`);

  for (const checkpoint of checkpoints) {
    await createCheckpoint(tableName, checkpoint.start, checkpoint.end);
  }

  console.log(`   ✅ Created ${checkpoints.length} checkpoints`);
}

// Execute batch insert
async function executeBatchInsert(tableName, rows) {
  if (tableName === 'coordinate_speed_new') {
    const placeholders = rows.map(() => `(?, ?, ?, ?, ?)`).join(', ');
    const sql = `INSERT INTO coordinate_speed_new (latitude, longitude, api_speed_limit, bearing, display_name) VALUES ${placeholders}`;
    const params = rows.flatMap(row => [
      row.latitude,
      row.longitude,
      row.api_speed_limit,
      row.bearing,
      row.display_name
    ]);
    await executeD1SQL(sql, params);
  } else if (tableName === 'camera_locations') {
    const placeholders = rows.map(() => `(?, ?, ?, ?, ?, ?)`).join(', ');
    const sql = `INSERT INTO camera_locations (location_id, longitude, latitude, altitude, created_at, updated_at) VALUES ${placeholders}`;
    const params = rows.flatMap(row => [
      row.location_id,
      row.longitude,
      row.latitude,
      row.altitude,
      row.created_at,
      row.updated_at
    ]);
    await executeD1SQL(sql, params);
  }
}

// Process a single checkpoint
async function processCheckpoint(pgClient, checkpoint) {
  const checkpointId = checkpoint.id;
  const startId = checkpoint.start_id;
  const endId = checkpoint.end_id;
  const expectedRecords = endId - startId + 1;

  console.log(`\n📦 Checkpoint ${checkpointId}: Processing ID range ${startId}-${endId} (up to ${expectedRecords} records)`);

  try {
    await updateCheckpointStatus(checkpointId, 'in_progress', 0);

    // Ensure PostgreSQL connection is alive
    try {
      await pgClient.query('SELECT 1');
    } catch (connError) {
      console.log(`   ⚠️  PostgreSQL connection lost, reconnecting...`);
      await pgClient.connect();
      console.log(`   ✅ Reconnected to PostgreSQL`);
    }

    // Fetch data using ID range (much faster than OFFSET for large datasets)
    const columns = TABLE_NAME === 'coordinate_speed_new'
      ? 'id, latitude, longitude, api_speed_limit, bearing, display_name'
      : 'id, location_id, longitude, latitude, altitude, created_at, updated_at';

    const result = await pgClient.query(`
      SELECT ${columns}
      FROM ${TABLE_NAME}
      WHERE id >= $1 AND id <= $2
      ORDER BY id
    `, [startId, endId]);

    console.log(`   ✅ Fetched ${result.rows.length} records`);

    if (result.rows.length === 0) {
      console.log(`   ℹ️  No records in this range, marking as completed`);
      await updateCheckpointStatus(checkpointId, 'completed', 0);
      return 0;
    }

    // Process timestamps for camera_locations
    let processedRows = result.rows;
    if (TABLE_NAME === 'camera_locations') {
      processedRows = result.rows.map(row => ({
        ...row,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
      }));
    }

    // Insert to D1 in batches
    const batches = Math.ceil(processedRows.length / BATCH_SIZE);
    let recordsProcessed = 0;

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, processedRows.length);
      const batch = processedRows.slice(start, end);

      await executeBatchInsert(TABLE_NAME, batch);
      recordsProcessed += batch.length;

      const progress = ((recordsProcessed / processedRows.length) * 100).toFixed(1);
      console.log(`   Batch ${i + 1}/${batches}: Inserted ${batch.length} records (${progress}% of checkpoint)`);

      // Periodic PostgreSQL keepalive (every 100 batches = ~20 seconds)
      if ((i + 1) % 100 === 0) {
        try {
          await pgClient.query('SELECT 1');
        } catch (pingError) {
          // Ignore keepalive errors, will be caught at next checkpoint
        }
      }

      // Rate limiting
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    await updateCheckpointStatus(checkpointId, 'completed', recordsProcessed);
    console.log(`   ✅ Checkpoint ${checkpointId} completed (${recordsProcessed} records)`);

    return recordsProcessed;
  } catch (error) {
    console.error(`   ❌ Checkpoint ${checkpointId} failed: ${error.message}`);
    await updateCheckpointStatus(checkpointId, 'failed', 0, error.message);
    throw error;
  }
}

// Ensure target table exists in D1
async function ensureTargetTableExists(tableName) {
  try {
    await executeD1SQL(`SELECT COUNT(*) FROM ${tableName} LIMIT 1`);
  } catch (error) {
    if (error.message.includes('no such table')) {
      console.log(`   📋 Creating ${tableName} table in D1...`);

      if (tableName === 'coordinate_speed_new') {
        await executeD1SQL(`
          CREATE TABLE coordinate_speed_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            api_speed_limit REAL,
            bearing REAL,
            display_name TEXT
          )
        `);
        await executeD1SQL(`CREATE INDEX idx_coordinate_latitude_longitude ON coordinate_speed_new(latitude, longitude)`);
        await executeD1SQL(`CREATE INDEX idx_coordinate_display_name ON coordinate_speed_new(display_name)`);
      } else if (tableName === 'camera_locations') {
        await executeD1SQL(`
          CREATE TABLE camera_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id TEXT,
            longitude REAL NOT NULL,
            latitude REAL NOT NULL,
            altitude REAL,
            created_at TEXT,
            updated_at TEXT
          )
        `);
        await executeD1SQL(`CREATE INDEX idx_camera_location_id ON camera_locations(location_id)`);
        await executeD1SQL(`CREATE INDEX idx_camera_latitude_longitude ON camera_locations(latitude, longitude)`);
        await executeD1SQL(`CREATE INDEX idx_camera_created_at ON camera_locations(created_at)`);
      }

      console.log(`   ✅ Created ${tableName} table with indexes`);
    } else {
      throw error;
    }
  }
}

// Main migration function
async function migrateData() {
  const pgClient = new Client({
    connectionString: DATABASE_URL,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000, // Start keepalive after 10s
  });

  try {
    console.log('🚀 Starting resumable migration from PostgreSQL to Cloudflare D1\n');
    console.log('Configuration:');
    console.log(`  Table: ${TABLE_NAME}`);
    console.log(`  Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`  Checkpoint Size: ${CHECKPOINT_SIZE} records`);
    console.log(`  D1 Batch Size: ${BATCH_SIZE} rows`);
    console.log(`  Resume Mode: ${RESUME_MODE ? 'Enabled' : 'Disabled'}\n`);

    // Ensure target table exists in D1
    console.log('🔍 Checking D1 schema...');
    await ensureTargetTableExists(TABLE_NAME);
    console.log('✅ D1 schema ready\n');

    // Connect to PostgreSQL with keepalive
    console.log('🔌 Connecting to PostgreSQL (with keepalive)...');
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');

    // Handle PostgreSQL connection errors
    pgClient.on('error', (err) => {
      console.error('⚠️  PostgreSQL connection error:', err.message);
      // Don't throw, let next checkpoint handle reconnection
    });

    // Get table statistics
    console.log(`\n📊 Analyzing ${TABLE_NAME}...`);
    const statsResult = await pgClient.query(`
      SELECT
        COUNT(*) as total_records,
        MIN(id) as min_id,
        MAX(id) as max_id
      FROM ${TABLE_NAME}
    `);

    const { total_records, min_id, max_id } = statsResult.rows[0];
    console.log(`   Total records: ${total_records}`);
    console.log(`   ID range: ${min_id} - ${max_id}`);

    if (total_records === 0) {
      console.log('⚠️  No records to migrate');
      return;
    }

    // Initialize checkpoints
    await initializeCheckpoints(TABLE_NAME, parseInt(total_records), parseInt(min_id), parseInt(max_id));

    // Get pending checkpoints
    const pendingCheckpoints = await getPendingCheckpoints(TABLE_NAME);
    const lastCompleted = await getLastCompletedCheckpoint(TABLE_NAME);

    console.log(`\n📊 Migration Status:`);
    if (lastCompleted) {
      console.log(`   Last completed: ID ${lastCompleted.start_id}-${lastCompleted.end_id}`);
      console.log(`   Resuming from: ID ${lastCompleted.end_id + 1}`);
    }
    console.log(`   Pending checkpoints: ${pendingCheckpoints.length}`);

    if (pendingCheckpoints.length === 0) {
      console.log('\n✅ All checkpoints already completed!');

      // Verify final count
      console.log('\n🔍 Verifying migration...');
      const verifyResult = await executeD1SQL(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
      const d1Count = verifyResult.result[0].results[0].count;
      console.log(`   PostgreSQL records: ${total_records}`);
      console.log(`   D1 records: ${d1Count}`);

      if (d1Count === parseInt(total_records)) {
        console.log('\n✅ Migration verified successfully!');
      } else {
        console.log(`\n⚠️  Count mismatch! Missing ${parseInt(total_records) - d1Count} records`);
      }

      return;
    }

    // Process checkpoints
    console.log(`\n📤 Processing ${pendingCheckpoints.length} checkpoints...`);
    let totalProcessed = 0;

    for (let i = 0; i < pendingCheckpoints.length; i++) {
      const checkpoint = pendingCheckpoints[i];
      const progress = ((i + 1) / pendingCheckpoints.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${pendingCheckpoints.length}] (${progress}% of remaining)`);

      const processed = await processCheckpoint(pgClient, checkpoint);
      totalProcessed += processed;
    }

    // Final verification
    console.log(`\n🔍 Verifying migration...`);
    const verifyResult = await executeD1SQL(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
    const d1Count = verifyResult.result[0].results[0].count;

    console.log(`   PostgreSQL records: ${total_records}`);
    console.log(`   D1 records: ${d1Count}`);
    console.log(`   Processed in this run: ${totalProcessed}`);

    if (d1Count === parseInt(total_records)) {
      console.log('\n✅ Migration completed successfully! All records migrated.');
    } else {
      console.log(`\n⚠️  Migration completed but record counts do not match!`);
      console.log(`   Missing records: ${parseInt(total_records) - d1Count}`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    console.log('\n💡 You can resume this migration by running the same command again.');
    process.exit(1);
  } finally {
    await pgClient.end();
    console.log('\n🔌 Disconnected from PostgreSQL');
  }
}

migrateData();
