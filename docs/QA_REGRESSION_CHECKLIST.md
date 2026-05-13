# QA REGRESSION CHECKLIST (Phase 43)

Checklist tối thiểu cho mỗi PR / release pre-cutover. Mục tiêu: bảo
đảm "nền vận hành" (auth, admin, health, DB, Redis, build) không
regression. **Không cover** phase-specific gameplay test (đã ở runbook
riêng từng phase).

---

## 1. Build & Lint

- [ ] `pnpm install --frozen-lockfile=false` exit 0.
- [ ] `pnpm --filter @xuantoi/shared build` exit 0.
- [ ] `pnpm --filter @xuantoi/api prisma:generate` exit 0.
- [ ] `pnpm --filter @xuantoi/api typecheck` exit 0.
- [ ] `pnpm --filter @xuantoi/web typecheck` exit 0.
- [ ] `pnpm --filter @xuantoi/api lint` exit 0.
- [ ] `pnpm --filter @xuantoi/web lint` exit 0.
- [ ] `pnpm --filter @xuantoi/api build` exit 0.
- [ ] `pnpm --filter @xuantoi/web build` exit 0.

## 2. Test Suites

- [ ] `pnpm --filter @xuantoi/api test` exit 0.
- [ ] `pnpm --filter @xuantoi/web test` exit 0.
- [ ] `pnpm --filter @xuantoi/shared test` exit 0.

## 3. Health Endpoints (smoke)

Phải có API service đang chạy + DB + Redis reachable.

- [ ] `pnpm smoke:health` exit 0 (8 checks).
- [ ] `curl -fsS http://localhost:3000/api/healthz` → `ok: true`.
- [ ] `curl -fsS http://localhost:3000/api/readyz` → `ok: true`.
- [ ] `curl -fsS http://localhost:3000/api/version` → `name: @xuantoi/api`.
- [ ] `curl -fsS http://localhost:3000/api/health` → `status: ok`.
- [ ] `curl -fsS http://localhost:3000/api/health/full` → `status: ok`.
- [ ] Response không leak chuỗi `secret` / `password` / `postgresql://`.

## 4. Auth Flow

- [ ] `pnpm smoke:auth` exit 0.
- [ ] Login với INITIAL_ADMIN_EMAIL / PASSWORD set cookie xt_access.
- [ ] Wrong password → 401 + không lộ shape error.

## 5. Admin Access

- [ ] `pnpm smoke:admin` exit 0.
- [ ] Login admin xem `/admin/system-status` không thấy 401/403.
- [ ] Login player thường truy cập `/admin/system-status` → forbidden
      state (UI EmptyState với key `adminSystemStatus.notAdminTitle`).

## 6. Economy Integrity (nền)

- [ ] `pnpm smoke:economy` exit 0.
- [ ] `pnpm integrity:check` exit 0 (default report-only).
- [ ] Admin UI `/admin/system-status` hiển thị artefact integrity
      last-run (sau khi chạy integrity:check một lần).

## 7. Migration

- [ ] `pnpm --filter @xuantoi/api prisma migrate status` không có
      pending migration.
- [ ] `pnpm verify:deploy` exit 0 (chạy migration deploy + healthz +
      readyz + version + bootstrap idempotent).

## 8. Build Web Dev

- [ ] `pnpm --filter @xuantoi/web dev` boot không crash.
- [ ] Mở `http://localhost:5173` console không error đỏ.
- [ ] Trang login + dashboard load ok.

## 9. Console Cleanliness

- [ ] Web console khi load home không có error đỏ.
- [ ] Web console khi mở `/admin/system-status` không có error đỏ.

## 10. Logging Verify

- [ ] Pino log line mỗi request có `requestId`.
- [ ] Response có header `x-request-id`.
- [ ] Pino KHÔNG log password / token / cookie raw (manual diff sample
      lines).

## 11. Forbidden Diffs

- [ ] PR KHÔNG đụng:
  - Gameplay formula (combat / drop / reward).
  - Story / quest content runtime.
  - Market / Auction / Codex logic.
  - Visual effects Phase 42 components.
  - PvP / Boss AI.
- [ ] PR KHÔNG xoá test cũ.
- [ ] PR KHÔNG tắt CI gate.
- [ ] PR KHÔNG force-push main.

---

## CI Reference

`.github/workflows/ci.yml` chạy 3 job:

1. `build`        — typecheck + lint + test + build.
2. `e2e-smoke`    — Playwright + smoke runtime.
3. `verify-deploy`— `pnpm verify:deploy` với Postgres+Redis service.

Phase 43 thêm smoke commands KHÔNG breaking — `smoke:health`, `smoke:all`,
`integrity:check` chỉ run khi env DB/Redis có sẵn.
