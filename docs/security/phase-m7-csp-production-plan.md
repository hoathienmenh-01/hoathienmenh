# Phase M7 — Fix CSP Production CDN domains (Plan)

## Mục tiêu

Production CSP **không chặn** CDN / API / WebSocket / PWA assets hợp lệ mà vẫn an toàn — không mở `*` / `'unsafe-inline'` / `'unsafe-eval'` / wildcard scheme.

## Non-goals

- KHÔNG đụng StoryV2 UI / runtime.
- KHÔNG đụng CORS policy (CORS_ORIGINS độc lập).
- KHÔNG implement nonce-based scripts (yêu cầu rework FE).
- KHÔNG disable CSP ở production (chỉ cho phép `CSP_REPORT_ONLY=1` cho rollout).

## Files thay đổi

| File | Type | Mô tả |
|---|---|---|
| `apps/api/src/security/csp-config.ts` | New | Pure CSP builder + validator. |
| `apps/api/src/security/csp-config.test.ts` | New | Vitest 25 test cases. |
| `apps/api/src/bootstrap-config.ts` | Modify | `helmetConfig()` wire vào `buildCspDirectives()`. |
| `apps/api/.env.example` | Modify | Add 10 env vars M7 (commented opt-in). |
| `docs/security/csp-production-runbook.md` | New | Rollout phase 1 → 2 → 3, verify, troubleshooting. |
| `docs/security/phase-m7-csp-production-plan.md` | New | This file. |

## Env vars

| Var | Required | Default | Đi vào |
|---|---|---|---|
| `WEB_PUBLIC_CDN_ORIGIN` | no | — | script/style/img/font/worker/manifest/media-src |
| `WEB_ASSET_CDN_ORIGINS` | no | — | same (csv) |
| `API_PUBLIC_ORIGIN` | no | — | connect-src |
| `WS_PUBLIC_ORIGIN` | no | — | connect-src |
| `CSP_EXTRA_CONNECT_SRC` | no | — | connect-src csv |
| `CSP_EXTRA_IMG_SRC` | no | — | img-src csv (cho phép `data:`) |
| `CSP_EXTRA_SCRIPT_SRC` | no | — | script-src csv (cho phép keyword) |
| `CSP_EXTRA_STYLE_SRC` | no | — | style-src csv |
| `CSP_EXTRA_FRAME_SRC` | no | `'none'` | frame-src csv (override default) |
| `CSP_REPORT_ONLY` | no | `0` | Report-only header thay vì enforce |
| `CSP_REPORT_URI` | no | — | report-uri endpoint |

## Acceptance Criteria

- [x] Empty env → CSP policy giống Phase 17.1 (backward-compat).
- [x] `WEB_PUBLIC_CDN_ORIGIN` set → CDN domain xuất hiện ở 7 directive đúng.
- [x] `API_PUBLIC_ORIGIN` + `WS_PUBLIC_ORIGIN` → connect-src bao gồm cả 2.
- [x] Reject `*`, `https://*`, `'unsafe-inline'`, `'unsafe-eval'`, `https:` scheme-only.
- [x] `CSP_REPORT_ONLY=1` → Helmet emit `Content-Security-Policy-Report-Only` header.
- [x] `frame-ancestors`, `object-src`, `default-src`, `base-uri`, `form-action` luôn an toàn (không có env relax).
- [x] Test coverage ≥ 25 cases.
- [x] No `'unsafe-inline'` / `'unsafe-eval'` / wildcard có thể lọt qua.

## Risk / Rollback

🟢 **low** — Default behavior unchanged (empty env → `'self'`). Khi env M7 set sai (vd typo) → origin bị filter, log `rejectedOrigins`, app vẫn boot OK.

**Rollback**: revert PR → quay về hard-code policy Phase 17.1.

## Follow-ups (out of scope)

- Nonce-based scripts + `'strict-dynamic'` (yêu cầu FE inject nonce qua HTML template).
- CSP violation report ingestion endpoint (hiện gửi tới Sentry/external).
- Trusted-Types header.
