# Pixely Workspace: Security runbook (Phase 0)

Owner actions are marked **[OWNER]**. Nothing in this file was run automatically.

---

## 1. Purge private files from git history [OWNER]

The working tree no longer tracks these files, but they still exist in **every past
commit** on GitHub:
- production data exports (`production_data_export_*.json`, `Database_*.zip`)
- a full source zip
- customer uploads and screenshots
- `server/seed.ts`, which contains real users' password hashes

Removing them from history rewrites every commit hash.

**Before you start**
- Make sure nobody else has unpushed work.
- Make a full mirror backup first (step 2 below).

1. Install git-filter-repo (needs Python):
   ```bash
   pip install git-filter-repo
   ```

2. Work on a fresh mirror clone, never on your working copy:
   ```bash
   cd ..
   git clone --mirror https://github.com/pixelyofficialstore-a11y/Pixely_Careers_CRM.git crm-purge.git
   cp -r crm-purge.git crm-purge-BACKUP.git
   cd crm-purge.git
   ```

3. Remove the files from all history (avatars under `uploads/avatars/` are kept):
   ```bash
   git filter-repo --force \
     --path-glob 'attached_assets/*.zip' \
     --path-glob 'attached_assets/*export*.json' \
     --path-glob '*export*.json' \
     --path-glob 'attached_assets/pixelchat-pro-main_*.zip' \
     --path screenshots/ \
     --path replit.md \
     --path do_restore.mjs \
     --path server/seed.ts \
     --path Fake \
     --invert-paths
   ```

4. Uploads, except avatars:
   ```bash
   git filter-repo --force --filename-callback '
     if filename.startswith(b"uploads/") and not filename.startswith(b"uploads/avatars/"):
         return None
     return filename'
   ```

5. Check, then force-push:
   ```bash
   git log --all --format= --name-only | grep -E "export.*json|\.zip$|^uploads/|^screenshots/|seed\.ts|replit\.md|do_restore" | sort -u
   ```
   This should print only `uploads/avatars/...` lines. Then:
   ```bash
   git push --force --mirror
   ```

6. Afterwards:
   - Everyone re-clones; old clones still hold the data.
   - Ask GitHub Support to purge cached views and PR refs ("remove sensitive data", https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
   - Delete any forks.
   - Then do the rotations in section 2: the data was public or semi-public for months, so assume it was copied.

---

## 2. Rotate secrets [OWNER]

Assume every secret that was ever in the repo, in Replit, or pasted into a chat has leaked.

| Secret | Where to rotate | Then update |
|---|---|---|
| Supabase DB password (`postgres` owner) | Supabase → Project Settings → Database → Reset database password | `MIGRATION_DATABASE_URL` (local only; **not** on Railway after the switch) |
| `crm_app` DB password | `npx tsx scripts/gen-app-db-password.ts` (new value) → re-run the `ALTER ROLE crm_app PASSWORD …` part of 0001 | Railway `DATABASE_URL` |
| Cloudinary API secret | Cloudinary → Settings → Access Keys → generate new key, then delete the old one | `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (or `CLOUDINARY_URL`) |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | Railway + local `.env` (this signs everyone out) |
| VAPID keys (web push) | `npx web-push generate-vapid-keys` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. Existing push subscriptions stop working; users re-enable notifications once (Phase 3 handles this). |
| Meta Conversions API token | Meta Events Manager → Settings → Generate access token | `META_ACCESS_TOKEN` |
| GitHub personal access token pasted in an earlier session | GitHub → Settings → Developer settings → Tokens → **revoke** | Never reuse it |
| All CRM user passwords | Settings → Team → **Reset password** for each user (temporary password, forced change at next sign-in) | — |

---

## 3. Database migrations (Rule 0)

- There are no automatic schema changes. Boot-time `runMigrations()` and `seedDatabase()` are deleted, and `drizzle-kit push` is blocked in `drizzle.config.ts`.
- Each change is a reviewed file in `migrations/` and is applied by hand with the owner role after **written approval**.

### 3.1 Backup first [OWNER machine]

`pg_dump` must be the same major version as the server, which is **PostgreSQL 17**. To install the client tools only:
```bash
winget install --id PostgreSQL.PostgreSQL.17 --source winget
```
Untick "PostgreSQL Server" in the installer, or install with `--override "--mode unattended --disable-components server"`. `pg_dump.exe` then lives in `C:\Program Files\PostgreSQL\17\bin\`.

Use the **session pooler (port 5432)** or the direct host, not the transaction pooler (6543):
```bash
mkdir -p backups
"/c/Program Files/PostgreSQL/17/bin/pg_dump.exe" "$MIGRATION_DATABASE_URL" \
  --format=custom --no-owner --no-privileges \
  --schema=public --schema=website \
  --file "backups/pixely-$(date +%Y%m%d-%H%M).dump"
ls -lh backups/
```
`backups/` is git-ignored.

### 3.2 Apply
```bash
npx tsx scripts/gen-app-db-password.ts
pnpm db:migrate -- migrations/0001_phase0_security.sql --dry-run
pnpm db:migrate -- migrations/0001_phase0_security.sql --approved
```
- The first command writes `CRM_APP_DB_PASSWORD` to `.env` and never shows it.
- `--dry-run` prints the SQL with the password masked.
- `--approved` runs it only after the owner has approved it in writing.

The script refuses to run when:
- there is no backup newer than 24 h in `backups/`;
- the SQL contains UPDATE/DELETE/TRUNCATE/DROP/MERGE;
- the migration was already applied.

It prints the row counts of every existing table before and after.

### 3.3 Switch the app to the least-privilege role
After 0001 is applied, change Railway `DATABASE_URL` to the `crm_app` role:
```
postgresql://crm_app.<project-ref>:<CRM_APP_DB_PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
```
The owner URL stays only on the owner's machine, as `MIGRATION_DATABASE_URL`.

**Deploy order:** apply 0001 **before** deploying this branch. The new code reads the new `users` columns.

---

## 4. TLS to the database
- `server/dbSsl.ts` verifies the Supabase certificate (`rejectUnauthorized: true`).
- The CA is `certs/supabase-ca.crt`; see `certs/README.md` for its fingerprint and how to confirm it against the dashboard download.
- On Railway the Dockerfile copies `certs/`. Alternatively, set `SUPABASE_CA_CERT` to the PEM text.
- Escape hatch, temporary only: `DB_SSL_ALLOW_UNVERIFIED=1`.
- Check:
  ```bash
  npx tsx scripts/check-db-tls.ts
  ```

---

## 5. What the server enforces now
- **Security headers:**
  - helmet with a strict CSP in production: self + Cloudinary + Meta Graph
  - HSTS
  - `X-Frame-Options: DENY`
  - nosniff
  - `Referrer-Policy: no-referrer`
  - `X-Robots-Tag: noindex, nofollow, noarchive` on every response
  - `/robots.txt` Disallow-all, and no sitemap
- **Sessions:**
  - 7-day rolling, `httpOnly`, `secure` (prod), `sameSite=lax`
  - the session id is regenerated on login
  - the app refuses to boot without a 32+ char `SESSION_SECRET`
  - a password change/reset, deactivation or role change ends all older sessions via `users.sessions_valid_after`; no session rows are deleted
- **CSRF:** double-submit (`pixely_csrf` cookie + `x-csrf-token` header) on every state-changing `/api` request.
- **Rate limits:**
  - login: 5 failures per 15 min per IP and per username, then a 15-min lock
  - API: 300/min per user
  - uploads: 20/min
- **Errors:** always `{ "error": { "code", "message" } }`; 5xx never includes internal details.
- **Files:**
  - New payment/complaint/feedback images are uploaded to Cloudinary as *authenticated*, re-encoded by sharp.
  - They are served through `GET /api/files/:id`: access check, then a 302 to a URL that expires in 10 min.
  - Old public URLs keep working.
  - Avatars: images only, max 2 MB, re-encoded to 256 px WebP.
- **Users:**
  - designers see only admins and their own support lead(s), with minimal fields
  - admin "Reset password" gives a one-time temporary password and forces a change at next sign-in
  - optional TOTP 2-step verification for admins
- **Audit log** (`audit_events`, Settings → Security):
  - sign-in success/fail/lock, sign-out
  - password changes and resets, 2FA on/off
  - user create/edit/role/deactivate
  - order delete/cancel
  - payment approve/disapprove
  - exports
  - settings changes
