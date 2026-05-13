# Full Project Regression QA Report

> **WIP** — Skeleton created at QA branch checkout. Sections are filled in as tests run. Do **NOT** mark any row PASS without evidence.

## Test Target

- **Repo**: `hoathienmenh-01/xuantoi`
- **Base branch**: `main`
- **Tested branch**: `test/full-project-regression-qa` (cut from `main` @ commit `b1683e83bfe49bba1499aa3ced4f94fdd8d3ce99`)
- **Commit under test**: `b1683e83bfe49bba1499aa3ced4f94fdd8d3ce99` (latest `main` after PR #560 merge)
- **PRs included** (merged into tested commit):
  - PR #560 — Phase 29.0–29.3 — PvP, Arena, Sect War & Spirit Vein Territory V1 (Foundation) — merged
  - PR #559 — Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2 — merged
  - PR #558 — Phase 27.6 — Admin Control Center V2 — merged
  - PR #557 — Phase 27.1–27.5 — Monetization Systems V1 — merged
- **PRs excluded** (still open / draft / not in tested commit):
  - PR #561 — Phase 31.0 — Social & Retention Foundation V1 — **DRAFT, NOT MERGED**. Skeleton lives at branch `phase-31-social-retention-foundation-v1`. This regression run does **not** include it; Social/Retention rows below are scoped to whatever already exists on `main` (Phase 30 / earlier `friend`, `block`, `mail`, `notification` modules).
- **Date**: 2026-05-13 (UTC)
- **Environment**: Devin VM — Ubuntu Linux, Node 20, pnpm 9.15.1, Docker (postgres:16-alpine + redis:7-alpine + minio + mailhog via `infra/docker-compose.dev.yml`).
- **Tester**: Devin (QA Lead role) for `wuzsae` / `hoathienmenh-01`.

## Commands Run

> Filled in as each command runs. `pass / fail / blocked / not available`.

| Command | Status | Notes |
|---|---|---|
| `pnpm install` | pending | |
| `pnpm --filter @xuantoi/shared build` | pending | required before downstream typecheck (CI does this) |
| `pnpm typecheck` | pending | |
| `pnpm lint` | pending | |
| `pnpm --filter @xuantoi/shared test` | pending | |
| `pnpm --filter @xuantoi/api test` (with Postgres + Redis) | pending | |
| `pnpm --filter @xuantoi/web test` | pending | |
| `pnpm build` | pending | |
| `pnpm --filter @xuantoi/web e2e` (Playwright smoke) | pending | |
| `pnpm smoke:*` (selected modules) | pending | |

## Summary

> Filled in at end of run.

- PASS: _TBD_
- FAIL: _TBD_
- BLOCKED: _TBD_
- NOT TESTED: _TBD_

## Feature Matrix

| Area | Status | Evidence | Bugs / Notes |
|---|---|---|---|
| Install | pending | | |
| Typecheck | pending | | |
| Lint | pending | | |
| Shared Tests | pending | | |
| API Tests | pending | | |
| Web Tests | pending | | |
| Build | pending | | |
| E2E/Smoke | pending | | |
| Character | pending | | |
| Cultivation | pending | | |
| Cultivation Method V2 | pending | | |
| Combat | pending | | |
| Inventory | pending | | |
| Equipment | pending | | |
| Drop Economy V2 | pending | | |
| Pháp Bảo / Artifact V2 | pending | | |
| World Content V2 | pending | | |
| Trial Tower | pending | | |
| Quest / Story | pending | | |
| Economy / Ledger | pending | | |
| Monetization | pending | | |
| Shop / Limited Packs | pending | | |
| Admin Control Center | pending | | |
| Event Builder | pending | | |
| PvP / Arena | pending | | |
| Sect War / Territory | pending | | |
| Social / Retention | pending | | PR #561 is draft, not merged. Tested only what's on `main`. |
| Mail / System Gift | pending | | System Gift module only lands with PR #561. |
| Chat / Realtime | pending | | |
| Mobile Responsive | pending | | |
| i18n | pending | | |
| Security / Abuse | pending | | |
| CI | pending | | Tracked via QA PR Actions run. |

## Bugs Found

> Each bug must have: `Bug ID`, `Severity`, `Area`, `Steps to reproduce`, `Expected`, `Actual`, `Evidence/log`, `Fixed in this PR (yes/no)`, `Suggested follow-up`.

_None yet — populated during run._

## Critical Gaps

_Populated at end of run._

## Final Recommendation

_Populated at end of run._

- Ready for closed beta: _TBD_
- Must fix before beta: _TBD_
- Should fix after beta: _TBD_
- Recommended next PR: _TBD_
