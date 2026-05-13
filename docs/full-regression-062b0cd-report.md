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
| `pnpm install` | TBD | |
| `docker compose -f infra/docker-compose.dev.yml up -d postgres redis minio mailhog` | PASS | All 4 containers healthy (verified pre-run). |
| `pnpm --filter @xuantoi/shared build` | TBD | |
| `pnpm --filter @xuantoi/api prisma generate` | TBD | |
| `pnpm --filter @xuantoi/api prisma migrate deploy` | TBD | Will verify Phase 31 + Phase 30/32 + Phase 41 migrations apply clean. |
| `pnpm --filter @xuantoi/api bootstrap` | TBD | |
| `pnpm typecheck` | TBD | |
| `pnpm lint` | TBD | |
| `pnpm --filter @xuantoi/shared test` | TBD | |
| `pnpm --filter @xuantoi/api test` | TBD | |
| `pnpm --filter @xuantoi/web test` | TBD | |
| `pnpm build` | TBD | |
| `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` | TBD | |
| `pnpm smoke:economy` | TBD | |

## Feature Matrix (delta vs PR #562)

| Area | Status | Notes |
|---|---|---|
| Phase 31 Social/Retention | TBD | Unit + integration only; manual deferred to PR B. |
| Phase 30 Market V2 Auction | TBD | 24 API tests added; manual deferred to PR C. |
| Phase 32 Codex/Bestiary | TBD | 11 API tests added; manual deferred to PR C. |
| Phase 33 Story Quyển II–IV | TBD | Catalog only; manual deferred to PR B. |
| Phase 41 Player QoL | TBD | 14 web smoke tests added; manual deferred to PR C. |
| Admin Control Center Overview `INTERNAL_ERROR` (P0.3) | TBD | Verify on fresh env. |
| Smoke rate-limit flusher (P1.6) | TBD | New script. |

## Findings

_Populated as test runs._
