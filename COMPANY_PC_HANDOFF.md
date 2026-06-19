# AISS Company PC Handoff

Read this file first on the company PC before making changes.

## Current project location on personal PC

`C:\Users\xm100\Documents\Codex\AISS PROJECT`

## GitHub repository

- Repo: `https://github.com/meichee91/AISS-PROJECT.git`
- Branch: `main`

## Current architecture

- Frontend: single-file UI in `frontend/index.html`
- Backend: Node/Express in `backend/server.js`
- Database: **Azure SQL** (active)
- AI provider: **OpenAI API** using `OPENAI_API_KEY` (active)
- Azure OpenAI: prepared in `.env`, **not active yet** because Azure quota/model deployment was blocked
- Hosting: **Azure App Service `aiss-sls`** (active live host)

## Important storage rules

- Azure SQL stores:
  - case numbers
  - historical good/bad cases
  - AI run logs
  - app event logs
  - eval cases
  - expert verification data
- Uploaded image data is stored **inside the historical case payload JSON**
- No separate image file storage is currently required

Azure SQL is the only active structured storage path.

## Azure deployment model

- GitHub `main` is connected to Azure App Service through GitHub Actions
- Workflow file: `.github/workflows/main_aiss.yml`
- Azure App Service `aiss-sls` auto-updates on successful workflow runs

## Current expert verification design

Case statuses:

- `Draft`
- `AI Generated`
- `Pending Expert Review`
- `Verified - Good`
- `Verified - Corrected`
- `Verified - Rejected`
- `Archived`

Learning logic:

- `Verified - Good` => positive reference
- `Verified - Corrected` => corrective reference
- `Verified - Rejected` => stored for traceability, not a direct positive learning case
- Unverified cases should not be used for AI learning

## Local run commands

From repo root:

```powershell
cd "C:\Apps\AISS PROJECT\backend"
npm install
node server.js
```

Then open:

`http://localhost:3000`

## Required environment variables

Create `backend\.env` on the company PC with:

```env
OPENAI_API_KEY=...
PORT=3000

AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_DEPLOYMENT_GPT_5_4=
AZURE_OPENAI_DEPLOYMENT_GPT_5_4_MINI=

AZURE_SQL_SERVER=...
AZURE_SQL_DATABASE=...
AZURE_SQL_USER=...
AZURE_SQL_PASSWORD=...
AZURE_SQL_ENCRYPT=true
AZURE_SQL_TRUST_SERVER_CERTIFICATE=false

CATALOG_SYNC_INTERVAL_MINUTES=4320
CATALOG_SYNC_ENABLED=false
CATALOG_SYNC_ON_STARTUP=false
```

## Azure App Service env vars should match

- `OPENAI_API_KEY`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_DATABASE`
- `AZURE_SQL_USER`
- `AZURE_SQL_PASSWORD`
- `AZURE_SQL_ENCRYPT=true`
- `AZURE_SQL_TRUST_SERVER_CERTIFICATE=false`
- `CATALOG_SYNC_ENABLED=false`
- `CATALOG_SYNC_ON_STARTUP=false`
- `CATALOG_SYNC_INTERVAL_MINUTES=4320`

## Live URL

Current live URL:

- `https://aiss-sls.azurewebsites.net`

## Notes for future Codex on company PC

If continuing this project:

1. open the repo from `C:\Apps\AISS PROJECT`
2. read this file first
3. inspect:
   - `frontend/index.html`
   - `backend/server.js`
   - `azure-sql-schema.sql`
4. verify local server runs on `http://localhost:3000`
5. confirm GitHub Actions is still deploying to `aiss-sls`

## Recommended migration workflow

1. Push latest code from personal PC to GitHub
2. Clone into `C:\Apps\AISS PROJECT` on company PC
3. Re-create `backend\.env` manually on company PC
4. Run `npm install`
5. Start backend with `node server.js`
6. Open folder in Codex and continue work there
