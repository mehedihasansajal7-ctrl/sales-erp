# HUMAN_TODO — the few things only a person can do

Everything else in this project is automated and verified. The items below need a human: production
credentials, a font file, or a decision about the real infrastructure.

---

## 1. Before going live with real data (blocking)

| # | Task | Why / how |
|---|---|---|
| 1.1 | Set a real `AUTH_SECRET` (32+ random chars) | It signs every session cookie. The app refuses to start in production without it. `openssl rand -base64 48` |
| 1.2 | Change the database password and `DATABASE_URL` | The compose file ships `postgres/postgres` for local use only. |
| 1.3 | Change `SEED_DEFAULT_PASSWORD`, then **change every demo password** (or delete the demo accounts) in **Admin → Users & roles** | The demo accounts are documented publicly in the README. |
| 1.4 | Set `SEED_ON_START=false` | Otherwise the container re-creates demo master data on every start. |
| 1.5 | Create the real users, products, customers and warehouses (Admin) and enter opening stock | Then verify **Stock & inward** matches the physical count. |
| 1.6 | Publish today's rates from **Finance → Publish rates** | Nothing can be ordered before a rate exists for a product. |
| 1.7 | Decide the hostname, put TLS in front (nginx/Caddy), and set the app behind it | The app assumes it is reached over HTTPS in production. |

## 2. Paperwork that only a human can produce

| # | Task | Why / how |
|---|---|---|
| 2.1 | Review the **challan / DO / order confirmation** layouts with the actual business forms | They follow the data model; a real stationary layout may need tweaks (labels, company block, terms). Everything is in `src/components/print-view.tsx` + `src/server/services/print.service.ts`. |
| 2.2 | Confirm the credit-limit policy with management | The check is a *warning with override* (as briefed). If it must ever be a hard block, turn off overrides in **Admin → Settings**. |
| 2.3 | Agree who may grant **priority overrides** and what must be written | The reason is mandatory, audited and reported. |
| 2.4 | Decide the retention period for `backups/` | Default is 14 days (`BACKUP_KEEP_DAYS`). |

## 3. Unicode / Bangla in PDFs (optional but recommended)

PDFKit's built-in fonts cannot encode the **৳** sign or Bengali script. The UI shows ৳ normally; PDF
exports print `BDT` until a Unicode font is supplied:

1. Download `NotoSansBengali-Regular.ttf` (and `-Bold`) from Google Fonts (OFL licence — free to
   redistribute) and place it in the project, e.g. `assets/NotoSansBengali-Regular.ttf`.
2. Set `PDF_FONT_PATH=/app/assets/NotoSansBengali-Regular.ttf` for the `app` service in
   `docker-compose.yml` (and copy the `assets` folder in the `Dockerfile`).
3. Restart the app. PDFs then render ৳ and Bangla names correctly — no code change needed.

## 4. Operations a human must schedule

| # | Task | How |
|---|---|---|
| 4.1 | Daily database backup | Add `./scripts/backup.sh` to cron / Windows Task Scheduler. Restore steps are printed by the script. |
| 4.2 | Test a restore once | `docker compose exec -T db pg_restore -U postgres -d sales_erp_restore --clean --if-exists < backups/<file>.dump` |
| 4.3 | Monitor `/api/health` | It returns the DB state and latency; wire it to your monitor. |
| 4.4 | Rotate `AUTH_SECRET` if it ever leaks | Rotating signs everyone out — expected and safe. |

## 5. Nice-to-have follow-ups (not required by the brief)

* **Multi-instance deployment** → move the login rate limiter (`src/lib/rate-limiter`) to Redis.
* **Bangla UI** → all strings are inline in components; add a dictionary layer when needed.
* **Email/WhatsApp notifications** on approval/dispatch (the data model already carries all it needs).
* **CSV/Excel import** of opening stock and customer master data (an import wizard).
* **Barcode / weighbridge integration** at the dispatch screen (the dispatch form is the natural hook).

## 6. Machine-specific notes (already fixed on 2026-10-17)

**Docker disk moved to D:.** `C:` kept filling up (0.28–0.41 GB free) and took the Docker engine down
with it. Docker's 9.3 GB data disk now lives on `D:\docker\data`, with
`%LOCALAPPDATA%\Docker\wsl\disk` repointed to it as a **junction**
(`cmd /c mklink /J "C:\Users\user\AppData\Local\Docker\wsl\disk" "D:\docker\data"`).
`C:` now has ~10.6 GB free and all images/volumes survived.

If Docker fails again with `Wsl/Service/AttachDisk/CreateVm/ERROR_TIMEOUT` or HTTP 500s from the
engine: check free space on `C:` first, then `wsl --shutdown` and restart Docker Desktop. If the
junction is ever removed, that same `mklink` command restores it (the data is on D:).

**Windows build-context gotcha.** Docker Desktop occasionally handed the build **0-byte** copies of
`next.config.ts`, `tsconfig.json` and `docker-entrypoint.sh` (files that git had rewritten). That
produced an image that died with `exec ./docker-entrypoint.sh: exec format error` and silently lost
`serverExternalPackages`. The `Dockerfile` now fails the build if any of those files arrive empty,
and it strips CRLF from the entrypoint (`sed -i 's/\r$//'`). If a build fails with that guard,
`git checkout -- next.config.ts tsconfig.json docker-entrypoint.sh` and rebuild.

Everything else that was previously listed as "pending verification" is now done:
`docker compose up` ✔ · `/api/health` ✔ · migrations + idempotent seed inside the container ✔ ·
printables and report exports ✔ · the 74 automated tests ✔.

---

## Restore procedure (copy this somewhere safe)

```bash
# 1. stop writes
docker compose stop app

# 2. restore the latest dump into a fresh database
LATEST=$(ls -1t backups/sales_erp_*.dump | head -n1)
docker compose exec -T db createdb -U postgres sales_erp_restore
docker compose exec -T db pg_restore -U postgres -d sales_erp_restore --clean --if-exists < "$LATEST"

# 3. verify
docker compose exec -T db psql -U postgres -d sales_erp_restore -c "select count(*) from orders;"

# 4. switch the app over (either rename the database or point DATABASE_URL at it) and start it
docker compose start app
curl http://localhost:3001/api/health
```
