# Xuân Tôi — Run Local

Hướng dẫn dựng môi trường dev đầy đủ trên 1 máy. Quá trình gồm: cài dep → bật infra Docker → migrate DB → bootstrap admin → chạy web + api song song. Tổng thời gian sạch khoảng 5–10 phút.

## Yêu cầu hệ thống

| Thành phần | Phiên bản tối thiểu |
|---|---|
| Node.js | `>= 20` (khuyến nghị 20.x LTS) |
| pnpm | `>= 9` (`packageManager` đã pin `9.15.1`) |
| Docker | bất kỳ phiên bản hỗ trợ Compose v2 |
| RAM rảnh | ~ 2 GB (Postgres + Redis + MinIO + MailHog + 2 dev server) |

> Chỉ cần **Docker Desktop** trên Mac/Win, hoặc `docker.io` + `docker compose` trên Linux. Không cần cài Postgres / Redis trực tiếp.

## 1. Clone + cài deps

```bash
git clone https://github.com/hoathienmenh-01/xuantoi.git
cd xuantoi
pnpm install
```

## 2. Bật infra Docker

```bash
pnpm infra:up
```

Spin up 4 container (xem `infra/docker-compose.dev.yml`):

| Service | Port | Credential dev |
|---|---|---|
| Postgres 16 | 5432 | `mtt` / `mtt`, db `mtt` |
| Redis 7 | 6379 | (no auth) |
| MinIO | 9000 (S3) / 9001 (UI) | `admin` / `admin12345` |
| MailHog | 1025 (SMTP) / 8025 (UI) | (no auth) |

Tắt: `pnpm infra:down`. Volume `infra_pgdata` + `infra_minio` persist giữa lần `up`/`down`. Để xoá sạch: `docker compose -f infra/docker-compose.dev.yml down -v`.

## 3. Tạo file env

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Chỉnh `apps/api/.env`:

- `INITIAL_ADMIN_EMAIL=admin@xt.local`
- `INITIAL_ADMIN_PASSWORD=<password tối thiểu 8 ký tự>`
- (giữ nguyên `JWT_*`, `DATABASE_URL`, `REDIS_URL` cho dev)

> Production cần `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` ≥ 32 ký tự ngẫu nhiên — xem `docs/DEPLOY.md` và `docs/SECURITY.md`.

## 4. Sinh Prisma client + migrate

```bash
pnpm --filter @xuantoi/api prisma:generate
pnpm --filter @xuantoi/api prisma:migrate     # dev: tạo migration mới nếu schema thay đổi
# hoặc trên môi trường mới đã có sẵn migration:
pnpm --filter @xuantoi/api exec prisma migrate deploy
```

Lần đầu chạy `prisma:migrate` sẽ áp dụng toàn bộ migration trong `apps/api/prisma/migrations/`.

## 5. Bootstrap admin đầu tiên + 3 tông môn

```bash
pnpm --filter @xuantoi/api bootstrap
```

Script idempotent (xem `apps/api/scripts/bootstrap.ts`):

- Tạo user ADMIN nếu chưa có (đọc `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD`).
- Nếu user đã có với role PLAYER → promote ADMIN, **không** đổi password.
- Upsert 3 sect: Thanh Vân Môn, Huyền Thuỷ Cung, Tu La Tông.
- Auto-rename sect cũ `Tu La Điện` → `Tu La Tông` nếu DB còn tồn tại (alignment fix cho service mappings).

Chạy lại an toàn — không tạo duplicate, không reset password admin có sẵn.

> Đã có admin nhưng không nhớ password? Hiện không có script reset — dùng `prisma studio` (`pnpm --filter @xuantoi/api exec prisma studio`) cập nhật `passwordHash` thủ công, hoặc xoá user rồi chạy lại bootstrap.

## 6. Chạy web + api song song

```bash
pnpm dev
```

Hoặc chạy riêng từng app trong 2 tab:

```bash
pnpm --filter @xuantoi/api dev
pnpm --filter @xuantoi/web dev
```

URL mặc định:

- Web (Vite): http://localhost:5173
- API (Nest): http://localhost:3000 (prefix `/api`)
- WS: `ws://localhost:3000/ws`
- MailHog UI: http://localhost:8025
- MinIO console: http://localhost:9001

## 7. Test, lint, typecheck, build

```bash
pnpm typecheck                                       # Vue + Nest + shared
pnpm lint                                            # eslint
pnpm --filter @xuantoi/api test                      # Vitest API (real Postgres + Redis)
pnpm --filter @xuantoi/shared test                   # Vitest shared (Zod / catalog)
pnpm test:balance                                    # Vitest shared — chỉ balance dial + *-balance (~2s, 196 test)
pnpm build                                           # api + web + shared
```

**`pnpm test:balance`** (Phase 11 nâng cao §6) chạy nhanh chỉ 7 file
balance — `balance-dials.test.ts` + `{boss,dungeons,items,missions,monsters,skills}-balance.test.ts`. Dùng trước mỗi PR thêm content / tune
hệ số (xem [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) §10.5).

Lưu ý: API test dùng database `mtt` thật. Test sẽ `wipeAll` trước mỗi case → **không** chạy chung lúc API dev đang phục vụ user thật. Để tách: dùng env `TEST_DATABASE_URL` trỏ vào DB riêng.

### Smoke runtime end-to-end

Sau khi `pnpm dev` lên (hoặc chỉ `pnpm --filter @xuantoi/api dev`), từ tab khác chạy:

```bash
pnpm smoke:beta        # ≤ 2 phút — gameplay flow (register → onboard → cultivate → shop → mail → leaderboard)
pnpm smoke:economy     # ≤ 5 phút — ledger / reward safety (xem docs/QA_CHECKLIST.md §10)
pnpm smoke:ws          # ≤ 30 giây — WebSocket auth, broadcast, isolation, throttle, reconnect (19 step)
pnpm smoke:combat      # ≤ 1 phút — combat encounter end-to-end + ledger invariant (18 step, son_coc 3-monster fight, COMBAT_LOOT refType=Encounter check)
pnpm smoke:admin       # ≤ 2 phút — admin grant/giftcode/mail end-to-end + RBAC + ledger invariant (30 step, multi-jar admin+player, ADMIN_GRANT/GIFTCODE_REDEEM/MAIL_CLAIM ledger reasons)
```

Tất cả script là `.mjs` zero-install (native fetch, Node 20+). Exit `0` = pass, exit `1` = có invariant fail (stderr in step + diagnostic). **BẮT BUỘC** chạy `smoke:economy` trước khi mở Phase 10 content PR (xem [`QA_CHECKLIST.md`](./QA_CHECKLIST.md) §10). `smoke:combat` là on-demand cho combat regression (Phase 9.5 polish session 9r-6). `smoke:admin` cần `pnpm --filter @xuantoi/api bootstrap` chạy trước (seed admin), on-demand cho admin/giftcode/mail regression (Phase 9.5 polish session 9r-7, xem [`QA_CHECKLIST.md`](./QA_CHECKLIST.md) §11.6).

### Playwright E2E full-stack (16 spec)

Chạy local với api + web dev cùng up:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5173 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
E2E_FULL=1 \
pnpm --filter @xuantoi/web e2e --reporter=list
```

Yêu cầu Postgres + Redis qua `pnpm infra:up`, API qua `pnpm --filter @xuantoi/api dev`, Web qua `pnpm --filter @xuantoi/web dev`. Suite ~22–25s, xem [`QA_CHECKLIST.md`](./QA_CHECKLIST.md) §12 cho spec breakdown + env reference.

CI: workflow gated `.github/workflows/e2e-full.yml` chạy 16 spec trên Postgres + Redis service container khi PR đụng `apps/web/**` / `apps/api/**` / `packages/shared/**` / `pnpm-lock.yaml` / `package.json`. Cũng có thể trigger manual qua tab Actions → "e2e-full" → "Run workflow".

## 8. Reset DB sạch

```bash
pnpm --filter @xuantoi/api exec prisma migrate reset --force --skip-seed
pnpm --filter @xuantoi/api bootstrap
```

`migrate reset` xoá toàn bộ data + reapply migration. Sau đó cần chạy lại `bootstrap` để có admin + sect.

## 9. Tài khoản dev tham khảo

Sau khi `bootstrap`:

- Admin: `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD` → vào `/admin` ở UI.
- Tạo player thường: đăng ký bình thường ở `/auth` rồi onboarding.
- Promote 1 user nào đó lên ADMIN (đã có): `pnpm --filter @xuantoi/api exec ts-node scripts/promote-admin.ts user@email.local`.

## 10. Các vấn đề thường gặp

Xem `docs/TROUBLESHOOTING.md`.
