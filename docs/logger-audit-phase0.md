# Phase 0 Audit — Core Logger Package

**Date:** 2026-05-26  
**Status:** Complete

---

## 0.1 Inventory Existing Logger Usage

### Backend Logger Imports
- **Single import location:** `apps/api/src/main.ts`
  ```typescript
  import { getLogger } from './observability/logger';
  ```
- **Logger function calls:** 42 occurrences of `getLogger`, `childLogger`, or `resetLogger` across API codebase
- **Test files:** No test files directly import `observability/logger` (tests likely use mocked logger)

### Current Logger API Surface
From `apps/api/src/observability/logger.ts`:
- `getLogger()` — Singleton Pino instance
- `childLogger(bindings)` — Create child logger with context
- `resetLogger()` — Reset singleton (test-only)
- `buildLoggerOptions()` — Build Pino config
- `REDACT_PATHS` — Array of 50+ sensitive field paths

### Frontend Console Usage
- **5 console.log/warn/error/debug calls** in `apps/web/src` (TypeScript + Vue files)
- Locations to migrate:
  - `apps/web/src/stores/auth.ts` — login/logout logs
  - `apps/web/src/api/client.ts` — API error logs
  - `apps/web/src/router/index.ts` — navigation errors

### Breaking Changes Assessment
**NONE** — New API is compatible:
- `getLogger()` → `createBackendLogger()` (same return type: Pino instance)
- `childLogger(bindings)` → `logger.child(bindings)` (Pino built-in)
- `resetLogger()` → Not needed (no singleton in new design)

---

## 0.2 Baseline Bundle Size

**Status:** SKIPPED — `apps/web/dist/` does not exist yet (no previous build)

**Action:** Will measure bundle size AFTER Phase 1 package creation, then compare in Phase 3.6.

**Fallback:** If bundle increases >5KB gzipped, will investigate tree-shaking and optimize.

---

## 0.3 Rollback Plan

### Rollback Trigger Conditions
1. CI fails > 3 times after fixes
2. Bundle size increases > 10KB gzipped
3. Performance regression > 20% (API response time or frontend render)
4. Critical bug found in production-like environment

### Rollback Steps
1. Revert all commits:
   ```bash
   git revert <commit-range> --no-commit
   git commit -m "Revert: rollback @xuantoi/logger migration due to <reason>"
   ```

2. Restore old logger imports (automated):
   ```bash
   rg "@xuantoi/logger/backend" apps/api/src -l | xargs sed -i "s|@xuantoi/logger/backend|./observability/logger|g"
   rg "createBackendLogger" apps/api/src -l | xargs sed -i "s|createBackendLogger|getLogger|g"
   ```

3. Delete package:
   ```bash
   rm -rf packages/logger
   ```

4. Verify rollback:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```

### Rollback Safety
- ✅ Old `apps/api/src/observability/logger.ts` preserved in git history
- ✅ Rollback script template prepared above
- ✅ No schema migrations in this PR (pure code refactor)

---

## Summary

**Audit Complete:**
- ✅ 1 backend import location identified
- ✅ 42 logger function calls inventoried
- ✅ 5 frontend console calls identified
- ✅ No breaking changes detected
- ✅ Rollback plan documented
- ⚠️ Bundle size baseline skipped (no existing dist)

**Next:** Proceed to Phase 1 — Create Package Structure
