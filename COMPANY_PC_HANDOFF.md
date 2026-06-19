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
- Hosting: **Azure App Service** (active live host)

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

## Supabase status

- Supabase path has been removed from the codebase
- Azure SQL is now the only active structured storage path

## Azure deployment model

- GitHub `main` is connected to Azure App Service through GitHub Actions
- Workflow file: `.github/workflows/main_aiss.yml`
- Azure App Service auto-updates on successful workflow runs

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

## Current local-only changes not yet pushed at the time of writing this handoff

Personal PC `git status` showed local modifications in:

- `azure-sql-schema.sql`
- `backend/server.js`
- `frontend/index.html`

These include:

1. expert verification / case report workflow backbone
2. `Main issue` field under `Machine / Application`
3. UI refinements:
   - `Re-analysis` title cleanup
   - gear icon / loading gears redesign
   - `AI Evaluation`
   - `AI Activity Log`
   - improved error messages

If you want the company PC to exactly match the personal PC latest state, make sure these changes are committed and pushed before cloning there.

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

- `https://aiss-cfdtf0dncgcxcphk.centralus-01.azurewebsites.net`

Recommended next improvement:

- add a custom domain such as `aiss.yourcompany.com` or `aiss.slsbearings.com`
- keep the Azure-generated URL as the technical fallback

## Notes for future Codex on company PC

If continuing this project:

1. open the repo from `C:\Apps\AISS PROJECT`
2. read this file first
3. inspect:
   - `frontend/index.html`
   - `backend/server.js`
   - `azure-sql-schema.sql`
4. verify local server runs on `http://localhost:3000`
5. check whether the latest local-only changes had already been pushed from the personal PC

## Recommended migration workflow

1. Push latest code from personal PC to GitHub
2. Clone into `C:\Apps\AISS PROJECT` on company PC
3. Re-create `backend\.env` manually on company PC
4. Run `npm install`
5. Start backend with `node server.js`
6. Open folder in Codex and continue work there
