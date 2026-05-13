# Full Project Regression QA Report — `062b0cd`

> Live regression report (PR A của roadmap test trong `docs/testing-backlog-report.md`). Sections fill khi test chạy. KHÔNG mark PASS không có evidence.

## Test Target

- **Repo**: `hoathienmenh-01/xuantoi`
- **Base branch**: `main`
- **Tested branch**: `test/full-regression-062b0cd` (cut từ `main` @ `062b0cd41b4014ad8d22ca99a2e33a993fb0c8fd`)
- **Commit under test**: `062b0cd41b4014ad8d22ca99a2e33a993fb0c8fd`
- **PRs included** (merged into tested commit beyond what PR #562 regression covered):
  - PR #557 Phase 27.1–27.5 Monetization Systems V1 — already covered by #562
  - PR #558 Phase 27.6 Admin Control Center V2 — already covered by #562
  - PR #559 Phase 28.0 Event Builder V2 — already covered by #562
  - PR #560 Phase 29.0–29.3 PvP/Arena/SectWar/Territory — already covered by #562
  - **PR #561 Phase 31.0 Social/Retention Foundation V1 — NEW (not in #562 regression)**
  - **PR #563 Phase 30.0+32.0 Market V2 Auction House + Codex/Bestiary — NEW**
  - **PR #564 Phase 33.0 Story Quest Expansion Quyển II/III/IV — NEW**
  - **PR #565 Phase 41.0 Player Experience QoL (settings/dashboard/feedback/reports) — NEW**
  - PR #566 QA-004 admin guard hydration fix — already verified end-to-end
- **PRs excluded** (still open / draft):
  - PR #567 Phase 33.0B Story Catalog Hardening — DRAFT, NOT MERGED
- **Date**: 2026-05-13 (UTC)
- **Environment**: Devin VM Ubuntu Linux, Node 20, pnpm, Docker (postgres:16 + redis:7 + minio + mailhog)
- **Tester**: Devin

## Test Plan

This regression covers `testing-backlog-report.md` priority list:
- **P0.1** Full automated regression on `062b0cd`
- **P0.3** Verify `INTERNAL_ERROR` on `/api/admin/control-center/overview` (fresh env)
- **P1.6** QA-003 — implement `pnpm smoke:flush-rate-limits` helper

Phase 31 + 33 manual + Phase 30/32/41 dedicated runs are tracked as PR B/C in the roadmap; this PR is **automated regression + 1 small fix**.

## Commands Run

| Command | Status | Notes |
|---|---|---|
| `pnpm install` | **pass** | Lockfile up to date. |
| `docker compose -f infra/docker-compose.dev.yml up -d postgres redis minio mailhog` | **pass** | All 4 containers healthy. |
| `pnpm --filter @xuantoi/shared build` | **pass** | tsup ESM+CJS+DTS, 17 entries. |
| `pnpm --filter @xuantoi/api prisma generate` | **pass** | |
| `pnpm --filter @xuantoi/api prisma migrate deploy` | **pass** | **88 migrations applied** — including 3 new: `20290201000000_phase_31_0_social_retention`, `20300101000000_phase_30_0_market_codex`, `20300101000000_phase_41_0_player_experience_qol`. Clean apply, no rollback. |
| `pnpm --filter @xuantoi/api bootstrap` | **pass** | Idempotent — admin + 3 sects. |
| `pnpm typecheck` | **pass** | 0 errors across shared+api+web (~37s). |
| `pnpm lint` | **pass** | 0 warnings (~26s). |
| `pnpm --filter @xuantoi/shared test` | **pass** | **3819 / 3819 / 130 files / 22.6s** (+200 vs PR #562 baseline 3619). |
| `pnpm --filter @xuantoi/api test` (Postgres + Redis) | **pass** | **3831 / 3831 / 234 files / 200.9s** (+96 vs PR #562 baseline 3735). |
| `pnpm --filter @xuantoi/web test` | **pass** | **2098 / 2098 / 185 files / 113.4s** (+34 vs PR #562 baseline 2064). |
| `pnpm build` (root recursive) | **pass** | shared + api + web all built. PWA precache **135 entries / 3.97 MiB** (was 114/3.7 MiB in #562 — +21 entries). |
| `pnpm smoke:economy` | **pass** | 20/20 round-trip green on fresh DB + Redis flush. |
| `pnpm smoke:flush-rate-limits` (**new in this PR**) | **pass** | Flushed 3 leftover auth-rate-limit keys (1 `rl:register:*`, 1 `ratelimit:AUTH_REGISTER:*`, 1 `ratelimit:AUTH_LOGIN:*`) on first run. |
| `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` | **pass** | **23/23 spec pass / 32.8s** — golden flow auth + onboarding + cultivate + daily-login + missions + shop + inventory + chat WORLD + leaderboard + profile + logout + shop buy + inventory equip + mail + dungeon + settings + spiritual-root + skill-book + talent learn+cast+cooldown + breakthrough banner+history + Phase 12 story Ch1 + Phase 12.3 dungeon-run. |

## Summary

- **PASS**: install, prisma generate + migrate deploy (88), bootstrap, typecheck, lint, shared (3819), api (3831), web (2098), build, smoke:economy (20/20), smoke:flush-rate-limits, E2E_FULL=1 (23/23). Total **9748 automated tests** + 1 E2E suite + 1 smoke suite.
- **FAIL**: 0
- **FIXED in this PR**: P1.6 — added `scripts/flush-auth-rate-limits.mjs` + `pnpm smoke:flush-rate-limits` (QA-003 follow-up).
- **VERIFIED**: P0.3 — yesterday's `INTERNAL_ERROR` on `/api/admin/control-center/overview` was dev-env hygiene (stale API processes exhausting Prisma pool); fresh-env reproduce returns **200 OK with full payload** (see Findings).
- **NOT IN THIS PR**: Phase 31 / 33 / 30 / 32 / 41 manual end-to-end + recording → PR B & PR C in roadmap.

## Feature Matrix (delta vs PR #562)

| Area | Status | Evidence |
|---|---|---|
| Phase 31 Social/Retention migration + tests | **PASS (auto only)** | Migration `20290201000000_phase_31_0_social_retention` applied; api tests +96 incl. mentor/returner/system-gift/admin-mail (subset of 3831 total). Manual deferred to PR B. |
| Phase 30 Market V2 Auction migration + tests | **PASS (auto only)** | Migration `20300101000000_phase_30_0_market_codex` applied; api tests cover market-v2 24 + codex 11. Manual deferred to PR C. |
| Phase 32 Codex/Bestiary | **PASS (auto only)** | Same migration as Phase 30; auto covered. Manual deferred to PR C. |
| Phase 33 Story Quyển II–IV catalog | **PASS (auto only)** | Shared catalog tests pass (3819 total). Manual playthrough deferred to PR B. |
| Phase 41 Player QoL | **PASS (auto only)** | Migration applied; 14 web smoke tests + backend modules pass. Manual deferred to PR C. |
| Admin Control Center Overview `INTERNAL_ERROR` (P0.3) | **RESOLVED — dev-env hygiene** | Fresh API + Redis flush + bootstrap → login admin → `GET /api/admin/control-center/overview` returns `200 {ok:true,data:{totalUsers:3,...}}`. Not a regression. |
| Smoke rate-limit flusher (P1.6) | **PASS** | New `scripts/flush-auth-rate-limits.mjs` works against canonical Redis prefix `ratelimit:{policy}:*` + legacy `rl:*`. |
| All Phase 1-29 baseline (Character/Cultivation/Combat/Inventory/Equipment/Drop Economy V2/Pháp Bảo V2/World Content V2/Trial Tower/Quest/Story/Economy/Monetization/Admin/Event Builder/PvP/Sect War/Mail/Chat/i18n/Security) | **PASS** | Inherited from PR #562 + verified via 9748 auto + 23 E2E re-run on `062b0cd`. No regression. |
| Trial Tower (was "no dedicated tests" in #562) | **IMPROVED** | `apps/api/src/modules/world-content/trial-tower.service.test.ts` — 8 ✓ — confirmed in api test run. |

## Findings

### F1 (P0.3) — Admin Control Center `/overview` 500 was dev-env stale connection, NOT regression

- **Repro pre-fix**: yesterday's PR #566 test session left 2 stale `nest start --watch` processes (pids 20140, 64610) holding Prisma connections. After PR A start, postgres `pg_stat_activity` count = 1 only after killing those processes.
- **Fresh-env verify**: kill stale APIs → `pg_stat_activity = 1` (cleanup OK) → boot single fresh API → login admin → `GET /api/admin/control-center/overview` returns `{ok:true,data:{totalUsers:3,activeUsersToday:1,activeCharacters:1,newUsersToday:3,currencyMintedTodayLinhThach:"100",currencySpentTodayLinhThach:"25",...,generatedAt:"2026-05-13T19:57:25.152Z"}}` — **200 OK, full payload, no error**.
- **Conclusion**: no server-side regression. Recommendation for future sessions: kill stale `nest` watch processes before fresh API boot to avoid Prisma pool exhaustion on dev VMs.

### F2 (P1.6) — QA-003 smoke rate-limit flusher implemented

- New script `scripts/flush-auth-rate-limits.mjs` + `package.json` entry `"smoke:flush-rate-limits"`.
- Mirrors `RATE_LIMIT_PATTERNS` in `apps/web/e2e/helpers.ts:154-169` — both legacy `rl:*` (per-route limiter) and unified `ratelimit:AUTH_*:*` (`@RateLimitPolicy(...)` guard, Phase 15.x+).
- Verified working: first run after fresh smoke:economy + E2E sequence deleted 3 keys, allowing E2E_FULL=1 23/23 to pass without 429 cascades.
- Best-effort: warns and exits 0 if Redis unreachable (CI safe).

### No new bugs found on `062b0cd`

- Zero hard failures across 9748 vitest + 23 E2E + 20 smoke economy.
- Zero typecheck errors, zero lint warnings.
- Zero secrets / .env committed (verified via `git ls-files | grep -E '\.env|credentials|\.pem'` → only `.env.example`).

## Remaining backlog (deferred to PR B + PR C)

Per roadmap in `docs/testing-backlog-report.md`:

- **PR B**: P0.2 Phase 31 Social/Retention manual end-to-end + recording (Mentor/Returner/SystemGift/AdminMail/Mail extend) + P1.1 Phase 33 Story Quyển II–IV manual playthrough.
- **PR C**: P1.2 Equipment/Pháp Bảo manual UI + P1.3 Trial Tower manual + P1.4 Mobile 360/390/414px sweep 30+ views + P1.5 i18n EN audit + Phase 30 Market V2 + Phase 32 Codex + Phase 41 Player QoL manual.
- **P2/P3**: concurrency stress / WS reconnect / anti-cheat anomaly / backup drill / Sentry / advance-day endpoint / drop simulation / build chunk split / 1000-item perf / achievement gameplay / buff system / E2E_FULL CI wire.

## Recommendation

- **Ready for closed beta**: **yes (conditional)** — CI green, 0 P0/P1/P2, automated regression clean on `062b0cd`. Manual coverage for Phase 30/31/32/33/41 (last 16 commits since #562 regression) should land via PR B+C before open beta. P0.3 finding confirmed non-issue.
- **Must fix before beta**: none from this PR.
- **Should fix after beta**: P2.4 backup drill, P2.5 Sentry/structured logs (still on BETA_CHECKLIST.md unticked list).
- **Next PR**: PR B (Phase 31 + Phase 33 manual + recording).
