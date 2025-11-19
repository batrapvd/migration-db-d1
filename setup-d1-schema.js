#!/usr/bin/env node

import fs from 'fs';
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

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !D1_DATABASE_ID) {
  console.error('❌ Missing required environment variables:');
  console.error('  - CLOUDFLARE_API_TOKEN');
  console.error('  - CLOUDFLARE_ACCOUNT_ID');
  console.error('  - D1_DATABASE_ID');
  process.exit(1);
}

async function executeSQL(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sql: sql
    })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(`D1 API Error: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

async function setupSchema() {
  try {
    console.log('📋 Reading schema file...');
    const schema = fs.readFileSync('schema.sql', 'utf8');

    // Split SQL statements by semicolon and execute them
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`🔨 Executing ${statements.length} SQL statements...`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`  [${i + 1}/${statements.length}] Executing: ${stmt.substring(0, 50)}...`);

      try {
        await executeSQL(stmt);
        console.log(`  ✅ Success`);
      } catch (error) {
        console.error(`  ❌ Failed: ${error.message}`);
        throw error;
      }
    }

    console.log('\n✅ Schema setup completed successfully!');

  } catch (error) {
    console.error('\n❌ Error setting up schema:', error.message);
    process.exit(1);
  }
}

setupSchema();
