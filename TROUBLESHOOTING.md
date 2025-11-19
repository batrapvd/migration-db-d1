# Troubleshooting GitHub Actions Errors

## Error: "The given account is not valid or is not authorized to access this service" (Code 7403)

This error occurs when the Cloudflare API credentials are invalid or improperly configured.

### Quick Fix Checklist

1. **Verify GitHub Secrets are Set**
   - Go to your repository on GitHub
   - Navigate to: **Settings** → **Secrets and variables** → **Actions** → **Repository secrets**
   - Ensure these three secrets exist:
     - `CLOUDFLARE_API_TOKEN`
     - `CLOUDFLARE_ACCOUNT_ID`
     - `D1_DATABASE_ID`

2. **Get Your Cloudflare Account ID**
   ```bash
   # Login to Cloudflare Dashboard
   # Go to: Workers & Pages
   # Your Account ID is displayed on the right sidebar
   ```

   Or use Wrangler CLI:
   ```bash
   wrangler whoami
   ```

3. **Get Your D1 Database ID**
   ```bash
   # List all D1 databases in your account
   wrangler d1 list

   # Output will show:
   # ┌──────────────────────────────────┬─────────────┬─────────┐
   # │ Database ID                      │ Name        │ Version │
   # ├──────────────────────────────────┼─────────────┼─────────┤
   # │ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxx │ my-database │ ...     │
   # └──────────────────────────────────┴─────────────┴─────────┘
   ```

4. **Create a New API Token with Proper Permissions**

   The API token needs **D1:Edit** permissions. Follow these steps:

   a. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)

   b. Click on your profile icon → **My Profile** → **API Tokens**

   c. Click **Create Token**

   d. Use **Create Custom Token**

   e. Configure the token:
      - **Token name**: `D1 Migration Token`
      - **Permissions**:
        - Account → D1 → Edit
      - **Account Resources**:
        - Include → Your account
      - **TTL**: Set expiration as needed

   f. Click **Continue to summary** → **Create Token**

   g. **Copy the token immediately** (you won't be able to see it again!)

5. **Update GitHub Secrets**

   In your GitHub repository:
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Update each secret:
     - Click on the secret name
     - Click **Update secret**
     - Paste the new value
     - Click **Update secret**

### Testing Credentials Locally

Before running GitHub Actions, test your credentials locally:

1. **Create a `.env` file** (already gitignored):
   ```bash
   CLOUDFLARE_API_TOKEN=your_api_token_here
   CLOUDFLARE_ACCOUNT_ID=your_account_id_here
   D1_DATABASE_ID=your_database_id_here
   DATABASE_URL=your_postgres_url_here
   ```

2. **Run the validation script**:
   ```bash
   npm run validate
   ```

   This will test each credential step-by-step and show exactly what's wrong.

### Common Issues

#### Issue: "Account not found"
- **Cause**: Wrong `CLOUDFLARE_ACCOUNT_ID`
- **Fix**: Get the correct Account ID from Cloudflare Dashboard or `wrangler whoami`

#### Issue: "Database not found"
- **Cause**: Wrong `D1_DATABASE_ID` or database doesn't exist
- **Fix**:
  ```bash
  wrangler d1 list  # Find correct database ID
  # OR create a new database:
  wrangler d1 create my-database
  ```

#### Issue: "Unauthorized" or "Invalid API token"
- **Cause**: API token expired, revoked, or has wrong permissions
- **Fix**: Create a new API token with D1:Edit permissions (see step 4 above)

#### Issue: "Token doesn't have D1 permissions"
- **Cause**: API token created without D1:Edit permission
- **Fix**: Create a new token with the correct permissions

### Manual Testing with cURL

Test your credentials directly:

```bash
# Test 1: Verify account access
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json"

# Test 2: Verify D1 database access
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json"

# Test 3: Execute a test query
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1"}'
```

Replace `{ACCOUNT_ID}`, `{DATABASE_ID}`, and `{API_TOKEN}` with your actual values.

### Still Having Issues?

If you've followed all steps and still see errors:

1. **Check API token expiration**: Create a new token with no expiration or a longer TTL
2. **Verify account billing**: Some D1 features require a paid plan
3. **Check Cloudflare status**: Visit [cloudflarestatus.com](https://www.cloudflarestatus.com/)
4. **Review Cloudflare audit logs**: Check if API requests are being logged and why they're failing

### Working Example

After fixing credentials, your workflow should show:

```
🔍 Validating Cloudflare credentials...
Step 1: Checking environment variables...
✅ All environment variables are set

Step 2: Validating API token format...
✅ API token format looks valid

Step 3: Verifying Cloudflare account access...
✅ Account verified: My Account Name
   Account ID: abc123...

Step 4: Verifying D1 database access...
✅ D1 database verified: my-database
   Database ID: xyz789...

Step 5: Testing query execution...
✅ Query execution successful

🎉 All credentials are valid and working!
```
