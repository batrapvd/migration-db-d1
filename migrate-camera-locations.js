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

// D1/SQLite has a limit on SQL variables (SQLITE_MAX_VARIABLE_NUMBER)
// Cloudflare D1 appears to have a strict limit of ~100 variables per query
// camera_locations has 6 columns, so max batch = MAX_VARIABLES / 6
const COLUMNS_COUNT = 6; // location_id, longitude, latitude, altitude, created_at, updated_at
const MAX_SQL_VARIABLES = 99; // Cloudflare D1's actual limit (much lower than standard SQLite)
const MAX_BATCH_SIZE = Math.floor(MAX_SQL_VARIABLES / COLUMNS_COUNT); // = 16 rows max
const REQUESTED_BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '16', 10);
const BATCH_SIZE = Math.min(REQUESTED_BATCH_SIZE, MAX_BATCH_SIZE);

if (REQUESTED_BATCH_SIZE > MAX_BATCH_SIZE) {
  console.log(`⚠️  Requested batch size (${REQUESTED_BATCH_SIZE}) exceeds SQLite variable limit.`);
  console.log(`   Using maximum safe batch size: ${MAX_BATCH_SIZE}\n`);
}

// Validate environment variables
if (!DATABASE_URL || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !D1_DATABASE_ID) {
  console.error('❌ Missing required environment variables:');
  console.error('  - DATABASE_URL');
  console.error('  - CLOUDFLARE_API_TOKEN');
  console.error('  - CLOUDFLARE_ACCOUNT_ID');
  console.error('  - D1_DATABASE_ID');
  process.exit(1);
}

async function executeD1SQL(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;

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

  const result = await response.json();

  if (!result.success) {
    throw new Error(`D1 API Error: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

async function executeBatchInsert(rows) {
  // Build batch insert SQL
  const placeholders = rows.map((_, idx) => {
    return `(?, ?, ?, ?, ?, ?)`;
  }).join(', ');

  const sql = `INSERT INTO camera_locations (location_id, longitude, latitude, altitude, created_at, updated_at) VALUES ${placeholders}`;

  // Flatten params
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

async function migrateData() {
  const pgClient = new Client({
    connectionString: DATABASE_URL,
  });

  try {
    // Connect to PostgreSQL
    console.log('🔌 Connecting to PostgreSQL...');
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');

    // Count total records
    console.log('\n📊 Counting records in PostgreSQL...');
    const countResult = await pgClient.query('SELECT COUNT(*) as count FROM camera_locations');
    const totalRecords = parseInt(countResult.rows[0].count, 10);
    console.log(`   Total records to migrate: ${totalRecords}`);

    if (totalRecords === 0) {
      console.log('⚠️  No records to migrate');
      return;
    }

    // Fetch all data from PostgreSQL
    console.log('\n📥 Fetching data from PostgreSQL...');
    const result = await pgClient.query(`
      SELECT
        location_id,
        longitude,
        latitude,
        altitude,
        created_at,
        updated_at
      FROM camera_locations
      ORDER BY id
    `);

    console.log(`✅ Fetched ${result.rows.length} records`);

    // Convert timestamps to ISO strings
    const processedRows = result.rows.map(row => ({
      ...row,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
    }));

    // Clear existing data in D1 (optional - comment out if you want to append)
    console.log('\n🗑️  Clearing existing data in D1...');
    try {
      await executeD1SQL('DELETE FROM camera_locations');
      console.log('✅ Cleared existing data');
    } catch (error) {
      console.log('⚠️  Could not clear data (table might not exist yet):', error.message);
    }

    // Insert data in batches to D1
    console.log(`\n📤 Inserting data to D1 in batches of ${BATCH_SIZE}...`);
    const batches = Math.ceil(processedRows.length / BATCH_SIZE);

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, processedRows.length);
      const batch = processedRows.slice(start, end);

      console.log(`   Batch ${i + 1}/${batches}: Inserting records ${start + 1}-${end}...`);

      try {
        await executeBatchInsert(batch);
        console.log(`   ✅ Batch ${i + 1} completed`);
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error.message);
        throw error;
      }

      // Small delay to avoid rate limiting
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Verify migration
    console.log('\n🔍 Verifying migration...');
    const verifyResult = await executeD1SQL('SELECT COUNT(*) as count FROM camera_locations');
    const d1Count = verifyResult.result[0].results[0].count;

    console.log(`   PostgreSQL records: ${totalRecords}`);
    console.log(`   D1 records: ${d1Count}`);

    if (d1Count === totalRecords) {
      console.log('\n✅ Migration completed successfully! All records migrated.');
    } else {
      console.log('\n⚠️  Migration completed but record counts do not match!');
      console.log(`   Missing records: ${totalRecords - d1Count}`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    // Close PostgreSQL connection
    await pgClient.end();
    console.log('\n🔌 Disconnected from PostgreSQL');
  }
}

// Run migration
console.log('🚀 Starting migration of camera_locations from PostgreSQL to Cloudflare D1\n');
console.log('Configuration:');
console.log(`  Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
console.log(`  Account ID: ${CLOUDFLARE_ACCOUNT_ID}`);
console.log(`  D1 Database ID: ${D1_DATABASE_ID}`);
console.log(`  Batch Size: ${BATCH_SIZE}\n`);

migrateData();
