# AISS PROJECT

AI Sales Support web app with:

- `frontend/index.html` - single-page frontend
- `backend/server.js` - Express backend serving the frontend and AI APIs
- `backend/catalog-sync.js` - manual product catalog sync logic
- `azure-sql-schema.sql` - Azure SQL tables for active structured storage
- `.github/workflows/main_aiss.yml` - GitHub Actions deployment to Azure App Service

## Current working stack

- **AI**: OpenAI API is active now
- **Database**: Azure SQL is active now
- **Hosting**: Azure App Service is the active live host
- **Azure OpenAI**: code support is ready, but it is not active yet because Azure model quota/deployment is still pending
- **Catalog sync**: manual only

## Local run

1. Open terminal in:
   `C:\Users\xm100\Documents\Codex\AISS PROJECT\backend`
2. Install dependencies:
   `npm install`
3. Create or update `backend/.env`
4. Use this minimum setup:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   PORT=3000

   # Optional future Azure OpenAI cutover
   AZURE_OPENAI_ENDPOINT=
   AZURE_OPENAI_API_KEY=
   AZURE_OPENAI_API_VERSION=
   AZURE_OPENAI_DEPLOYMENT=
   AZURE_OPENAI_DEPLOYMENT_GPT_5_4=
   AZURE_OPENAI_DEPLOYMENT_GPT_5_4_MINI=

   # Active Azure SQL storage
   AZURE_SQL_SERVER=your-server.database.windows.net
   AZURE_SQL_DATABASE=AISSDB
   AZURE_SQL_USER=your_sql_user
   AZURE_SQL_PASSWORD=your_sql_password
   AZURE_SQL_ENCRYPT=true
   AZURE_SQL_TRUST_SERVER_CERTIFICATE=false

   # Manual catalog sync only
   CATALOG_SYNC_ENABLED=false
   CATALOG_SYNC_ON_STARTUP=false
   CATALOG_SYNC_INTERVAL_MINUTES=4320
   ```

5. Start server:
   `npm start`
6. Open:
   `http://localhost:3000`

## Azure SQL setup

Run [azure-sql-schema.sql](</C:\Users\xm100\Documents\Codex\AISS PROJECT\azure-sql-schema.sql>) against your Azure SQL database before starting the app.

This creates the tables used for:

- case number sequence
- historical good/bad cases
- AI run logs
- app event logs
- eval cases
- product catalog metadata

## GitHub and Azure deploy

### 1. Commit and push to GitHub

Run from the project root:

```powershell
cd "C:\Users\xm100\Documents\Codex\AISS PROJECT"
git add .
git commit -m "Update AISS"
git push origin main
```

### 2. Azure App Service pipeline

The repo deploys to Azure App Service through GitHub Actions:

- Workflow file: [C:\Users\xm100\Documents\Codex\AISS PROJECT\.github\workflows\main_aiss.yml](</C:\Users\xm100\Documents\Codex\AISS PROJECT\.github\workflows\main_aiss.yml>)
- Trigger: every push to `main`
- Target app: Azure App Service `aiss`

As long as GitHub Actions is green, the live Azure site updates automatically after each push.

### 3. Azure App Service environment variables

Add these in Azure App Service `Environment variables`:

```env
OPENAI_API_KEY=your_openai_api_key
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=AISSDB
AZURE_SQL_USER=your_sql_user
AZURE_SQL_PASSWORD=your_sql_password
AZURE_SQL_ENCRYPT=true
AZURE_SQL_TRUST_SERVER_CERTIFICATE=false
CATALOG_SYNC_ENABLED=false
CATALOG_SYNC_ON_STARTUP=false
CATALOG_SYNC_INTERVAL_MINUTES=4320
```

Optional future Azure OpenAI variables:

```env
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_DEPLOYMENT_GPT_5_4=
AZURE_OPENAI_DEPLOYMENT_GPT_5_4_MINI=
```

Leave those blank until Azure quota is available and the model deployment exists.

### 4. Live URL

Current Azure App Service URL:

- [https://aiss-cfdtf0dncgcxcphk.centralus-01.azurewebsites.net](https://aiss-cfdtf0dncgcxcphk.centralus-01.azurewebsites.net)

If you want a cleaner URL, the best option is to add a **custom domain** now that the app is on a Basic tier or higher. For example:

- `aiss.yourcompany.com`
- `sales-ai.yourcompany.com`
- `aiss.slsbearings.com`

The Azure-generated `azurewebsites.net` hostname is not a great user-facing URL and is usually left as the technical fallback address.

## Notes

- Historical-case reference is currently deactivated in the live UI/backend flow.
- Product catalog sync is manual-only right now.
- Azure OpenAI support is already coded, but the app will keep using `OPENAI_API_KEY` until the Azure deployment values are filled.
- Render is no longer the main deployment path for AISS.
- Do not commit `backend/.env` or `node_modules`.
