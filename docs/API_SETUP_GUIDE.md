<!--
  WHAT THIS FILE IS: click-by-click setup for every external service the app uses.
  WHY: all setup happens in web dashboards (no CLI). This is the checklist.
  Sections are added phase by phase.
-->
# API & Service Setup Guide

All steps use web dashboards only. Never paste a secret key into chat, code or git.

| Where a value lives | What goes there |
|---|---|
| `.env` (local, git-ignored) | Browser-safe values only: Supabase URL + publishable key |
| Supabase → Edge Functions → Secrets | Every private key (Sarvam, Gemini, Calendar), plus ALLOWED_ORIGINS |

---

## Phase 1: Supabase project, database and login

### 1. Project settings (done once)
- Region: South Asia (Mumbai).
- **Automatically expose new tables:** OFF. The migrations grant access table by table.
- **Enable automatic RLS:** ON.
- Authentication → Sign In / Providers → **Allow new users to sign up: OFF**. Leave the Email provider ON.

### 2. `.env`
Copy `.env.example` to `.env` and fill in the two values from **Project Settings → API Keys**:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable or legacy anon key>
```

### 3. Run the migrations (SQL Editor)
SQL Editor → **New query**. For each file below, in this order, paste the whole file and click **Run**:
1. `supabase/migrations/20261116000001_schema.sql`
2. `supabase/migrations/20261116000002_rls.sql`
3. `supabase/migrations/20261116000003_pin_auth.sql`
4. `supabase/migrations/20261116000004_pin_rules_setting.sql`. Allows any 4-digit PIN except 0000.

If a warning says a table is created without RLS, choose **Run** (not "Run and enable RLS"). File 2 turns RLS on for every table. All three files are safe to run again.

Check: Table Editor should show 17 tables, each with an RLS badge.

### 4. Deploy the `auth-login` Edge Function
1. Edge Functions → **Deploy a new function** → **Via Editor**.
2. Name: `auth-login` (exactly this).
3. Replace the sample code with the whole of `supabase/functions/auth-login/index.ts`, then **Deploy**.
4. Open the function → **Details** (settings). Turn **Verify JWT** OFF and save.
   It must be off because the user has no token yet at login. The function does its own checks.

### 5. Edge Function secret
Edge Functions → **Secrets** → Add:
- `ALLOWED_ORIGINS` = `http://localhost:5173`
  (later, add the live site URL, comma-separated)

The list should already contain `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase adds them).

### 6. Create the first Admin
1. Authentication → Users → **Add user** → **Create new user**
   - Email: `admin@issue-desk.invalid` (any address; it is never used to send mail)
   - Password: any long random text. You will never use it; login is by PIN.
   - **Auto Confirm User:** ✅
2. Copy the new user's **UID**.
3. SQL Editor:
   ```sql
   select public.bootstrap_admin('<UID>', 'Your Full Name', 'your.username');
   ```
   This works only once, while no admin exists.

### 7. Test
```
npm run dev          → http://localhost:5173
```
- Sign in with `your.username` / `0000`. You should be forced to the **Set your own PIN** screen.
- Set a new PIN. You should land on the Admin dashboard.
- Sign out, then enter a wrong PIN: it should show "x attempts left". After 5 wrong PINs the account locks for 15 minutes.
  To unlock early (SQL Editor):
  ```sql
  update public.app_user_secrets set failed_attempts = 0, locked_until = null
  where user_id = (select id from public.app_users where username = 'your.username');
  ```

---

## Phase 2: User management + CSV import

### 1. Migration
SQL Editor: run `supabase/migrations/20261116000005_user_admin.sql`.

### 2. Deploy the `admin-users` Edge Function
Same steps as `auth-login`: Edge Functions → Deploy a new function → Via Editor → name `admin-users` → paste `supabase/functions/admin-users/index.ts` → Deploy.
Then turn **Verify JWT OFF**. This is safe: the function checks the caller's session itself and refuses anyone who is not an active admin. Turning it off avoids a known gateway problem with the new Supabase API keys.

### 3. Test
- Admin → **Users** → **Add user**: create one user. They should appear with "Default PIN".
- **Import CSV** → **Download template** → add some names → upload. The preview should show the generated usernames.
- Upload the **same file again**: the people already imported should be unticked ("already exists").
- Sign in as an imported user with 0000: you should be forced to change the PIN.

---

## Phase 4: Sarvam AI (Saaras v4, pay-as-you-go)

Docs checked 2026-11-16: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
- `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`, multipart form.
- Model `saaras:v4`. **Max 30 s per request**, so the app sends ≤29 s WAV chunks (16 kHz mono).
- Price (pay-as-you-go): ₹0.49/min, billed per second, about ₹1 for a 2-minute recording. Rate limit 60 requests/min.

### 1. API key
1. https://dashboard.sarvam.ai → sign in → **API Keys** → **Create API key**.
2. Supabase → Edge Functions → **Secrets** → add `SARVAM_API_KEY` = the key.

### 2. Optional secrets (defaults shown; set one only to change it)
| Secret | Default | Meaning |
|---|---|---|
| `SARVAM_STT_MODEL` | `saaras:v4` | model |
| `SARVAM_STT_MODE` | `codemix` | `codemix` = Hindi words in Devanagari, English words in English (Hinglish as spoken). `translit` = everything in Roman letters. `transcribe` = native script. |
| `SARVAM_LANGUAGE_CODE` | `hi-IN` | `unknown` = auto-detect |

### 3. Deploy the `transcribe-audio` function
Edge Functions → Deploy a new function → Via Editor → name `transcribe-audio` → paste `supabase/functions/transcribe-audio/index.ts` → Deploy → **Verify JWT OFF** (the function checks the session itself).

### 4. Spend protection (migrations 6 + 7)
Run in the SQL Editor, in order:
- `supabase/migrations/20261116000006_stt_quota.sql`
- `supabase/migrations/20261116000007_stt_limits_relaxed.sql`

These are anti-spam rules only. There is **no daily cap**, because 4–5 functions a day mean many genuine recordings.
- A user must wait at least **20 seconds** between two new recordings.
- At most **20 new recordings per 15 minutes** per user (backstop).
- A chunk that was already transcribed is never sent to Sarvam again (double tap, two tabs, retry after a lost response).
- If a limit is hit, the recording stays on the phone and is transcribed automatically when allowed.

To change a rule (0 switches it off):
```sql
update app_settings set value = '30' where key = 'stt_min_gap_seconds';
update app_settings set value = '25' where key = 'stt_max_recordings_per_window';
update app_settings set value = '0'  where key = 'stt_max_minutes_per_day';   -- daily cap, 0 = off
```

### 5. Test
Record → stop → "Transcribing…" → the editable transcript appears.
Usage and errors are logged in the `api_usage_log` table (Table Editor), one row per chunk.
## Phase 5: Event Calendar

Details: `docs/EVENT_CALENDAR_API.md`.

1. SQL Editor: run `supabase/migrations/20261116000008_venue_calendar.sql`.
2. Edge Functions → Secrets:
   - `EVENT_CALENDAR_API_URL` = `https://aqpaiyiriarnqhmnxtpt.supabase.co/rest/v1`
   - `EVENT_CALENDAR_API_KEY` = the Calendar anon key (`ambria-calendar/ambria-calendar/.env` → `VITE_SUPABASE_ANON_KEY`)
3. Deploy the `event-calendar` function (Via Editor, paste `supabase/functions/event-calendar/index.ts`), with **Verify JWT OFF**.
4. App → Admin → **Venues** → **Import from Calendar** (own venues AP/AM/AE/AR are pre-ticked).
   Then add Hindi spellings as extra names (e.g. पुष्पांजलि).
5. Test: record "कल Pushpanjali में wedding के time AC काम नहीं कर रहा था". The **Event** card should show the booking.

How the event is identified (nobody picks it by hand):
- date from what was said ("kal" + past tense = yesterday)
- venue from its names, or a lawn/hall that belongs to only one venue
- the day's bookings scored on guest name, function, lunch/dinner and lawn/hall
- a tie is never guessed: the card shows "Not sure" and Admin links the event later
## Phase 6: Submit + Google Gemini

Docs checked 2026-11-16 (ai.google.dev now redirects to aistudio.google.com/docs):
- `gemini-2.5-flash-lite` is now limited to accounts that used 2.5 before. For new keys use **`gemini-3.5-flash-lite`** (Stable). That is the default here; change it with the `GEMINI_MODEL` secret.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, header `x-goog-api-key`.
- ⚠️ **Free tier:** Google may use prompts and responses to improve its products, and human reviewers may read them ("Do not submit sensitive, confidential, or personal information to the Unpaid Services"). **Paid tier:** not used for training. Paid Flash-Lite 3.5 costs $0.30 per 1M input tokens and $2.50 per 1M output tokens, about ₹0.15–0.25 per complaint.
- Before sending, the app replaces guest names (from the Calendar) and phone numbers with `[guest]` / `[phone]`. Staff names said in a recording are NOT removed.

### 1. API key
1. https://aistudio.google.com → sign in with the company Google account.
2. **Get API key** → **Create API key** → choose (or create) a Google Cloud project.
3. Supabase → Edge Functions → Secrets → `GEMINI_API_KEY` = the key.
4. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`).
5. Limits and usage: https://aistudio.google.com/usage

### 2. Database
SQL Editor: run `supabase/migrations/20261116000009_submit_and_categories.sql` (private `recordings` bucket, issue categories, `needs_review` status).

### 3. Functions
- Deploy **`process-issue`** (Via Editor, paste `supabase/functions/process-issue/index.ts`), with **Verify JWT OFF**.
- Re-deploy **`event-calendar`** with the latest code (it now also accepts server-to-server calls).

### 4. Test with DUMMY content only (free tier)
Record "Kal Pushpanjali mein wedding ke time AC kaam nahi kar raha tha aur washroom ganda tha" → Submit.
Expected: 2 issues, Maintenance + Housekeeping, each with a 2-line summary.
Check the tables `submissions`, `issues`, `api_usage_log` (provider = gemini).

---

## Phase 9: 5-minute background job (Supabase Cron)

What it does every 5 minutes:
- retries recordings whose processing failed or got stuck (5 per run)
- deletes recordings older than `audio_retention_days` (default 30) from storage
- removes old technical rows (transcription chunks > 7 days, API logs > 90 days, run log > 30 days)

### Setup
1. SQL Editor: run `supabase/migrations/20261117000014_cron.sql`.
   The last result row shows **copy_this_into_CRON_SECRET**. Copy that value. Do not paste it in chat.
2. Edge Functions → Secrets → add `CRON_SECRET` = that value.
3. Re-deploy **process-issue** with the latest code.
4. Wait about 5 minutes. Admin → Dashboard should show "Background job: last run … min ago".

### Checking it (SQL Editor)
```sql
select started_at, finished_at, ok, stats from job_runs order by id desc limit 5;   -- each run
select status_code, content, created from net._http_response order by created desc limit 5;  -- raw call results
select jobname, schedule, active from cron.job;                                       -- the schedule
```
- If you get `401 Bad cron secret`, CRON_SECRET does not match the Vault secret. Run the last `select` of the migration again and copy the value once more.
- To pause the job: `select cron.unschedule('issue-desk-every-5-min');` (run the migration again to restart it).

---

## Notifications: bell + phone push (Web Push)

Every POC gets one notification per new recording that produced issues (not the person who recorded it).

1. SQL Editor: run `supabase/migrations/20261117000015_notifications.sql`.
2. Open `data/vapid-keys.txt` (git-ignored, generated locally). Edge Functions → Secrets → add:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` = `mailto:<a work email>` (never a `.local` address: iPhone rejects it)
   The same public key is already in `.env` as `VITE_VAPID_PUBLIC_KEY`. The two **must match**, or every push fails with 403.
3. Re-deploy **process-issue**. Restart `npm run dev` (Vite reads `.env` only at start).
4. As a POC: Issues page → **Turn on** → Allow.
5. Test: a *different* user records + submits. The POC should get a phone notification and a red count on the bell.

Debug (SQL Editor):
```sql
select status, retry_count, last_error, created_at from notification_queue order by created_at desc limit 10;
select user_id, left(endpoint, 40), last_used_at, failures from push_subscriptions;
```
- `last_error = 'no devices'` means that POC has not turned notifications on.
- `403` means the public/private keys don't match.
- Rotating the keys invalidates every device: delete all `push_subscriptions` rows and have POCs turn it on again.
- iPhone: only after "Add to Home Screen" (comes with Phase 10 / the https deploy).

---

## Serious alerts on WhatsApp (Whapi.Cloud, same as the attendance "Aria" bot)

When a complaint contains an Admin keyword (Admin → **Serious alerts**), it is marked **Serious** and every active POC with a mobile number gets a WhatsApp message.

1. SQL Editor: run `supabase/migrations/20261117000016_serious_alerts.sql`.
2. Edge Functions → Secrets:
   - `WHAPI_API_TOKEN` = the Whapi channel token (https://panel.whapi.cloud → your channel → API token). Using the same channel as Aria sends from Aria's number.
   - `APP_URL` (optional, after deploy) = the app link, e.g. `https://eat-ambria.github.io/food-review/`. It adds an "Open" link to the message.
3. Re-deploy **process-issue**.
4. Admin → **Serious alerts** → add keywords → **Send test** to your own number.
5. Make sure POCs have a mobile number (Users → Edit). The page lists anyone missing one.

Debug:
```sql
select status, retry_count, last_error, payload->>'to' as to_number, created_at
from notification_queue where channel = 'whatsapp' order by created_at desc limit 10;
```
