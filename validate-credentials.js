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

console.log('🔍 Validating Cloudflare credentials...\n');

// Step 1: Check if environment variables are set
console.log('Step 1: Checking environment variables...');
const missingVars = [];
if (!CLOUDFLARE_API_TOKEN) missingVars.push('CLOUDFLARE_API_TOKEN');
if (!CLOUDFLARE_ACCOUNT_ID) missingVars.push('CLOUDFLARE_ACCOUNT_ID');
if (!D1_DATABASE_ID) missingVars.push('D1_DATABASE_ID');

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(v => console.error(`  - ${v}`));
  console.error('\nFor GitHub Actions, ensure these secrets are set in your repository:');
  console.error('  Settings → Secrets and variables → Actions → Repository secrets');
  process.exit(1);
}
console.log('✅ All environment variables are set\n');

// Step 2: Validate API Token format
console.log('Step 2: Validating API token format...');
if (CLOUDFLARE_API_TOKEN.length < 20) {
  console.error('❌ API token appears to be invalid (too short)');
  console.error('Expected format: A valid Cloudflare API token');
  process.exit(1);
}
console.log('✅ API token format looks valid\n');

// Step 3: Verify account access
console.log('Step 3: Verifying Cloudflare account access...');
try {
  const accountResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`,
    {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const accountData = await accountResponse.json();

  if (!accountData.success) {
    console.error('❌ Failed to access Cloudflare account');
    console.error('Error:', JSON.stringify(accountData.errors, null, 2));
    console.error('\nPossible issues:');
    console.error('  1. CLOUDFLARE_ACCOUNT_ID is incorrect');
    console.error('  2. API token doesn\'t have permission to access this account');
    console.error('  3. API token has expired or been revoked');
    console.error('\nTo fix:');
    console.error('  1. Verify your Account ID in Cloudflare Dashboard → Workers & Pages');
    console.error('  2. Create a new API token with "D1:Edit" permissions');
    console.error('  3. Update the GitHub secret CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  console.log(`✅ Account verified: ${accountData.result.name}`);
  console.log(`   Account ID: ${CLOUDFLARE_ACCOUNT_ID}\n`);
} catch (error) {
  console.error('❌ Failed to connect to Cloudflare API:', error.message);
  process.exit(1);
}

// Step 4: Verify D1 database access
console.log('Step 4: Verifying D1 database access...');
try {
  const dbResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}`,
    {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const dbData = await dbResponse.json();

  if (!dbData.success) {
    console.error('❌ Failed to access D1 database');
    console.error('Error:', JSON.stringify(dbData.errors, null, 2));
    console.error('\nPossible issues:');
    console.error('  1. D1_DATABASE_ID is incorrect');
    console.error('  2. API token doesn\'t have D1 permissions');
    console.error('  3. Database doesn\'t exist in this account');
    console.error('\nTo fix:');
    console.error('  1. List your D1 databases: wrangler d1 list');
    console.error('  2. Copy the correct database ID');
    console.error('  3. Update the GitHub secret D1_DATABASE_ID');
    console.error('  4. Ensure API token has "D1:Edit" permissions');
    process.exit(1);
  }

  console.log(`✅ D1 database verified: ${dbData.result.name}`);
  console.log(`   Database ID: ${D1_DATABASE_ID}`);
  console.log(`   Version: ${dbData.result.version}\n`);
} catch (error) {
  console.error('❌ Failed to access D1 database:', error.message);
  process.exit(1);
}

// Step 5: Test query execution
console.log('Step 5: Testing query execution...');
try {
  const queryResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: 'SELECT 1 as test'
      })
    }
  );

  const queryData = await queryResponse.json();

  if (!queryData.success) {
    console.error('❌ Failed to execute test query');
    console.error('Error:', JSON.stringify(queryData.errors, null, 2));
    console.error('\nThe API token may not have write/execute permissions for D1.');
    console.error('Ensure the token has "D1:Edit" permissions.');
    process.exit(1);
  }

  console.log('✅ Query execution successful\n');
} catch (error) {
  console.error('❌ Failed to execute test query:', error.message);
  process.exit(1);
}

console.log('🎉 All credentials are valid and working!\n');
console.log('Your configuration:');
console.log(`  Account ID: ${CLOUDFLARE_ACCOUNT_ID}`);
console.log(`  Database ID: ${D1_DATABASE_ID}`);
console.log(`  API Token: ${CLOUDFLARE_API_TOKEN.substring(0, 10)}...`);
console.log('\nYou can now run migrations successfully.');
