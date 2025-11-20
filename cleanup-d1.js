#!/usr/bin/env node

import fetch from 'node-fetch';

// Load environment variables if .env exists (for local testing)
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch (err) {
  console.log('Running without dotenv (using environment variables)');
}

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID;
const TABLE_NAME = process.env.TABLE_NAME || 'coordinate_speed_new';

// Validate environment variables
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !D1_DATABASE_ID) {
  console.error('❌ Missing required environment variables:');
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

async function cleanupD1() {
  try {
    console.log('🧹 Starting D1 cleanup process\n');
    console.log('Configuration:');
    console.log(`  Account ID: ${CLOUDFLARE_ACCOUNT_ID}`);
    console.log(`  D1 Database ID: ${D1_DATABASE_ID}`);
    console.log(`  Table: ${TABLE_NAME}\n`);

    // Check current record count in target table
    console.log(`📊 Checking current data in ${TABLE_NAME}...`);
    try {
      const countResult = await executeD1SQL(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
      const currentCount = countResult.result[0].results[0].count;
      console.log(`   Current records: ${currentCount}`);
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`   ℹ️  Table ${TABLE_NAME} does not exist yet`);
      } else {
        throw error;
      }
    }

    // Check current checkpoints
    console.log(`\n📊 Checking migration checkpoints...`);
    try {
      const checkpointCountResult = await executeD1SQL(`SELECT COUNT(*) as count FROM migration_checkpoints WHERE table_name = ?`, [TABLE_NAME]);
      const checkpointCount = checkpointCountResult.result[0].results[0].count;
      console.log(`   Current checkpoints: ${checkpointCount}`);

      const completedResult = await executeD1SQL(`SELECT COUNT(*) as count FROM migration_checkpoints WHERE table_name = ? AND status = 'completed'`, [TABLE_NAME]);
      const completedCount = completedResult.result[0].results[0].count;
      console.log(`   Completed checkpoints: ${completedCount}`);
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`   ℹ️  No migration_checkpoints table found`);
      } else {
        throw error;
      }
    }

    console.log('\n⚠️  WARNING: This will DELETE all data and checkpoints!');
    console.log('⚠️  This action cannot be undone!\n');

    // Delete all data from target table
    console.log(`🗑️  Deleting all data from ${TABLE_NAME}...`);
    try {
      await executeD1SQL(`DELETE FROM ${TABLE_NAME}`);
      console.log(`   ✅ Deleted all records from ${TABLE_NAME}`);
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`   ℹ️  Table ${TABLE_NAME} does not exist, skipping`);
      } else {
        throw error;
      }
    }

    // Delete all checkpoints for this table
    console.log(`\n🗑️  Deleting all checkpoints for ${TABLE_NAME}...`);
    try {
      const deleteResult = await executeD1SQL(`DELETE FROM migration_checkpoints WHERE table_name = ?`, [TABLE_NAME]);
      console.log(`   ✅ Deleted all checkpoints for ${TABLE_NAME}`);
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`   ℹ️  No migration_checkpoints table found, skipping`);
      } else {
        throw error;
      }
    }

    // Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    try {
      const verifyCountResult = await executeD1SQL(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
      const finalCount = verifyCountResult.result[0].results[0].count;
      console.log(`   ${TABLE_NAME} records: ${finalCount}`);

      if (finalCount === 0) {
        console.log('   ✅ Table is empty');
      } else {
        console.log(`   ⚠️  Table still has ${finalCount} records`);
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        throw error;
      }
    }

    try {
      const verifyCheckpointResult = await executeD1SQL(`SELECT COUNT(*) as count FROM migration_checkpoints WHERE table_name = ?`, [TABLE_NAME]);
      const finalCheckpointCount = verifyCheckpointResult.result[0].results[0].count;
      console.log(`   Checkpoints for ${TABLE_NAME}: ${finalCheckpointCount}`);

      if (finalCheckpointCount === 0) {
        console.log('   ✅ All checkpoints deleted');
      } else {
        console.log(`   ⚠️  Still has ${finalCheckpointCount} checkpoints`);
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        throw error;
      }
    }

    console.log('\n✅ Cleanup completed successfully!');
    console.log('💡 You can now run the migration from scratch.\n');

  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

cleanupD1();
