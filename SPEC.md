# SPEC — Core Logger Package

**Created:** 2026-05-26  
**Status:** Draft  
**Owner:** xuantoi  

---

## 1. Overview

Tạo package `@xuantoi/logger` trong `packages/logger/` để cung cấp logging infrastructure dùng chung cho cả backend (NestJS) và frontend (Vue 3). Package này sẽ thay thế implementation hiện tại trong `apps/api/src/observability/logger.ts` và cung cấp logging cho web app.

### Goals

- **Unified logging interface** — API và Web dùng chung interface, khác nhau ở transport
- **Security by default** — Redact sensitive data (password, token, cookie, etc.)
- **Environment-aware** — JSON structured logs (production), pretty logs (dev), silent (test)
- **Zero runtime overhead** — Tree-shakeable, no dependencies cho web build
- **Type-safe** — Full TypeScript support với typed log context

### Non-goals

- Log aggregation/shipping (dùng external tools: Loki, Datadog, CloudWatch)
- Log rotation (handled by process manager hoặc container runtime)
- Distributed tracing (dùng Sentry hoặc OpenTelemetry nếu cần sau)
- Real-time log streaming UI

---

## 2. Architecture

### 2.1 Package Structure

```
packages/logger/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # LogLevel, LogContext, LoggerOptions
│   ├── redact.ts             # Redaction policy + paths + size guard
│   ├── backend/
│   │   ├── index.ts          # Backend logger (Pino-based)
│   │   └── nest-adapter.ts   # NestJS LoggerService adapter
│   └── frontend/
│       ├── index.ts          # Frontend logger (console-based)
│       └── sentry-transport.ts # Optional Sentry integration
├── package.json              # MUST include exports field for subpaths
├── tsconfig.json
├── tsup.config.ts            # Build config (dual ESM/CJS)
└── README.md
```

### 2.2 Exports

```typescript
// Main export (platform-agnostic types)
export { LogLevel, LogContext, LoggerOptions } from './types';
export { REDACT_PATHS, redactSensitiveData } from './redact';

// Backend-specific (Node.js only)
export { createBackendLogger, NestLoggerAdapter } from './backend';

// Frontend-specific (browser only)
export { createFrontendLogger } from './frontend';
```

### 2.3 Package.json Exports Configuration

**CRITICAL:** Package must define `exports` field for subpath imports to work:

```json
{
  "name": "@xuantoi/logger",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./backend": {
      "types": "./dist/backend/index.d.ts",
      "import": "./dist/backend/index.js",
      "require": "./dist/backend/index.cjs"
    },
    "./frontend": {
      "types": "./dist/frontend/index.d.ts",
      "import": "./dist/frontend/index.js",
      "require": "./dist/frontend/index.cjs"
    },
    "./types": {
      "types": "./dist/types.d.ts",
      "import": "./dist/types.js",
      "require": "./dist/types.cjs"
    },
    "./redact": {
      "types": "./dist/redact.d.ts",
      "import": "./dist/redact.js",
      "require": "./dist/redact.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

**Without this:** Imports like `@xuantoi/logger/backend` will fail with "Package subpath './backend' is not defined".

### 2.4 Dependencies

**Backend:**
- `pino` (existing, already in api/package.json)
- `pino-http` (existing, already in api/package.json)

**Frontend:**
- Zero dependencies (pure console wrapper)
- Optional: `@sentry/vue` (peer dependency, already in web/package.json)

**Shared:**
- `zod` (already in monorepo root)

---

## 3. API Design

### 3.1 Core Interface

```typescript
// types.ts
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  [key: string]: unknown;
  requestId?: string;
  userId?: string;
  characterId?: string;
  traceId?: string;
}

export interface Logger {
  trace(context: LogContext, message: string): void;
  trace(message: string): void;
  
  debug(context: LogContext, message: string): void;
  debug(message: string): void;
  
  info(context: LogContext, message: string): void;
  info(message: string): void;
  
  warn(context: LogContext, message: string): void;
  warn(message: string): void;
  
  error(context: LogContext, message: string): void;
  error(error: Error, message?: string): void;
  error(message: string): void;
  
  fatal(context: LogContext, message: string): void;
  fatal(error: Error, message?: string): void;
  fatal(message: string): void;
  
  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  redact?: boolean;
  pretty?: boolean;
  destination?: 'stdout' | 'stderr' | 'file';
  filePath?: string;
}
```

### 3.2 Backend Usage (NestJS)

```typescript
// apps/api/src/main.ts
import { createBackendLogger, NestLoggerAdapter } from '@xuantoi/logger/backend';

const logger = createBackendLogger({
  level: process.env.LOG_LEVEL as LogLevel,
  redact: true,
});

const app = await NestFactory.create(AppModule, {
  logger: new NestLoggerAdapter(logger),
});

// apps/api/src/modules/auth/auth.service.ts
import { createBackendLogger } from '@xuantoi/logger/backend';

export class AuthService {
  private readonly logger = createBackendLogger().child({ module: 'AuthService' });

  async login(username: string, password: string) {
    this.logger.info({ username }, 'User login attempt');
    // password tự động bị redact nếu log nhầm
  }
}
```

### 3.3 Frontend Usage (Vue 3)

```typescript
// apps/web/src/utils/logger.ts
import { createFrontendLogger } from '@xuantoi/logger/frontend';

export const logger = createFrontendLogger({
  level: import.meta.env.PROD ? 'warn' : 'debug',
  redact: true,
});

// apps/web/src/stores/auth.ts
import { logger } from '@/utils/logger';

export const useAuthStore = defineStore('auth', () => {
  const login = async (username: string, password: string) => {
    logger.info({ username }, 'Login attempt');
    // ...
  };
});
```

---

## 4. Redaction Policy

### 4.1 Sensitive Paths (từ existing logger.ts)

```typescript
// redact.ts
export const REDACT_PATHS = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  
  // Body / query / params (wildcard 1-level)
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  '*.creditCard',
  '*.cvv',
  
  // Top-level
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
];

// Frontend size guard to prevent UI lag on large objects
export const FRONTEND_LOG_SIZE_LIMIT = 100 * 1024; // 100KB

export function redactSensitiveData(obj: unknown): unknown {
  // Deep clone + replace matched paths với '[REDACTED]'
  // Dùng cho frontend (Pino có built-in redact)
  // MUST handle circular references (object.self = object)
  // MUST check size limit for frontend (see §4.2)
}
```

### 4.2 Redaction Behavior

- **Backend (Pino):** Dùng `pino.redact` built-in (zero overhead, compile-time)
- **Frontend:** Runtime redaction trước khi log với 2 guards:
  1. **Size guard:** Nếu serialized object > 100KB → log `"[OBJECT_TOO_LARGE: {size}KB]"` thay vì full redaction (tránh lag UI)
  2. **Circular reference guard:** Dùng `WeakSet` để track visited objects, tránh stack overflow
  3. Chỉ check top-level + 1-level nested (performance trade-off)

---

## 5. Environment Handling

| Environment | Backend (Pino) | Frontend (Console) |
|-------------|----------------|-------------------|
| **Production** | JSON structured, level=info, no pretty | level=warn, redact=true |
| **Development** | Pretty-print (pino-pretty), level=debug | level=debug, redact=false |
| **Test** | JSON, level=warn, silent nếu CI=true | level=silent |

### 5.1 Environment Variables

- `LOG_LEVEL` — override default level (trace/debug/info/warn/error/fatal)
- `LOG_PRETTY` — force pretty-print (backend only, default=auto)
- `LOG_REDACT` — force redaction on/off (default=true in prod, false in dev)

---

## 6. Migration Plan

### Phase 0: Audit Current Logger (30 min)

**BEFORE creating new package**, audit existing logger usage:

1. ✅ Inventory all logger imports across codebase
   ```bash
   rg "from ['\"].*observability/logger['\"]" apps/api/src --type ts
   rg "console\.(log|warn|error|debug)" apps/web/src --type ts --type vue
   ```
2. ✅ Document current logger API surface (methods, options, call sites)
3. ✅ Identify breaking changes (if any) between old and new API
4. ✅ List all test files that import logger (để không miss trong migration)
5. ✅ Baseline bundle size BEFORE adding logger to web:
   ```bash
   pnpm --filter @xuantoi/web build
   du -sh apps/web/dist/
   ls -lh apps/web/dist/assets/*.js | awk '{print $5, $9}'
   ```
   Record: `apps/web/dist/` = _____ MB, largest JS chunk = _____ KB
6. ✅ Document rollback plan (see §6 Phase 7)

### Phase 1: Create Package (1-2 hours)

1. ✅ Tạo `packages/logger/` structure
2. ✅ Copy + refactor `apps/api/src/observability/logger.ts` → `packages/logger/src/backend/`
3. ✅ Implement `packages/logger/src/frontend/index.ts` (console wrapper)
4. ✅ Setup tsup build config (dual ESM/CJS, subpath exports)
5. ✅ Write unit tests (redaction, level filtering)

### Phase 2: Backend Migration (1 hour)

1. ✅ Update `apps/api/package.json` — add `@xuantoi/logger` dependency
2. ✅ Replace `apps/api/src/observability/logger.ts` imports → `@xuantoi/logger/backend`
3. ✅ Update `nest-logger.adapter.ts` → use new NestLoggerAdapter
4. ✅ Run tests — ensure no regression
5. ✅ Delete old `apps/api/src/observability/logger.ts`

### Phase 3: Frontend Integration (30 min)

1. ✅ Update `apps/web/package.json` — add `@xuantoi/logger` dependency
2. ✅ Create `apps/web/src/utils/logger.ts` — export configured frontend logger
3. ✅ Replace `console.log/warn/error` → `logger.info/warn/error` (gradual, non-breaking)
4. ✅ Test in browser DevTools

### Phase 4: Documentation & Smoke Test (45 min)

1. ✅ Write `packages/logger/README.md` — usage examples, API reference
2. ✅ Update `docs/ai/CLAUDE_FULL_REFERENCE.md` — add logger section
3. ✅ Update `CLAUDE.md` — mention `@xuantoi/logger` in stack table
4. ✅ Create smoke test script `scripts/smoke-logger.mjs`:
   - Backend: log all levels (trace/debug/info/warn/error/fatal) + verify redaction
   - Frontend: import in browser console, log with context, verify size guard
   - Performance: log 1000 messages, measure time (should be < 100ms backend, < 500ms frontend)

### Phase 5: Performance & Smoke Verification (30 min)

1. ✅ Run `pnpm smoke:logger` — verify all levels work, redaction works, no errors
2. ✅ Performance benchmark:
   ```bash
   # Backend: 1000 logs should complete in < 100ms
   node scripts/benchmark-logger-backend.mjs
   
   # Frontend: 1000 logs should complete in < 500ms (browser console)
   # Open apps/web in browser, run benchmark in DevTools
   ```
3. ✅ Verify bundle size impact (compare with Phase 0 baseline):
   ```bash
   pnpm --filter @xuantoi/web build
   du -sh apps/web/dist/  # Should increase < 5KB gzipped
   ```
4. ✅ Manual smoke:
   - Backend: trigger API request, check logs in terminal (structured JSON or pretty)
   - Frontend: trigger user action, check logs in browser console
   - Verify password/token redacted in both

### Phase 6: Final Verification (15 min)

See TODO.md Phase 6 for detailed verification steps.

### Phase 7: Rollback Plan (if needed)

**Trigger rollback if:**
- CI fails > 3 times after fixes
- Bundle size increases > 10KB gzipped
- Performance regression > 20% (API response time or frontend render)
- Critical bug found in production-like environment

**Rollback steps:**
1. Revert all commits in this PR:
   ```bash
   git revert <commit-range> --no-commit
   git commit -m "Revert: rollback @xuantoi/logger migration due to <reason>"
   ```
2. Restore old logger imports:
   ```bash
   # Automated rollback script
   rg "@xuantoi/logger" apps/api/src -l | xargs sed -i "s|@xuantoi/logger/backend|./observability/logger|g"
   ```
3. Delete `packages/logger/` directory
4. Run quality gates to verify rollback clean:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
5. Document rollback reason in `docs/AI_HANDOFF_REPORT.md`

**Rollback safety:** Old `apps/api/src/observability/logger.ts` kept in git history, can restore anytime.

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
// packages/logger/src/redact.test.ts
describe('redactSensitiveData', () => {
  it('should redact top-level password', () => {
    const input = { username: 'alice', password: 'secret123' };
    const output = redactSensitiveData(input);
    expect(output).toEqual({ username: 'alice', password: '[REDACTED]' });
  });

  it('should redact nested token', () => {
    const input = { user: { id: 1, token: 'abc' } };
    const output = redactSensitiveData(input);
    expect(output).toEqual({ user: { id: 1, token: '[REDACTED]' } });
  });
});

// packages/logger/src/backend/index.test.ts
describe('createBackendLogger', () => {
  it('should create Pino instance with correct level', () => {
    const logger = createBackendLogger({ level: 'warn' });
    expect(logger.level).toBe('warn');
  });
});
```

### 7.2 Integration Tests

- **Backend:** Test NestLoggerAdapter với mock NestJS app
- **Frontend:** Test logger output trong Vitest (mock console)

### 7.3 Manual Testing

- **Backend:** Run `pnpm --filter @xuantoi/api dev` — check logs trong terminal
- **Frontend:** Run `pnpm --filter @xuantoi/web dev` — check logs trong browser console
- **Redaction:** Log object có `password` field — verify bị redact

---

## 8. Success Criteria

- [ ] Package `@xuantoi/logger` builds successfully (`pnpm --filter @xuantoi/logger build`)
- [ ] Backend logger works trong NestJS (no regression trong existing tests)
- [ ] Frontend logger works trong Vue 3 (console output correct)
- [ ] Redaction works (password/token không xuất hiện trong logs)
- [ ] Zero TypeScript errors (`pnpm typecheck`)
- [ ] Zero ESLint warnings (`pnpm lint`)
- [ ] All tests pass (`pnpm test`)
- [ ] Documentation complete (README.md + CLAUDE_FULL_REFERENCE.md updated)

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing API logs | High | Migrate incrementally, keep old logger.ts until verified |
| Frontend bundle size increase | Medium | Tree-shaking + conditional imports, measure với `vite build --report` |
| Redaction performance overhead | Low | Benchmark redaction function, optimize nếu >1ms per call |
| Pino version mismatch | Low | Pin pino version trong logger/package.json |
| Frontend log large objects (>100KB) | Low | Add size guard: if object > 100KB, log "[OBJECT_TOO_LARGE]" instead of full redaction |
| Circular reference in logged object | Medium | Use WeakSet to track visited objects, prevent stack overflow |
| Subpath imports fail in older bundlers | Medium | Verify `package.json` exports field, test import in separate file |
| Missing logger imports in test files | Low | Use `rg` without `--type` filter to catch all imports including tests |

---

## 10. Future Enhancements (Out of Scope)

- [ ] Structured log querying (dùng external tool: Loki, Elasticsearch)
- [ ] Log sampling (reduce volume trong high-traffic endpoints)
- [ ] OpenTelemetry integration (distributed tracing)
- [ ] Log encryption at rest
- [ ] Custom transports (Slack, Discord webhooks)

---

## 11. Open Questions

1. **Q:** Frontend có cần log level filtering runtime không? (VD: user toggle debug mode)  
   **A:** Defer — implement basic first, add nếu có request

2. **Q:** Backend có cần log rotation không?  
   **A:** No — Docker/systemd handle rotation, app chỉ write stdout

3. **Q:** Có cần log correlation ID (trace requests across services) không?  
   **A:** Yes — add `traceId` field trong LogContext, populate từ middleware

---

## 12. Acceptance Checklist

Trước khi merge PR:

- [ ] Code review passed (1 approver)
- [ ] All quality gates pass (typecheck, lint, build, test)
- [ ] No Chinese characters trong source code (Han gate = 0)
- [ ] `docs/AI_HANDOFF_REPORT.md` updated
- [ ] Manual testing completed (backend + frontend)
- [ ] README.md có usage examples
- [ ] No breaking changes (existing API logs still work)

---

**End of SPEC**
