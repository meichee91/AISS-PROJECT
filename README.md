# AISS PROJECT

AI Sales Support web app with:

- `frontend/index.html` - single-page frontend
- `backend/server.js` - Express backend serving the frontend and OpenAI API calls
- `backend/catalog-sync.js` - manual catalog sync logic
- `supabase-schema.sql` - Supabase tables for case history and product catalog
- `render.yaml` - Render deployment blueprint

## Local run

1. Open terminal in `backend`
2. Install dependencies:
   `npm install`
3. Create `backend/.env`
4. Add at least:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   CATALOG_SYNC_ENABLED=false
   CATALOG_SYNC_ON_STARTUP=false
   CATALOG_SYNC_INTERVAL_MINUTES=4320
   ```

5. Start server:
   `npm start`
6. Open:
   `http://localhost:3000`

## Deploy to GitHub and Render

### 1. Initialize Git

Run from the project root:

```powershell
cd "C:\Users\xm100\Documents\Codex\AISS PROJECT"
git init
git add .
git commit -m "Initial AISS deploy setup"
```

### 2. Push to GitHub

Create an empty GitHub repository first, then run:

```powershell
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

### 3. Create Render service

In Render:

1. Click `New +`
2. Choose `Blueprint` or `Web Service`
3. Connect your GitHub repo
4. If using `render.yaml`, Render will detect the service automatically

If creating manually, use:

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

### 4. Add Render environment variables

Add these in Render:

```env
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
CATALOG_SYNC_ENABLED=false
CATALOG_SYNC_ON_STARTUP=false
CATALOG_SYNC_INTERVAL_MINUTES=4320
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SYNC_NOTIFY_TO=chee_1201@hotmail.com
SMTP_USER=your_outlook_email
SMTP_PASS=your_outlook_password_or_app_password
SYNC_NOTIFY_FROM=your_outlook_email
```

### 5. Deploy

After saving environment variables, click deploy.

## Notes

- Product catalog sync is manual-only right now.
- Historical-case reference is currently deactivated in the live UI and backend.
- Do not commit `backend/.env` or `node_modules`.
