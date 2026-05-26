# @xuantoi/logger

Unified logging infrastructure for Xuân Tôi (backend + frontend).

## Features

- **Unified interface** — Same Logger API for backend (NestJS) and frontend (Vue 3)
- **Security by default** — Automatic redaction of sensitive data (password, token, etc.)
- **Environment-aware** — JSON structured logs (production), pretty logs (dev), silent (test)
- **Zero runtime overhead** — Tree-shakeable, minimal dependencies
- **Type-safe** — Full TypeScript support with typed log context

## Installation

```bash
pnpm add @xuantoi/logger
```

## Usage

### Backend (NestJS)

```typescript
// apps/api/src/main.ts
import { createBackendLogger, NestLoggerAdapter } from '@xuantoi/logger/backend';

const logger = createBackendLogger({
  level: 'info',
  redact: true,
});

const app = await NestFactory.create(AppModule, {
  logger: new NestLoggerAdapter(logger),
});

// In services
import { createBackendLogger } from '@xuantoi/logger/backend';

export class AuthService {
  private readonly logger = createBackendLogger().child({ module: 'AuthService' });

  async login(username: string, password: string) {
    this.logger.info({ username }, 'User login attempt');
    // password automatically redacted if logged by mistake
  }
}
```

### Frontend (Vue 3)

```typescript
// apps/web/src/utils/logger.ts
import { createFrontendLogger } from '@xuantoi/logger/frontend';

export const logger = createFrontendLogger({
  level: import.meta.env.PROD ? 'warn' : 'debug',
  redact: true,
});

// In stores
import { logger } from '@/utils/logger';

export const useAuthStore = defineStore('auth', () => {
  const login = async (username: string, password: string) => {
    logger.info({ username }, 'Login attempt');
    // ...
  };
});
```

## API Reference

### Logger Interface

```typescript
interface Logger {
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
```

### LoggerOptions

```typescript
interface LoggerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  redact?: boolean;  // Default: true in production, false in dev
  pretty?: boolean;  // Default: true in dev (backend only)
}
```

## Redaction Policy

Sensitive fields are automatically redacted:

- **HTTP headers:** `authorization`, `cookie`, `x-api-key`, `set-cookie`
- **Body/query/params:** `password`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `creditCard`, `cvv`
- **Nested fields:** `*.password`, `*.token`, etc. (1-level deep)

Redacted values are replaced with `[REDACTED]`.

## Environment Variables

- `LOG_LEVEL` — Override default level (`trace|debug|info|warn|error|fatal`)
- `LOG_PRETTY` — Force pretty-print (backend only, default=auto)
- `LOG_REDACT` — Force redaction on/off (default=true in prod, false in dev)

## Troubleshooting

### Subpath imports not working

Ensure `package.json` has correct `exports` field:

```json
{
  "exports": {
    "./backend": {
      "types": "./dist/backend/index.d.ts",
      "import": "./dist/backend/index.js",
      "require": "./dist/backend/index.cjs"
    }
  }
}
```

### Frontend bundle size increased

Check if backend logger accidentally imported in frontend:

```bash
# Should NOT import pino in frontend
rg "from '@xuantoi/logger/backend'" apps/web/src
```

Use `@xuantoi/logger/frontend` for browser code.

## License

UNLICENSED (private package)
