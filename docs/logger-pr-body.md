# Core Logger Package — PR Body

## Summary

Add unified logging infrastructure package `@xuantoi/logger` with backend (Pino) and frontend (Console) implementations. Replaces old logger in API bootstrap and console calls in web app with structured, redaction-aware logging.

## Changes

### New Package: `packages/logger/`
- **Backend logger**: Pino-based structured JSON logging with environment-aware defaults
- **Frontend logger**: Console-based logging with level filtering and redaction
- **NestJS adapter**: `NestLoggerAdapter` for seamless NestJS integration
- **Redaction**: 31 sensitive paths (password, token, cookie, email, etc.) with circular ref guard and 100KB size limit
- **Build**: Dual ESM/CJS with TypeScript declarations
- **Tests**: 37 passing tests (14 redaction + 12 backend + 11 frontend)

### API Integration
- `apps/api/package.json`: Added `@xuantoi/logger` dependency
- `apps/api/src/main.ts`: Replaced old logger with `createBackendLogger()` + `NestLoggerAdapter`

### Web Integration
- `apps/web/package.json`: Added `@xuantoi/logger` dependency
- `apps/web/src/utils/logger.ts`: Configured frontend logger (warn in prod, debug in dev)
- `apps/web/src/lib/sentry.ts`: Replaced 3 console calls with logger
- `apps/web/src/ws/client.ts`: Replaced 2 console calls with logger

### Documentation
- `docs/logger-audit-phase0.md`: Initial audit
- `docs/logger-phase-a-verification.md`: Backend migration verification
- `docs/logger-implementation-progress.md`: Progress tracker
- `docs/logger-phase-d-final-verification.md`: Final quality gates
- `docs/logger-final-handoff-report.md`: Complete handoff report
- `docs/AI_HANDOFF_REPORT.md`: Updated executive summary

### Smoke Tests
- `scripts/smoke-logger.mjs`: Comprehensive smoke test
- `scripts/smoke-logger-simple.mjs`: Simplified smoke test

## Test Plan

### Unit Tests
```bash
pnpm --filter @xuantoi/logger test
# Result: 37/37 PASS (redaction 14, backend 12, frontend 11)
```

### Smoke Test
```bash
NODE_ENV=production node scripts/smoke-logger-simple.mjs
# Result: PASS
# - Backend logger (Pino): ✓
# - Frontend logger (Console): ✓
# - NestLoggerAdapter: ✓
# - Child logger: ✓
```

### Build Verification
```bash
pnpm --filter @xuantoi/logger build
# Result: PASS (ESM + CJS + DTS)

pnpm --filter @xuantoi/web build
# Result: PASS (30.96s, 555.62 kB gzipped)
```

### Typecheck
```bash
pnpm --filter @xuantoi/logger typecheck
# Result: PASS (0 errors)

pnpm --filter @xuantoi/web typecheck
# Result: PASS (0 errors)

pnpm --filter @xuantoi/api typecheck
# Result: FAIL (1228 pre-existing Prisma type errors, 0 logger-related)
```

### Lint
```bash
pnpm lint
# Result: PASS (0 warnings)
```

### Whitespace Check
```bash
git diff --check
# Result: PASS (no trailing whitespace)
```

## Bundle Size Impact

**Web bundle**: 555.62 kB gzipped (logger impact minimal, tree-shaken in production)

**Logger package**:
- Backend: ~3KB (ESM), ~4KB (CJS)
- Frontend: ~5KB (ESM), ~6KB (CJS)

## Known Blockers

### ⚠️ API Build Failure (Pre-existing)
**Issue**: API build fails with 1228 TypeScript errors  
**Cause**: Prisma client type issues (Role, CurrencyKind, InputJsonValue, etc.)  
**Evidence**: 0 errors mention `@xuantoi/logger` or logger imports  
**Impact**: Does NOT affect logger functionality (logger works in runtime, verified via smoke test)  
**Status**: Documented in `docs/logger-phase-a-verification.md`  
**Resolution**: Requires separate PR to regenerate Prisma client (out of scope for logger)

## Rollback Notes

If rollback is needed:

1. **Revert commits**:
   ```bash
   git revert 577ff89f 59cfc44a 5ee5b44a 1d0caf28 b027cfbe
   ```

2. **Restore old logger in API** (if needed):
   ```typescript
   // apps/api/src/main.ts
   import { getLogger } from './observability/logger';
   import { PinoNestLogger } from './observability/nest-logger.adapter';
   const logger = getLogger();
   app.useLogger(new PinoNestLogger(logger));
   ```

3. **Remove logger dependency**:
   ```bash
   pnpm --filter @xuantoi/api remove @xuantoi/logger
   pnpm --filter @xuantoi/web remove @xuantoi/logger
   ```

4. **Restore console calls in web** (if needed):
   - `apps/web/src/lib/sentry.ts`: 3 logger calls → console
   - `apps/web/src/ws/client.ts`: 2 logger calls → console

## Risk Assessment

**Overall Risk: LOW**

✅ **Safe to merge**:
- Additive package, no breaking changes
- 0 logger-related TypeScript errors
- All logger functionality verified via tests and smoke test
- Web build successful with minimal bundle impact
- No gameplay logic changes
- No schema migration
- No economy changes
- No changes to sect/market/boss/story systems

⚠️ **API build blocker**:
- Pre-existing Prisma type errors (not caused by logger)
- Does not affect logger functionality
- Requires separate fix (Prisma client regeneration)

## Migration Path

### For Backend Code (Future)
```typescript
// OLD:
import { getLogger } from './observability/logger';
const logger = getLogger();

// NEW:
import { createBackendLogger } from '@xuantoi/logger/backend';
const logger = createBackendLogger();
```

### For Frontend Code (Future)
```typescript
// OLD:
console.log('[component] message');
console.warn('[component] warning', error);

// NEW:
import { logger } from '@/utils/logger';
logger.info('[component] message');
logger.warn({ error }, '[component] warning');
```

## Verification Checklist

- [x] Logger package builds successfully
- [x] Logger tests pass (37/37)
- [x] Smoke test passes
- [x] Web typecheck passes
- [x] Web build passes
- [x] Lint passes (0 warnings)
- [x] No trailing whitespace
- [x] No schema changes
- [x] No gameplay/economy changes
- [x] Documentation complete
- [x] API build blocker documented as pre-existing

## Related Documentation

- `docs/logger-final-handoff-report.md` — Complete implementation report
- `docs/logger-phase-d-final-verification.md` — Quality gates results
- `docs/logger-implementation-progress.md` — Phase-by-phase progress
- `docs/logger-phase-a-verification.md` — Backend migration verification with API blocker evidence
- `docs/logger-audit-phase0.md` — Initial audit results
