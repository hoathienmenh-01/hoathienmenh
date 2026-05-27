# Web Memory

> **Last updated:** 2026-05-27

## Role
`apps/web/` — Vue 3 frontend for Xuân Tôi game.

## Stack
- **Framework:** Vue 3 (Composition API)
- **Build:** Vite
- **State:** Pinia stores
- **Styling:** TailwindCSS
- **i18n:** vue-i18n (VI/EN parity required)
- **Monitoring:** Sentry
- **Features:** PWA support

## Common commands
```bash
pnpm --filter @xuantoi/web test        # Vitest + happy-dom
pnpm --filter @xuantoi/web build       # vue-tsc + vite build
pnpm --filter @xuantoi/web e2e         # Playwright smoke (vite preview)
```

## Key patterns
- **97 views** — most have XTLuxHero + roleHint + crossNav pattern
- **i18n parity** — all user-facing strings in both `vi.json` and `en.json`
- **No Chinese characters** — `[一-鿿]` forbidden in `apps/web/src` (Han gate enforced)
- **Shared types** — import from `@xuantoi/shared` for catalog/contracts
- **API client** — typed API clients in `apps/web/src/api/`
- **Pinia stores** — state management per domain

## Guardrails
- Run web tests when touching views/components.
- Check i18n parity when adding new UI strings.
- Run Han gate check: `rg '[一-鿿]' apps/web/src/` should return 0 matches.
- Use shared types for catalog data (items, skills, monsters, etc.).

## Source docs
- `CLAUDE.md` — quality gates
- `docs/TASK_CONTEXT_MAP.md` — when to read web docs
