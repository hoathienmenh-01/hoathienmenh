# TODO — Core Logger Package Implementation

**Created:** 2026-05-26  
**Based on:** SPEC.md  
**Estimated Total Time:** 4-5 hours (updated after audit phase added)

---

## Phase 0: Audit Current Logger (30 min)

### 0.1 Inventory Existing Logger Usage
- [ ] Run `rg "from ['\"].*observability/logger['\"]" apps/api/src --type ts` — list all backend imports
- [ ] Run `rg "console\.(log|warn|error|debug)" apps/web/src --type ts --type vue` — list all frontend console usage
- [ ] Document current logger API surface (methods, options, call sites) in a scratch file
- [ ] Identify breaking changes (if any) between old and new API
- [ ] List all test files that import logger (để không miss trong migration)

### 0.2 Baseline Bundle Size (BEFORE adding logger to web)
- [ ] Run `pnpm --filter @xuantoi/web build`
- [ ] Record `apps/web/dist/` total size: _____ MB
- [ ] Run `ls -lh apps/web/dist/assets/*.js | awk '{print $5, $9}'`
- [ ] Record largest JS chunk size: _____ KB
- [ ] Save baseline to `docs/logger-bundle-baseline.txt` for comparison in Phase 3.6

### 0.3 Document Rollback Plan
- [ ] Review SPEC.md §6 Phase 7 Rollback Plan
- [ ] Verify old `apps/api/src/observability/logger.ts` is in git history
- [ ] Prepare rollback script template (sed commands to revert imports)
- [ ] Document rollback trigger conditions (CI fail > 3x, bundle > 10KB increase, perf regression > 20%)

---

## Phase 1: Create Package Structure (1-2 hours)

### 1.1 Setup Package Scaffold
- [ ] Create `packages/logger/` directory
- [ ] Create `packages/logger/src/` directory
- [ ] Create `packages/logger/src/backend/` directory
- [ ] Create `packages/logger/src/frontend/` directory
- [ ] Create `packages/logger/package.json` with correct name `@xuantoi/logger`
- [ ] Create `packages/logger/tsconfig.json` (extend from root or copy from shared)
- [ ] Create `packages/logger/tsup.config.ts` for dual ESM/CJS build
- [ ] Create `packages/logger/README.md` (placeholder, will fill later)
- [ ] Create `packages/logger/.gitignore` (ignore `dist/`, `node_modules/`)

### 1.2 Implement Core Types
- [ ] Create `packages/logger/src/types.ts`
- [ ] Define `LogLevel` type (`'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'`)
- [ ] Define `LogContext` interface (requestId, userId, characterId, traceId, [key: string]: unknown)
- [ ] Define `Logger` interface (trace, debug, info, warn, error, fatal, child methods)
- [ ] Define `LoggerOptions` interface (level, redact, pretty, destination, filePath)
- [ ] Export all types from `types.ts`

### 1.3 Implement Redaction Module
- [ ] Create `packages/logger/src/redact.ts`
- [ ] Copy `REDACT_PATHS` array from `apps/api/src/observability/logger.ts`
- [ ] Define `FRONTEND_LOG_SIZE_LIMIT = 100 * 1024` (100KB)
- [ ] Implement `redactSensitiveData(obj: unknown): unknown` function
  - [ ] Handle top-level keys (password, token, apiKey, secret, etc.)
  - [ ] Handle 1-level nested keys (*.password, *.token, etc.)
  - [ ] Handle array of objects
  - [ ] **Handle circular references** — use `WeakSet` to track visited objects, prevent stack overflow
  - [ ] **Frontend size guard** — if serialized object > 100KB, return `"[OBJECT_TOO_LARGE: {size}KB]"`
  - [ ] Return deep clone with redacted values replaced by `'[REDACTED]'`
- [ ] Export `REDACT_PATHS`, `FRONTEND_LOG_SIZE_LIMIT`, and `redactSensitiveData`

### 1.4 Implement Backend Logger (Pino-based)
- [ ] Create `packages/logger/src/backend/index.ts`
- [ ] Add `pino` and `pino-http` to `packages/logger/package.json` dependencies
- [ ] Copy `buildLoggerOptions()` from `apps/api/src/observability/logger.ts`
- [ ] Implement `createBackendLogger(options?: LoggerOptions): Logger`
  - [ ] Create Pino instance with redact config
  - [ ] Handle environment-based defaults (prod=info, dev=debug, test=warn)
  - [ ] Handle `LOG_LEVEL`, `LOG_PRETTY`, `LOG_REDACT` env vars
  - [ ] Return Pino instance wrapped as Logger interface
- [ ] Export `createBackendLogger`

### 1.5 Implement NestJS Adapter
- [ ] Create `packages/logger/src/backend/nest-adapter.ts`
- [ ] Copy `NestLoggerAdapter` from `apps/api/src/observability/nest-logger.adapter.ts`
- [ ] Update imports to use `@xuantoi/logger` types
- [ ] Implement NestJS `LoggerService` interface
  - [ ] Map `log()` → `info()`
  - [ ] Map `error()` → `error()`
  - [ ] Map `warn()` → `warn()`
  - [ ] Map `debug()` → `debug()`
  - [ ] Map `verbose()` → `trace()`
- [ ] Export `NestLoggerAdapter`

### 1.6 Implement Frontend Logger (Console-based)
- [ ] Create `packages/logger/src/frontend/index.ts`
- [ ] Implement `createFrontendLogger(options?: LoggerOptions): Logger`
  - [ ] Wrap `console.trace/debug/log/warn/error` methods
  - [ ] Apply redaction if `options.redact === true`
  - [ ] Filter by log level (skip logs below configured level)
  - [ ] Handle `import.meta.env.PROD` for default level
  - [ ] Implement `child(bindings)` to return new logger with merged context
  - [ ] Format output: `[LEVEL] message {context}`
- [ ] Export `createFrontendLogger`

### 1.7 Implement Main Entry Point
- [ ] Create `packages/logger/src/index.ts`
- [ ] Re-export types from `./types`
- [ ] Re-export redaction from `./redact`
- [ ] Add comment: "Import backend/frontend from subpaths"

### 1.8 Configure Build System
- [ ] Update `packages/logger/tsup.config.ts`
  - [ ] Add entry points: `src/index.ts`, `src/backend/index.ts`, `src/frontend/index.ts`
  - [ ] Configure dual format: ESM + CJS
  - [ ] Enable declaration files (`.d.ts`)
  - [ ] Set target to `es2022`
- [ ] Update `packages/logger/package.json` exports (CRITICAL for subpath imports)
  - [ ] Add `"type": "module"`
  - [ ] Add `"exports"` field with full subpath definitions:
    - [ ] `"."` → `{ types, import, require }` for main entry
    - [ ] `"./backend"` → `{ types, import, require }` for backend
    - [ ] `"./frontend"` → `{ types, import, require }` for frontend
    - [ ] `"./types"` → `{ types, import, require }` for types
    - [ ] `"./redact"` → `{ types, import, require }` for redact
  - [ ] Add `"main"`, `"module"`, `"types"` fields for legacy compatibility
  - [ ] **Verify exports field matches SPEC.md §2.3 exactly**
- [ ] Add scripts to `packages/logger/package.json`
  - [ ] `"build": "tsup"`
  - [ ] `"dev": "tsup --watch"`
  - [ ] `"typecheck": "tsc --noEmit"`
  - [ ] `"test": "vitest run"`

### 1.9 Write Unit Tests
- [ ] Create `packages/logger/src/redact.test.ts`
  - [ ] Test redact top-level password
  - [ ] Test redact nested token (1-level)
  - [ ] Test redact array of objects with secrets
  - [ ] Test no redaction for safe fields (username, id, etc.)
  - [ ] Test empty object / null / undefined handling
  - [ ] **Test circular reference handling** — `obj.self = obj` should NOT stack overflow
  - [ ] **Test size guard** — object > 100KB should return `"[OBJECT_TOO_LARGE: XKB]"`
- [ ] Create `packages/logger/src/backend/index.test.ts`
  - [ ] Test `createBackendLogger()` returns Pino instance
  - [ ] Test log level configuration
  - [ ] Test redaction enabled by default in production
  - [ ] Test environment variable overrides (LOG_LEVEL, LOG_REDACT)
- [ ] Create `packages/logger/src/frontend/index.test.ts`
  - [ ] Test `createFrontendLogger()` returns Logger interface
  - [ ] Test log level filtering (debug logs skipped when level=info)
  - [ ] Test redaction works in frontend
  - [ ] Test `child()` merges context correctly
  - [ ] Mock console methods to verify output
  - [ ] **Test size guard triggers** — log large object should call size guard

### 1.10 Build and Verify Package
- [ ] Run `pnpm install` at root (link workspace packages)
- [ ] Run `pnpm --filter @xuantoi/logger build`
- [ ] Verify `packages/logger/dist/` contains:
  - [ ] `index.js`, `index.cjs`, `index.d.ts`
  - [ ] `backend/index.js`, `backend/index.cjs`, `backend/index.d.ts`
  - [ ] `frontend/index.js`, `frontend/index.cjs`, `frontend/index.d.ts`
  - [ ] `types.js`, `types.cjs`, `types.d.ts`
  - [ ] `redact.js`, `redact.cjs`, `redact.d.ts`
- [ ] **Test subpath imports work** — create test file `packages/logger/test-imports.mjs`:
  ```javascript
  import { createBackendLogger } from '@xuantoi/logger/backend';
  import { createFrontendLogger } from '@xuantoi/logger/frontend';
  console.log('Subpath imports OK');
  ```
  - [ ] Run `node packages/logger/test-imports.mjs` (should NOT error "subpath not defined")
- [ ] Run `pnpm --filter @xuantoi/logger typecheck` (should pass)
- [ ] Run `pnpm --filter @xuantoi/logger test` (all tests pass)

---

## Phase 2: Backend Migration (1 hour)

### 2.1 Update API Dependencies
- [ ] Add `@xuantoi/logger` to `apps/api/package.json` dependencies
  - [ ] `"@xuantoi/logger": "workspace:*"`
- [ ] Run `pnpm install` at root

### 2.2 Migrate Main Entry Point
- [ ] Open `apps/api/src/main.ts`
- [ ] Replace `import { getLogger } from './observability/logger'` 
  - [ ] → `import { createBackendLogger } from '@xuantoi/logger/backend'`
- [ ] Replace `getLogger()` calls → `createBackendLogger()`
- [ ] Update NestLoggerAdapter import
  - [ ] → `import { NestLoggerAdapter } from '@xuantoi/logger/backend'`

### 2.3 Migrate Observability Module
- [ ] Open `apps/api/src/observability/nest-logger.adapter.ts`
- [ ] Update imports to use `@xuantoi/logger/backend`
- [ ] Verify no local logger.ts imports remain
- [ ] Open `apps/api/src/observability/request-logger.middleware.ts`
- [ ] Replace logger imports → `@xuantoi/logger/backend`

### 2.4 Find and Replace All Logger Imports
- [ ] **Use `rg` (ripgrep) to catch ALL imports** — including test files, type imports, re-exports:
  ```bash
  rg "from ['\"].*observability/logger['\"]" apps/api/src --type ts
  ```
- [ ] Replace all occurrences → `from '@xuantoi/logger/backend'`
- [ ] **Check for type-only imports:**
  ```bash
  rg "import type.*from ['\"].*observability/logger['\"]" apps/api/src --type ts
  ```
- [ ] Replace type imports → `import type { ... } from '@xuantoi/logger/backend'`
- [ ] **Check for re-exports:**
  ```bash
  rg "export.*from ['\"].*observability/logger['\"]" apps/api/src --type ts
  ```
- [ ] Replace re-exports → `export { ... } from '@xuantoi/logger/backend'`
- [ ] Run `rg 'getLogger' apps/api/src --type ts` 
- [ ] Replace `getLogger()` → `createBackendLogger()`
- [ ] **Verify no missed imports:**
  ```bash
  rg "observability/logger" apps/api/src --type ts
  # Should return 0 results after migration
  ```

### 2.5 Run Quality Gates
- [ ] Run `pnpm --filter @xuantoi/shared build` (dependency)
- [ ] Run `pnpm --filter @xuantoi/logger build` (dependency)
- [ ] Run `pnpm --filter @xuantoi/api typecheck` (should pass)
- [ ] Run `pnpm --filter @xuantoi/api lint` (should pass, 0 warnings)
- [ ] Run `pnpm --filter @xuantoi/api test` (all tests pass, no regression)

### 2.6 Manual Testing
- [ ] Run `pnpm infra:up` (start Postgres + Redis)
- [ ] Run `pnpm --filter @xuantoi/api dev`
- [ ] Verify logs appear in terminal (structured JSON or pretty format)
- [ ] Make API request (e.g., `curl http://localhost:3000/health`)
- [ ] Verify request logs contain requestId, method, url, statusCode
- [ ] Check no sensitive data leaked (password, token, cookie redacted)

### 2.7 Cleanup Old Logger Files
- [ ] Delete `apps/api/src/observability/logger.ts` (migrated to package)
- [ ] Delete `apps/api/src/observability/logger.test.ts` (migrated to package)
- [ ] Keep `apps/api/src/observability/nest-logger.adapter.ts` if still needed
  - [ ] OR delete if migrated to `@xuantoi/logger/backend`
- [ ] Keep `apps/api/src/observability/request-logger.middleware.ts` (still needed)

---

## Phase 3: Frontend Integration (30 min)

### 3.1 Update Web Dependencies
- [ ] Add `@xuantoi/logger` to `apps/web/package.json` dependencies
  - [ ] `"@xuantoi/logger": "workspace:*"`
- [ ] Run `pnpm install` at root

### 3.2 Create Frontend Logger Utility
- [ ] Create `apps/web/src/utils/logger.ts`
- [ ] Import `createFrontendLogger` from `@xuantoi/logger/frontend`
- [ ] Create and export configured logger instance
  - [ ] Set level based on `import.meta.env.PROD` (prod=warn, dev=debug)
  - [ ] Enable redaction in production
- [ ] Export logger as default or named export

### 3.3 Replace Console Calls (Gradual, Non-Breaking)
- [ ] Find console.log/warn/error in critical paths (auth, API calls)
- [ ] Replace with `logger.info/warn/error` (keep same message format)
- [ ] Examples:
  - [ ] `apps/web/src/stores/auth.ts` — login/logout logs
  - [ ] `apps/web/src/api/client.ts` — API error logs
  - [ ] `apps/web/src/router/index.ts` — navigation errors
- [ ] Leave non-critical console.log as-is (can migrate later)

### 3.4 Run Quality Gates
- [ ] Run `pnpm --filter @xuantoi/web typecheck` (should pass)
- [ ] Run `pnpm --filter @xuantoi/web lint` (should pass, 0 warnings)
- [ ] Run `pnpm --filter @xuantoi/web test` (all tests pass)
- [ ] Run `pnpm --filter @xuantoi/web build` (should succeed)

### 3.5 Manual Testing in Browser
- [ ] Run `pnpm --filter @xuantoi/web dev`
- [ ] Open browser DevTools Console
- [ ] Trigger login flow — verify logs appear with correct format
- [ ] Check log level filtering works (debug logs only in dev mode)
- [ ] Verify redaction works (password field not visible in logs)
- [ ] Test in production build (`pnpm --filter @xuantoi/web build && pnpm --filter @xuantoi/web preview`)

### 3.6 Measure Bundle Size Impact
- [ ] Run `pnpm --filter @xuantoi/web build`
- [ ] Compare with Phase 0 baseline (from `docs/logger-bundle-baseline.txt`):
  - [ ] Total `apps/web/dist/` size: baseline _____ MB → now _____ MB (delta: _____ KB)
  - [ ] Largest JS chunk: baseline _____ KB → now _____ KB (delta: _____ KB)
- [ ] Run `pnpm --filter @xuantoi/web build -- --report` (Vite bundle analyzer)
- [ ] Verify tree-shaking works (frontend logger should be <2KB gzipped)
- [ ] **If bundle size increased >5KB**, investigate and optimize:
  - [ ] Check if backend logger accidentally imported in frontend
  - [ ] Check if Pino dependencies leaked into frontend bundle
  - [ ] Consider dynamic import for logger if needed

---

## Phase 4: Documentation & Smoke Test (45 min)

### 4.1 Write Package README
- [ ] Open `packages/logger/README.md`
- [ ] Add package overview (purpose, features)
- [ ] Add installation instructions (`pnpm add @xuantoi/logger`)
- [ ] Add backend usage example (NestJS)
- [ ] Add frontend usage example (Vue 3)
- [ ] Add API reference (Logger interface, LoggerOptions)
- [ ] Add redaction policy explanation
- [ ] Add environment variables table (LOG_LEVEL, LOG_PRETTY, LOG_REDACT)
- [ ] Add troubleshooting section (common issues)

### 4.2 Update Project Documentation
- [ ] Open `docs/ai/CLAUDE_FULL_REFERENCE.md`
- [ ] Add new section: "Logging Infrastructure"
  - [ ] Mention `@xuantoi/logger` package
  - [ ] Explain backend vs frontend logger
  - [ ] Document redaction policy
  - [ ] Add usage examples
- [ ] Update "Observability" section if exists

### 4.3 Update CLAUDE.md
- [ ] Open `CLAUDE.md`
- [ ] Update Stack table — add `@xuantoi/logger` to Shared row
  - [ ] `Shared | packages/shared + packages/logger — Pure TS catalog/balance/types/logging`
- [ ] Add to Commands section if needed (no new commands for logger)

### 4.4 Update AI Handoff Report
- [ ] Open `docs/AI_HANDOFF_REPORT.md`
- [ ] Add entry for Core Logger Package implementation
  - [ ] Date: 2026-05-26
  - [ ] Summary: Created `@xuantoi/logger` package, migrated backend, integrated frontend
  - [ ] Files changed: `packages/logger/*`, `apps/api/src/observability/*`, `apps/web/src/utils/logger.ts`
  - [ ] Breaking changes: None (backward compatible)
  - [ ] Next steps: Gradual migration of remaining console.log calls

---

## Phase 5: Performance & Smoke Verification (30 min)

### 5.1 Create Smoke Test Script
- [ ] Create `scripts/smoke-logger.mjs` (Node 20 native fetch, zero-install)
- [ ] Backend smoke:
  - [ ] Log all levels (trace/debug/info/warn/error/fatal)
  - [ ] Log object with password field → verify `[REDACTED]` in output
  - [ ] Log nested object with token → verify `[REDACTED]`
  - [ ] Log circular reference object → verify no crash
- [ ] Frontend smoke (manual in browser):
  - [ ] Open `apps/web` in browser DevTools
  - [ ] Import logger: `import { createFrontendLogger } from '@xuantoi/logger/frontend'`
  - [ ] Log with context: `logger.info({ userId: 123 }, 'Test message')`
  - [ ] Log large object (>100KB) → verify `[OBJECT_TOO_LARGE]` message
  - [ ] Log object with password → verify `[REDACTED]`
- [ ] Add `pnpm smoke:logger` script to root `package.json`

### 5.2 Performance Benchmark
- [ ] Create `scripts/benchmark-logger-backend.mjs`
  - [ ] Log 1000 messages with context
  - [ ] Measure time (should be < 100ms)
  - [ ] If > 100ms, profile and optimize
- [ ] Frontend benchmark (manual in browser):
  - [ ] Open browser DevTools Console
  - [ ] Run: `console.time('logger'); for(let i=0; i<1000; i++) logger.info({i}, 'test'); console.timeEnd('logger');`
  - [ ] Should complete in < 500ms
  - [ ] If > 500ms, check redaction overhead
- [ ] Document benchmark results in PR description

### 5.3 Manual Smoke Test
- [ ] Run `pnpm infra:up` (start Postgres + Redis)
- [ ] Run `pnpm --filter @xuantoi/api dev`
- [ ] Make API request: `curl http://localhost:3000/health`
- [ ] Verify logs appear in terminal (structured JSON or pretty format)
- [ ] Verify requestId, method, url, statusCode present
- [ ] Check no sensitive data leaked (password, token, cookie redacted)
- [ ] Run `pnpm --filter @xuantoi/web dev`
- [ ] Open browser, trigger user action (login, navigation)
- [ ] Check logs in browser console
- [ ] Verify password/token redacted in frontend logs

---

## Phase 6: Final Verification (15 min)

### 6.1 Run Full Quality Gates
- [ ] Run `pnpm --filter @xuantoi/shared build`
- [ ] Run `pnpm --filter @xuantoi/logger build`
- [ ] Run `pnpm typecheck` (all workspaces)
- [ ] Run `pnpm lint` (all workspaces, 0 warnings)
- [ ] Run `pnpm build` (all workspaces)
- [ ] Run `pnpm test` (all workspaces, all tests pass)

### 6.2 Manual End-to-End Testing
- [ ] Start infrastructure: `pnpm infra:up`
- [ ] Start API: `pnpm --filter @xuantoi/api dev`
- [ ] Start Web: `pnpm --filter @xuantoi/web dev`
- [ ] Test full user flow (register → login → game action)
- [ ] Verify logs in API terminal (structured, redacted)
- [ ] Verify logs in browser console (formatted, redacted)
- [ ] Check no errors in console or terminal

### 6.3 Check Success Criteria (from SPEC.md)
- [ ] Package `@xuantoi/logger` builds successfully
- [ ] Backend logger works in NestJS (no regression)
- [ ] Frontend logger works in Vue 3 (console output correct)
- [ ] Redaction works (password/token not visible)
- [ ] Zero TypeScript errors
- [ ] Zero ESLint warnings
- [ ] All tests pass
- [ ] Documentation complete

### 6.4 Git Commit Preparation
- [ ] Review all changed files with `git status`
- [ ] Stage package files: `git add packages/logger/`
- [ ] Stage API changes: `git add apps/api/src/observability/` (if modified)
- [ ] Stage Web changes: `git add apps/web/src/utils/logger.ts`
- [ ] Stage docs: `git add docs/ CLAUDE.md`
- [ ] Verify no secrets in staged files
- [ ] Verify no Chinese characters in `apps/web/src` (Han gate)

---

## Phase 7: Rollback Plan (if needed)

### 7.1 Rollback Trigger Conditions
- [ ] CI fails > 3 times after fixes
- [ ] Bundle size increases > 10KB gzipped (compare with Phase 0 baseline)
- [ ] Performance regression > 20% (API response time or frontend render)
- [ ] Critical bug found in production-like environment

### 7.2 Rollback Steps (if triggered)
- [ ] Revert all commits in this PR:
  ```bash
  git revert <commit-range> --no-commit
  git commit -m "Revert: rollback @xuantoi/logger migration due to <reason>"
  ```
- [ ] Restore old logger imports (automated):
  ```bash
  rg "@xuantoi/logger/backend" apps/api/src -l | xargs sed -i "s|@xuantoi/logger/backend|./observability/logger|g"
  rg "createBackendLogger" apps/api/src -l | xargs sed -i "s|createBackendLogger|getLogger|g"
  ```
- [ ] Delete `packages/logger/` directory:
  ```bash
  rm -rf packages/logger
  ```
- [ ] Run quality gates to verify rollback clean:
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
- [ ] Document rollback reason in `docs/AI_HANDOFF_REPORT.md`
- [ ] Notify team in PR comment with rollback reason + next steps

### 7.3 Rollback Safety Verification
- [ ] Verify old `apps/api/src/observability/logger.ts` exists in git history
- [ ] Test rollback script on a separate branch before using in emergency
- [ ] Keep rollback script in `scripts/rollback-logger-migration.sh` for quick access

---

## Acceptance Checklist (Before PR)

- [ ] Code review passed (1 approver) — SKIP for now, will do in PR
- [ ] All quality gates pass (typecheck, lint, build, test) ✓
- [ ] No Chinese characters in source code (Han gate = 0) ✓
- [ ] `docs/AI_HANDOFF_REPORT.md` updated ✓
- [ ] Manual testing completed (backend + frontend) ✓
- [ ] README.md has usage examples ✓
- [ ] No breaking changes (existing API logs still work) ✓

---

## Notes

- **Estimated time:** 4-5 hours total (updated after adding Phase 0 audit + Phase 5 smoke/perf + Phase 7 rollback)
- **Can be done incrementally:** Each phase is independent
- **Rollback plan:** Automated script in Phase 7, old logger.ts in git history
- **Risk mitigation:** Run tests after each phase, smoke test before merge, performance benchmark
- **Critical checkpoints:**
  - Phase 0: Baseline bundle size recorded
  - Phase 1.8: Subpath imports verified
  - Phase 1.9: Circular reference + size guard tests pass
  - Phase 2.4: No missed imports (rg returns 0 results)
  - Phase 3.6: Bundle size delta < 5KB
  - Phase 5.2: Performance benchmarks pass (backend < 100ms, frontend < 500ms)

---

**End of TODO**
