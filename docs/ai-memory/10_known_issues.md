# Known Issues Memory

> **Last updated:** 2026-05-27

## Active blockers

### API Build — 1228 Pre-existing Prisma Type Errors
- **Issue:** API build has 1228 pre-existing Prisma type errors.
- **Impact:** Does not block functionality, but pollutes typecheck output.
- **Status:** Documented, separate fix needed.
- **Verify:** `pnpm --filter @xuantoi/api exec tsc --noEmit` shows 1228 errors.
- **Note:** These errors are NOT related to recent logger package changes (PR #682) or Loki/Grafana logging stack.

### Chat Rate-Limit Test Flaky in CI
- **Issue:** `chat.service.test.ts` sliding-window rate-limit test is flaky in CI (timing-dependent).
- **Impact:** CI occasionally fails on this test.
- **Status:** Task #39 (Phase 9 Beta Hardening Pack) sub-gap 1 to fix.
- **Verify:** Check CI runs for `chat.service.test.ts` failures.
- **Fix:** Mock `Date.now` or use fake timers to make test timing-independent.

### i18n EN/VI Parity Not Enforced
- **Issue:** i18n EN/VI parity not enforced by lint — drift risk.
- **Impact:** EN and VI translations can drift out of sync.
- **Status:** Task #39 (Phase 9 Beta Hardening Pack) sub-gap 2 to fix.
- **Verify:** Manual check or run `scripts/check-i18n-parity.mjs` (to be created).
- **Fix:** Add `scripts/check-i18n-parity.mjs` + wire into `pnpm lint` or CI.

### E2E_FULL Gate Not Wired in CI
- **Issue:** Playwright golden path has 22 specs but only spec #1 runs in CI. E2E_FULL gate not wired.
- **Impact:** Most E2E specs not running in CI.
- **Status:** Task #42 (Playwright E2E Full-Stack Gate) sub-gap 4 to fix.
- **Verify:** Check `.github/workflows/ci.yml` for E2E_FULL gate.
- **Fix:** Wire E2E_FULL gate in CI for specs #23-25 (and eventually all specs).

---

## Resolved issues
None recently.

---

## How to verify
For each issue, include command/file to verify.

## Notes
- Keep this file focused on **confirmed active blockers**, not task progress.
- For task progress, see `docs/FEATURE_PROGRESS_TRACKER.md`.
- For decisions, see `09_decisions.md`.
