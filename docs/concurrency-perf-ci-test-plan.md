# PR D — Concurrency / Perf / CI Wire Test Plan

**Date**: 2026-05-13
**Branch**: `test/concurrency-perf-ci`
**Base**: `main` @ `25d8d2d` (post-merge: #557 → #572)
**Tester**: Devin
**Session**: https://app.devin.ai/sessions/a92b9681f3db401d9a3ca573628e4c5b

> Mục tiêu: complete 7 testable items còn lại trong `docs/testing-backlog-report.md` (P2.1 / P2.2 / P2.3 / P2.6 / P2.7 / P3.2 / P3.5) trong **1 Draft PR duy nhất**. Phạm vi: pure test — KHÔNG implement feature mới. Nếu phát hiện gap không thể test (ví dụ P2.6 cần admin advance-time endpoint chưa có), document rõ + đề xuất follow-up.

---

## Approach

| Item | Tool | Output |
|---|---|---|
| P2.1 Concurrency stress | Custom Node script + Promise.all | `scripts/stress-concurrent-claim.mjs` |
| P2.2 WS reconnect edge | Extend `smoke-ws.mjs` + mass disconnect | `scripts/stress-ws-reconnect.mjs` |
| P2.3 Anti-cheat anomaly | Custom Node script exercising shared `classifyPvpAnomaly` end-to-end qua API | `scripts/audit-pvp-anomaly.mjs` |
| P2.6 Admin advance-day | Check existence of `POST /api/admin/dev/advance-time` | Verify or BLOCKED + follow-up note |
| P2.7 Drop economy Monte Carlo | Custom Node script: 10000 iter `effectiveDropTier()` via `dropEconomyCatalog` | `scripts/simulate-drop-economy.mjs` |
| P3.2 Inventory 1000-item perf | Admin grant + browser DevTools Performance + screen recording | Manual + recording attached |
| P3.5 E2E_FULL CI wire verify | Check `.github/workflows/e2e-full.yml` triggers, verify recent CI run | Status documented in report |

---

## Test Sequence

### Test 1 (P2.1-a) — Concurrency stress: mail claim race
- **Setup**: bootstrap admin → send 1 mail with attachment to test user X via admin send-one.
- **Action**: spawn 20 parallel `POST /api/mail/claim` for cùng mail ID.
- **Expected**: 1 request returns 200 + attachment grant; 19 return 4xx (already claimed / not found). `MailClaim` table có đúng 1 row. `CurrencyLedger` có đúng 1 grant entry. Total `linhThach` delta = attachment amount × 1.
- **Pass criteria**: 1 success / 19 reject, exactly 1 ledger row, no double grant.

### Test 2 (P2.1-b) — Concurrency stress: chat rate-limit
- **Setup**: login 5 users via cookie. Open WS connection each.
- **Action**: each user spam 20 chat msg in 1 second (100 msg/s total).
- **Expected**: WS rate-limit kick in. Mỗi user vượt rate ngưỡng nhận `chat:rate_limit` error frame. Server không crash. Message order intact cho msg pass through.
- **Pass criteria**: No 5xx, no socket crash, rate-limit error frame visible.

### Test 3 (P2.1-c) — Concurrency stress: equip race
- **Setup**: bootstrap user, admin grant 1 weapon item.
- **Action**: 10 parallel `POST /api/equipment/equip` for cùng item.
- **Expected**: 1 success, 9 reject (`ALREADY_EQUIPPED` or stale state). 1 `Equipment` row, no duplicate.
- **Pass criteria**: exactly 1 success / 9 reject, no duplicate equip slot.

### Test 4 (P2.2) — WebSocket reconnect edge
- **Setup**: `pnpm smoke:ws` baseline (must PASS 6 scenarios).
- **Action 4a**: extend with mass disconnect/reconnect — 20 socket connect + disconnect + reconnect in 5s.
- **Action 4b**: connect socket → kill API → wait 2s → restart API → verify client reconnect ≤ 5s.
- **Expected**: smoke 6/6 baseline PASS. Mass reconnect 20/20 successful re-attach. After API restart, client reconnects within 5s window.
- **Pass criteria**: smoke baseline PASS + mass reconnect PASS + post-restart reconnect ≤ 5s.

### Test 5 (P2.3) — Anti-cheat anomaly classifier coverage
- **Setup**: read `packages/shared/src/pvp.ts` `classifyPvpAnomaly()` invariants.
- **Action**: write `scripts/audit-pvp-anomaly.mjs` that calls `classifyPvpAnomaly()` with each of 8 anomaly type input → verify output severity bucket + audit log shape.
- **Expected**: 8/8 anomaly type return non-null `severity` + `recommendedAction`. Default branch returns LOW severity.
- **Pass criteria**: classifier handles all 8 + default branch correctly.
- **Note**: end-to-end via real API would require 2 player accounts + PvP setup + admin invalidate flow. Out of scope for this PR — covered in `pvp.test.ts` (12 ✓) and integration test. This audit verifies the shared catalog logic only.

### Test 6 (P2.6) — Admin advance-day
- **Action**: search code for existing `/api/admin/dev/advance-time` or equivalent.
- **Expected**: if endpoint exists → execute multi-day login smoke. If NOT exists → document as BLOCKED + follow-up.
- **Pass criteria**: either smoke runs PASS or documented BLOCKER.

### Test 7 (P2.7) — Drop economy Monte Carlo
- **Action**: write `scripts/simulate-drop-economy.mjs` running 10000 iterations of:
  - playerTier 5, sourceTier 5 → expect drop tier == 5 majority.
  - playerTier 7, sourceTier 1 → expect drop tier == 1 (clamped to min).
  - playerTier 1, sourceTier 9 → expect drop tier == 1 (clamped to min).
- **Expected**: chi-square goodness-of-fit acceptable, no leak of higher-tier item into lower-tier source.
- **Pass criteria**: 0 high-tier leak. Distribution match catalog weights.

### Test 8 (P3.2) — Inventory 1000-item perf
- **Setup**: admin grant 1000 stack items (mix tier 1-5).
- **Action**: open `/inventory` in browser DevTools Performance tab. Scroll list 10s. Record FPS / scripting time.
- **Expected**: FPS ≥ 30 during scroll. No JS errors. No frame > 100ms scripting.
- **Pass criteria**: avg FPS ≥ 30, no JS error.

### Test 9 (P3.5) — E2E_FULL CI wire verify
- **Action**: read `.github/workflows/e2e-full.yml`. Confirm triggers (workflow_dispatch + PR path filter + push to main path filter). Check recent CI run on main.
- **Expected**: workflow exists, triggers configured, recent run on main is green.
- **Pass criteria**: workflow wired + at least 1 recent green run on main.

---

## Out of scope (documented gap)

- **P2.6 Admin advance-time endpoint** — if missing, requires feature impl, NOT pure test.
- **P3.2 mobile aura/glow lag** — only desktop FPS measured; mobile FPS need real device, not in CI.
- **P2.3 end-to-end real PvP anomaly** — requires 2 player accounts + queue + admin invalidate UI. Audit shared catalog logic only.

---

## Deliverables

- This plan file at `docs/concurrency-perf-ci-test-plan.md`
- Test report at `docs/concurrency-perf-ci-test-report.md`
- Stress scripts at `scripts/stress-*.mjs` and `scripts/simulate-drop-economy.mjs`
- Optional script entries in root `package.json`:
  - `stress:concurrent-claim`
  - `stress:ws-reconnect`
  - `audit:pvp-anomaly`
  - `simulate:drop-economy`
- Inline screenshots for P3.2 inventory perf (FPS measurement)
- Screen recording for P3.2 manual test
- Draft PR with all results + CI green

---

## Recording

- Continuous recording will cover Test 8 (P3.2 inventory perf in browser) — only test requiring visual proof.
- Tests 1-7, 9 are script-based → results captured as text output in report.
