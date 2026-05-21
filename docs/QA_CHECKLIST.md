# QA Smoke Checklist — Xuân Tôi

Manual smoke test checklist trước mỗi release closed beta. Mục tiêu: ~15 phút để 1 QA/operator verify các flow quan trọng nhất còn xanh sau khi deploy.

> **Test scope reference**: trước khi mở PR, AI/dev chọn đúng phạm vi test theo bảng [§A. Test Fast Path Theo Scope](#a-test-fast-path-theo-scope) bên dưới (per [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) `## TEST FAST PATH RULE`). KHÔNG chạy thừa, NHƯNG cũng KHÔNG bỏ qua test đáng phải chạy với scope đó.

## A. Test Fast Path Theo Scope

Bảng tham chiếu nhanh script test theo loại PR. Tất cả script đã có trong `package.json` root + per-package.

| Scope PR | Local commands BẮT BUỘC | Smoke commands (nếu liên quan) | E2E |
|---|---|---|---|
| **Docs-only** (`docs/**`, `*.md`, không touch source) | none (lint markdown nếu repo có config — hiện tại KHÔNG) | none | none. CI `build` + `e2e-smoke` vẫn chạy (no path filter ở `ci.yml`) — phải chờ xanh. |
| **Shared catalog-only** (`packages/shared/src/**.ts`, không đụng api/web) | `pnpm --filter @xuantoi/shared test`<br>`pnpm --filter @xuantoi/shared build` | none thường lệ | none |
| **FE-only polish** (`apps/web/src/**`, i18n, view tweak, không touch backend) | `pnpm --filter @xuantoi/web test`<br>`pnpm --filter @xuantoi/web build` | none | `pnpm --filter @xuantoi/web e2e` (Playwright smoke ~25s) nếu touch flow `/auth`, `/onboarding`, `/home`, `/missions`, `/inventory`, `/dungeon`, `/mail`, `/settings`. Optional: `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` (16 spec full-stack, cần api+pg+redis up — `pnpm infra:up` + `pnpm --filter @xuantoi/api dev`). |
| **API runtime** (`apps/api/src/modules/**`, service mới, controller mới, không đụng schema) | `pnpm --filter @xuantoi/api test`<br>`pnpm --filter @xuantoi/api build` | `pnpm smoke:economy` / `smoke:ws` / `smoke:admin` / `smoke:combat` nếu module liên quan | none thường lệ. Nếu touch endpoint UI consume → trigger `e2e-full.yml` qua paths filter (auto). |
| **Cross-module / Prisma migration / economy / inventory / reward / ledger / authority** | `pnpm typecheck`<br>`pnpm lint`<br>`pnpm test`<br>`pnpm build` | `pnpm smoke:economy` (luôn nếu touch ledger/currency/item)<br>`pnpm smoke:ws` (nếu emit event)<br>`pnpm smoke:admin` (nếu touch admin route)<br>`pnpm smoke:combat` (nếu touch CombatService/BossService) | `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` nếu touch endpoint UI consume |
| **Schema Prisma** (`apps/api/prisma/schema.prisma` + migration) | tất cả ở dòng trên + `pnpm --filter @xuantoi/api prisma migrate dev --name <desc>` local rồi rollback verify | smoke economy/ws nếu liên quan | E2E full-stack nếu schema đụng UI flow |

### Quy tắc

- **KHÔNG tắt test** cũ.
- **KHÔNG skip test** cũ (`it.skip`, `xdescribe`, `expect.assertions(0)` để bypass đều bị reject).
- **KHÔNG fake green** (vd `expect(true).toBe(true)` chỉ để PR có "test" mà không cover gì).
- **KHÔNG tắt CI**. Dù docs-only, CI `build` + `e2e-smoke` vẫn chạy ở mọi PR (workflow `ci.yml` không có path filter).
- **CI đỏ thì KHÔNG báo Done**. Phải debug trong cùng PR cho đến xanh, hoặc revert nếu blocker > 3 lần fix.
- **CI 5/5 GREEN** nghĩa là cả 4 check (`build` ×2 từ matrix + `e2e-smoke` ×2 + workflow `e2e-full` nếu trigger) đều pass. Đếm chính xác sau khi push.

### Workflow CI hiện có

| Workflow | File | Trigger | Thời gian |
|---|---|---|---|
| `CI` | `.github/workflows/ci.yml` | mọi push + PR (no path filter) | ~10-15 phút (build + typecheck + lint + test + e2e-smoke Playwright) |
| `e2e-full` | `.github/workflows/e2e-full.yml` | `workflow_dispatch` + PR/push touching `apps/web/`, `apps/api/`, `packages/shared/`, `pnpm-lock.yaml`, `package.json` | ~5-8 phút (Playwright golden 16 spec full-stack) |

Docs-only PR sẽ KHÔNG trigger `e2e-full.yml` (path filter); chỉ trigger `ci.yml`.

## 0. Prerequisites

- [ ] Dev server api (port 3000) + web (port 5173) chạy, hoặc staging URL sẵn sàng.
- [ ] Infra: Postgres + Redis + Minio + Mailhog up (`pnpm infra:up` cho local).
- [ ] Migrations applied (`pnpm --filter @xuantoi/api prisma migrate deploy`).
- [ ] Seed data tối thiểu: 3 sect (`thanh_van`, `huyen_thuy`, `tu_la`) + catalog items (shared) + 1 admin account (xem `docs/ADMIN_GUIDE.md`).
- [ ] Browser: Chrome/Firefox, DevTools → Console không có error đỏ khi load `/auth`.

## 1. Auth + Onboarding (5 phút)

- [ ] `/auth` load OK; form "Đăng ký" + "Đăng nhập" hiển thị tiếng Việt mặc định.
- [ ] Register user mới `qa-<timestamp>@xt.local` / password ≥ 8 ký tự → redirect `/onboarding`.
- [ ] Nhập đạo hiệu hợp lệ → chọn 1 sect → tạo character → redirect `/home`.
- [ ] Retry register cùng email → báo `EMAIL_TAKEN` (toast đỏ).
- [ ] Logout → redirect `/auth`. Login lại bằng account vừa tạo → `/home` load thành `character.name` hiện đúng.

## 2. Cultivation + Breakthrough (2 phút)

- [ ] `/home` thấy HP/MP/EXP bar, stat, button **Nhập Định**.
- [ ] Click Nhập Định → toast success; progress bar EXP có sau ≤ 35s (tick 30s).
- [ ] WS status chip góc phải top chuyển `WS ✓` xanh (không phải `WS ×` đỏ).
- [ ] Click Xuất Định → toast; tick dừng.

## 3. Smart Next Action Panel (1 phút, sau PR #49)

- [ ] `/home` hiển thị panel "Đạo Lộ Gợi Ý" phía trên stat grid (nếu user có hint).
- [ ] Nếu user chưa nhập định, panel hiển thị `CULTIVATE_IDLE` (priority 5, màu xám).
- [ ] Nhấn "Đi ngay" trên 1 hint → chuyển đúng route (ví dụ `MISSION_CLAIMABLE` → `/missions`).

## 4. Mission (2 phút)

- [ ] `/missions` load, list 4-5 mission DAILY + 1-2 WEEKLY.
- [ ] Progress bar mỗi mission hiển thị đúng `currentAmount / goalAmount`.
- [ ] Mission đã đạt goal nhưng chưa claim → button "Nhận" active; click → currency/linh thạch tăng + toast.
- [ ] Mission sau claim: disable button, move xuống dưới hoặc fade.
- [ ] WS push: mở 2 tab cùng user → claim ở tab 1 → tab 2 progress bar update real-time (event `mission:progress`, throttle 500ms — PR #63).

## 4b. Daily Login Reward (1 phút, sau PR #80, M9)

- [ ] `/home` (hoặc tab Hoạt động) hiển thị card "Điểm danh hôm nay" với streak hiện tại + reward kế tiếp (LinhThạch).
- [ ] Button "Nhận" active nếu `canClaimToday=true`; click → +100 LT (lần đầu) + toast "Đã nhận".
- [ ] Click "Nhận" lần 2 cùng ngày → response `{ claimed: false }`, không cộng thêm currency, button disabled.
- [ ] Reset theo `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`) — sang 00:00 VN ngày kế tiếp button bật lại.

## 5. Mail (2 phút)

- [ ] `/mail` inbox load; nếu có thư mới thì badge đỏ trên nav hiển thị số.
- [ ] Click thư → đánh dấu đã đọc (badge giảm); body + subject hiển thị đúng.
- [ ] Thư có reward: button "Nhận quà" → toast + reward vào inventory / currency.
- [ ] Thư đã claim: badge ẩn hoặc label "Đã nhận".

## 6. Combat + Inventory (3 phút)

- [ ] `/dungeon` list 3 dungeon (luyen_khi_duong_1/2/3). Click vào 1 dungeon → vào encounter.
- [ ] HP monster giảm sau mỗi action attack; nếu thắng → loot drop vào inventory; nếu thua → HP character về max (respawn).
- [ ] `/inventory` hiển thị item vừa loot; drag/click equip → stat power/atk thay đổi đúng.
- [ ] Sell item (nếu có) → linh thạch tăng đúng theo catalog `price`.

## 7. Market + Shop (2 phút)

- [ ] `/market` list listing — có thể empty ngày đầu.
- [ ] `/shop` NPC — list ≥ 5 item; click "Mua" → linh thạch trừ đúng, item vào inventory.
- [ ] (Optional) Đăng 1 item lên `/market` — sau đó cancel → item trở về inventory.

## 7b. Leaderboard (1 phút, sau PR #59)

- [ ] `/leaderboard` (hoặc tab tương ứng) hiển thị top theo `(realm, power)` desc, default 50 entry.
- [ ] Mỗi row: rank, tên character, sect, realm/stage, power.
- [ ] Click vào tên → chuyển `/character/profile/:id` (PR #62 — public profile, rate limit per-IP 120/15min).

## 8. Sect + Boss (2 phút)

- [ ] `/sect` — hiển thị thông tin tông môn đã chọn + danh sách thành viên.
- [ ] Cống hiến linh thạch cho sect → balance trừ đúng, sect treasury tăng.
- [ ] `/boss` — nếu admin đã spawn boss: hiển thị HP bar, nút tấn công.
- [ ] Attack boss → damage vào boss + log xuất hiện ở bảng damage.

## 9. Topup + Giftcode (1 phút)

- [ ] `/topup` — list 3-4 package; click 1 package → hiển thị QR + transferCode.
- [ ] `/giftcode` — nhập 1 code admin vừa tạo → redeem thành công + toast; code repeated → báo `ALREADY_REDEEMED`.

## 10. Admin (1 phút, chỉ khi account là ADMIN)

- [ ] `/admin` load; 7 tab: Overview / Users / Topups / Giftcodes / Mail / Boss / Audit.
- [ ] Tab Giftcodes: filter `q + status` (PR #81 G22) — search code, filter `ACTIVE/REVOKED/EXPIRED`; create giftcode mới với `code` đã tồn tại → response error `CODE_EXISTS` (PR #84 G23) hiển thị toast tiếng Việt rõ ràng.
- [ ] Tab Topups: filter `q + from + to` (search email + date range).
- [ ] Tab Users: filter `role + banned`; click 1 user → tab Inventory → click "Revoke" item → ledger entry `ADMIN_REVOKE` xuất hiện trong tab Audit (PR #66).
- [ ] Tab Overview: economy alerts panel hiển thị nếu có anomaly (currency âm, ledger inconsistent — PR #54).
- [ ] Tab Users: list user; role change work cho ADMIN (sau PR #48, MOD chỉ ban được PLAYER).
- [ ] Tab Topups: approve 1 pending → user thấy tiên ngọc tăng.
- [ ] Tab Audit: log có entry vừa tạo (role change + topup approve).
- [ ] Admin role PLAYER → `/admin` redirect `/home` + toast `FORBIDDEN`.

## 11. Responsive + i18n (1 phút)

- [ ] Resize browser về mobile (iPhone SE 375×667) — sidebar ẩn, topbar stack.
- [ ] Click LocaleSwitcher → chuyển EN; các toast + button label đổi sang English.

## 12. Session integrity

- [ ] Refresh (`F5`) khi đã login → còn nguyên session, character load tự động.
- [ ] Đổi password ở `/settings` → session cũ revoke, redirect `/auth`.
- [ ] Settings → "Logout tất cả thiết bị" → **mở confirm modal** (PR #83 L6 — không phải `window.confirm`); click "Huỷ" → modal đóng, không gọi API; click "Xác nhận" → token hiện tại invalid, redirect `/auth`.
- [ ] Mở 2 tab cùng user → "Logout tất cả" ở tab 1 → tab 2 next request → 401 → redirect `/auth`.

## 13. Audit log self-view (1 phút, sau PR #88, M6)

- [ ] Tab/page "Hoạt động" gọi `GET /logs/me?type=currency&limit=20` → list giao dịch LinhThạch/TiênNgọc gần nhất, đúng thứ tự `createdAt DESC`.
- [ ] Switch type=`item` → list ItemLedger với `qtyDelta` có dấu (+/-) đúng theo equip/use/buy/admin revoke.
- [ ] Cuộn xuống cuối list → fetch nextCursor → trang 2 không trùng/sót entry.
- [ ] User A không thể thấy log của user B (test bằng cookie swap).

---

## 14. Closed Beta Regression Matrix (Phase 24.1)

Tham chiếu nhanh **tất cả flow lớn cần verify trước mỗi closed-beta promote**. Mỗi flow gắn 1 hoặc nhiều smoke CLI (automatic) + section manual trong file này.

> **Cách dùng**: trước mỗi closed-beta release tag (hoặc Major PR merge), QA/operator chạy toàn bộ smoke CLI bên dưới (~10 phút) + manual spot-check các flow có `manual=YES` (~15 phút). Tổng ~25 phút full regression. Nếu một flow `manual=YES` thiếu thời gian, xem `auto smoke` của flow đó đã PASS → có thể defer manual sang sanity sau release.

### A. Account & Identity
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Register / Login / Logout | `smoke:auth` | §1 Auth + Onboarding | YES |
| Session refresh + revoke + change-password | `smoke:auth` | §12 Session integrity | YES |
| 2FA / OAuth | N/A (closed beta) | — | DEFER (PR closed beta đang dùng email+password only) |
| Password reset (forgot) | `smoke:auth` (login flow) | §1 | YES |
| Public profile / inspect player | `smoke:beta` (profile spec) | §7b Leaderboard click name | YES |

### B. Character & Cultivation
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Create character (sect choice + đạo hiệu) | `smoke:beta` | §1 | YES |
| Cultivation tick + Nhập/Xuất Định | `smoke:cultivation` + `smoke:ws` | §2 | YES |
| Cultivation method swap | `smoke:cultivation-method` | §2 | YES |
| Breakthrough realm | `smoke:breakthrough` | §2 | YES |
| Tribulation flow | `smoke:tribulation` | §2 (advanced) | YES |
| Spiritual root assign | `smoke:spiritual-root` | §2 (initial) | YES |
| Skill / Talent learn + cast | `smoke:skill` | §6 Combat (cast in dungeon) | YES |

### C. Inventory & Equipment
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Inventory list + use item | `smoke:inventory` | §6 Combat + Inventory | YES |
| Equip / Unequip | `smoke:inventory` | §6 | YES |
| Reforge + Enchant (Phase 15.0.A) | N/A | §6 (manual reforge spot) | DEFER auto |

### D. Mission, Story & Quest
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Daily / Weekly mission | `smoke:mission` | §4 | YES |
| Mission progress WS push | `smoke:ws` | §4 | YES |
| Quest catalog + dialog | `smoke:quest` | §4 + §6 (dungeon kill goal) | YES |
| Daily login reward | `smoke:daily-login` | §4b | YES |
| Mail (inbox + claim attachment) | `smoke:mail` | §5 | YES |

### E. Combat (Dungeon Solo / Boss / World)
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Dungeon run (encounter + loot) | `smoke:dungeon-run` + `smoke:combat` | §6 | YES |
| Story dungeon | `smoke:story-dungeon` | §6 (chuỗi story) | YES |
| Solo boss attack | `smoke:boss` | §8 | YES |
| World boss / sect boss (admin spawn) | `smoke:boss` (admin spawn) | §8 + §10 admin | YES |

### F. Market, Economy & Topup
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Market post + buy listing | `smoke:market` | §7 | YES |
| Shop NPC buy | `smoke:shop` | §7 | YES |
| Currency ledger consistency | `smoke:economy` (default suite — daily-login + shop + mail-reward chain) | Post-smoke check `/healthz` + admin Audit tab | YES |
| Mail reward claim → ledger row | `smoke:economy` (step 9 mail-reward chain — admin grant → player claim → ledger verify) | §5 | YES |
| Topup package + QR + giftcode redeem | `smoke:topup` + `smoke:giftcode` (default suite) | §9 | YES |
| Market trade abuse anomaly | N/A (auto detection only) | §10 Admin → tab Market Abuse | YES |

### G. Social & Chat
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Friend request send / accept / cancel | `smoke:social` (Phase 24.1) | §15 Social/Chat (Phase 24.1) | YES |
| Block / Unblock | `smoke:social` | §15 | YES |
| Private chat send / receive (WS) | `smoke:chat` + `smoke:social` | §15 | YES |
| Group chat create / invite / kick | `smoke:chat` (group spec) + `smoke:social` | §15 | YES |
| Chat report submit (user) | `smoke:social` | §15 | YES |
| Chat moderation: admin resolve + mute + soft-hide | N/A auto | §15 + §10 admin | YES |
| Notification bell + unread count + WS | `smoke:ws` (notification spec) | §15 | YES |
| Public profile inspect (read-only) | `smoke:social` | §7b click name | YES |

### H. Party & Co-op (Phase 19.4 / 20.x)
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Party create / invite / leave / dissolve | `smoke:coop` (Phase 24.1) | §15 Party/Co-op | YES |
| Party dungeon (Phase 20.1) flow: lobby → ready → start → claim | `smoke:coop` | §15 | YES |
| Co-op boss (Phase 20.2) flow: create → join → contribute → finish → claim | `smoke:coop` | §15 | YES |
| Reward cap daily/weekly gate (Phase 20.3) | `smoke:coop` | §15 (8th claim/day reject) | YES |
| Leech downgrade (Phase 20.3) | N/A auto (cần damage > 0 + survival < 60s mixed signal) | §15 (manual seed 1 leecher tài khoản phụ) | DEFER auto |
| Weekly contribution leaderboard + tier claim | `smoke:coop` | §15 (admin settle season + claim) | YES |

### I. Sect, Territory & Season
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Sect war contribution / leaderboard / weekly reward | `smoke:sect` | §8 | YES |
| Sect mission + sect shop | `smoke:sect` (mission spec) | §8 | YES |
| Sect season milestone + Hall of Fame | `smoke:sect` (season spec) | §8 advanced | YES |
| Sect territory influence / settlement / region buff | `smoke:sect` (territory spec) | §8 advanced | YES |

### J. Anti-cheat & Security
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Rate limit (auth, chat, mission claim) | `smoke:auth` (spam 6 register) + `smoke:chat` (60/min) | §10 admin → tab Audit | YES |
| Session hardening (multi-device + revoke) | `smoke:auth` | §12 | YES |
| Security audit / alert acknowledge | N/A auto (admin manual) | §10 → tab Security | YES |
| Gameplay anomaly detection (cultivation tick / boss damage) | N/A auto (detection-only) | §10 → tab Anti-cheat | YES |
| Market trade abuse detection | N/A auto | §10 → tab Market Abuse | YES |
| Daily reward cap | N/A auto | §4b spam claim | YES |
| Economy anti-cheat suite (ledger checker daily cron) | `smoke:economy` (post-cron section) | §10 → tab Economy Report | YES |

### K. Admin Dashboards
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Admin overview + users + topups + giftcodes | `smoke:admin` | §10 | YES |
| Admin mail + boss + audit | `smoke:admin` | §10 | YES |
| Admin live-ops event toggle | `smoke:admin` (event spec) | §10 → tab LiveOps | YES |
| Admin chat moderation panel | `smoke:admin` (moderation spec) | §15 + §10 | YES |
| Admin reward cap summary + season settle | `smoke:admin` (coop reward spec) | §15 + §10 | YES |
| Admin backup status + run + verify | `smoke:admin` (backup spec) | §16 Backup/Restore | YES |
| Admin security alert ack / resolve | `smoke:admin` (security spec) | §10 → tab Security | YES |

### L. Backup / Restore / Deploy
| Flow | Auto smoke | Manual section | Status |
|---|---|---|---|
| Backup run (cron disabled default — manual trigger) | `smoke:admin` (backup spec) | §16 + admin panel | YES |
| Restore verify (sandbox) | N/A auto (manual shell script `pnpm verify:restore`) | §16 | YES |
| Deploy verify gate (env schema + verify:deploy) | `pnpm verify:deploy` (CI job) | Post-smoke check + CI tab | YES |
| Migration additive rollback | N/A auto (manual prisma migrate resolve) | RUNBOOK §16 | YES |

### M. Mobile & Responsive
| Flow | Manual section | Status |
|---|---|---|
| Login / Onboarding mobile 375×667 | §11 + §17 Mobile | YES |
| Home / AppShell + sidebar collapse | §11 + §17 | YES |
| Character / Inventory / Equipment | §11 + §17 | YES |
| Market / Shop / Topup / Giftcode | §11 + §17 | YES |
| Social / PrivateChat / GroupChat / Notification bell | §15 + §17 | YES |
| Party / Party-dungeon / Co-op boss / Co-op weekly leaderboard | §15 + §17 | YES |
| Admin panel (optional mobile view) | §17 (defer full-mobile admin) | DEFER full mobile admin |
| Modal: ChatReport / GroupCreate / RewardClaim không vỡ | §17 | YES |

### N. i18n Parity
| Flow | Auto check | Status |
|---|---|---|
| Vi/En parity test (no missing key) | `pnpm --filter @xuantoi/web test -- src/i18n/__tests__/parity.test.ts` | YES |
| LocaleSwitcher toggle | §11 | YES |
| Cap error keys (Phase 20.3) | parity test cover `coopBoss.errors.*` + `partyDungeon.errors.*` + `coopRewardCap.*` | YES |

### Pass criteria toàn matrix

- Tất cả flow `Status=YES` PASS (auto smoke + manual sample).
- Flow `Status=DEFER auto` ghi rõ rationale (đã có guard catalog/code, manual chỉ xác minh khi có thay đổi).
- Tổng smoke CLI < 12 phút (sequential) hoặc < 5 phút (parallel với GNU `parallel`).
- Tổng manual spot-check < 25 phút (1 QA + 1 admin).

## 15. Social / Chat / Party / Co-op (Phase 24.1 manual)

> Bổ sung Phase 24.1 — manual smoke cho flow Social (Phase 19.1.x) + Chat moderation (Phase 19.2) + Notification (Phase 19.3) + Party (Phase 19.4) + Party-dungeon (Phase 20.1) + Co-op boss (Phase 20.2) + Reward cap (Phase 20.3).

### 15.1. Social / Friend (5 phút)
- [ ] User A `/social` → tab "Bạn bè" → click "Thêm bạn" → search user B → click "Gửi" → user A thấy outgoing request, user B nhận `notification:new` + bell badge +1.
- [ ] User B accept → user A nhận notification → cả hai thấy nhau trong "Bạn bè" + presence chip (`online`/`offline`).
- [ ] User A click "Chặn" user B → user B biến mất khỏi friend list của A; user B gửi private message tới A → rate-limit/abuse-guard từ chối (toast `BLOCKED_BY_RECIPIENT`).
- [ ] User A unblock B → presence + friend khôi phục.

### 15.2. Private Chat (3 phút)
- [ ] User A mở private chat với B → typing indicator + WS message:new sự kiện. Send "ping" → B nhận trong < 2s.
- [ ] Click 1 message của B → hover hiện "Báo cáo" → ChatReportModal mở → reason dropdown (HARASSMENT/SPAM/...) + details ≤ 500ch counter → submit → toast success.
- [ ] User B (kẻ bị mute scope `PRIVATE_CHAT`) gửi → toast `MUTED`, message KHÔNG vào feed của A.

### 15.3. Group Chat (3 phút)
- [ ] User A `/social` → tab "Nhóm chat" → "Tạo nhóm" → nhập tên + add 2 member → group create + system message "A đã tạo nhóm".
- [ ] Send message trong group → tất cả member nhận WS broadcast trong < 2s.
- [ ] Admin kick member → member rời nhóm + system message; member rời tự nguyện cũng OK.
- [ ] Group locked (admin lock qua admin panel) → send → toast `GROUP_LOCKED`.
- [ ] Group dissolved → group ẩn khỏi list, message history giữ (audit/appeal).

### 15.4. Notification (1 phút)
- [ ] Bell icon top-bar hiển thị badge `''` / số (1-99) / `99+` đúng theo `formatBellBadgeCount`.
- [ ] Click bell → drawer/panel hiển thị notification list (newest first, pagination ≤ 20/page).
- [ ] Click notification → mark-read + badge giảm + click navigate tới entity (friend/chat/group/security).
- [ ] "Mark all read" → badge về 0 + WS event `notification:unread-count` push.

### 15.5. Party (2 phút)
- [ ] User A `/social` → tab "Tổ đội" → "Tạo party" → A là leader + 1 thành viên.
- [ ] A invite B → B nhận `notification:new` (PARTY_INVITE) → accept → join party.
- [ ] B leave party → A vẫn còn 1 mình.
- [ ] A dissolve party → tất cả khỏi party.

### 15.6. Party Dungeon (Phase 20.1, 3 phút)
- [ ] Party leader create room cho dungeon catalog → status `LOBBY`.
- [ ] Member ready → status `READY_CHECK` (đủ 2+ member ≥ minMembers=2).
- [ ] Leader click "Start" → status `STARTED` → run created.
- [ ] Sau khi clear (mock kết quả CLEAR) → reward claim status `PENDING` cho mỗi member.
- [ ] Mỗi member click "Nhận thưởng" → reward grant + counter cap dungeon `dailyUsed++` + claim status `CLAIMED`.
- [ ] Member spam claim lần 2 → reject `REWARD_ALREADY_CLAIMED` (409).

### 15.7. Co-op Boss (Phase 20.2, 3 phút)
- [ ] Party leader create coop boss run cho bossKey hợp lệ → status `LOBBY`.
- [ ] Member join (ít nhất 1 + leader = 2) → `recordContribution` ≥ minSurvival 30s + damage clamp.
- [ ] Leader finish → server snapshot contribution + classify tier (NONE/LOW/NORMAL/HIGH/MVP).
- [ ] Member tier ≥ LOW → reward claim PENDING; member với contribution score < 100 hoặc survival < 60s → tier downgrade NONE (Phase 20.3 leech).
- [ ] Mỗi member claim reward → grant + counter cap boss `dailyUsed++` + claim CLAIMED.

### 15.8. Co-op Reward Cap (Phase 20.3, 2 phút)
- [ ] User A `/social` → tab "Phần thưởng tuần" (CoopWeeklyLeaderboardPanel) → status card hiển thị:
  - Tuần hiện tại (weekKey ISO UTC+7).
  - Boss usage daily `<used>/<limit>` + weekly `<used>/<limit>`.
  - Dungeon usage daily `<used>/<limit>` + weekly `<used>/<limit>`.
  - Weekly points + rank + tier dự kiến.
- [ ] Sau 8 boss claim trong ngày → claim thứ 9 → reject `DAILY_CAP_REACHED` (409) + audit anomaly `COOP_REWARD_CAP_HIT`.
- [ ] Admin (qua `/admin/coop/rewards/seasons/:id/settle`) settle season → leaderboard finalize + tier reward computed cho top 10.
- [ ] User trong top 10 click "Nhận thưởng tuần" → grant `linhThach + exp` qua ledger + claim status CLAIMED.

## 16. Backup / Restore Verify (1 phút quick check)

- [ ] Admin `/admin/backup` → tab "Backup status" → list run gần nhất với status `OK`/`FAIL`/`RUNNING`.
- [ ] Click "Run backup now" → trigger `BackupService.run({manual:true})` → status `RUNNING` → `OK` (nếu Postgres reachable).
- [ ] Click "Verify last backup" → trigger `BackupVerifyRun` → status `OK` + checksum match.
- [ ] Verify cron disabled default (BullMQ inactive) — chỉ admin manual trigger.

> Restore end-to-end (sandbox) chỉ chạy offline qua `pnpm verify:restore` shell script (RUNBOOK §5).

## 17. Mobile / Responsive Critical Screens (Phase 24.1, 2 phút)

Test ở viewport 375×667 (iPhone SE):

- [ ] `/auth` form + onboarding 4-step không overflow horizontal scroll.
- [ ] `/home` AppShell: top-bar không che character name; sidebar collapse OK; HP/MP/EXP bar tap-target ≥ 32px.
- [ ] `/inventory` + `/equipment`: grid 4-col → reflow 2-col mobile; item card tap-target ≥ 44px.
- [ ] `/market` + `/shop`: list card stack vertical; filter dropdown không vỡ.
- [ ] `/social` 5 tab (Bạn bè / Private / Nhóm / Tổ đội / Phần thưởng tuần): tab bar không overflow, swipe-scroll OK.
- [ ] `PrivateChatPanel` + `GroupChatPanel`: input bottom-fixed, keyboard không che message feed; message list scroll OK.
- [ ] `CoopBossPanel` + `CoopWeeklyLeaderboardPanel`: status card stack, leaderboard table dùng horizontal-scroll wrapper (không bể UI).
- [ ] `ChatReportModal` + `GroupCreateModal` + `RewardClaimDialog`: modal full-screen mobile, close button visible.
- [ ] Admin panel: defer full mobile (admin chỉ cần desktop closed beta).

---

## Post-smoke checks

- [ ] Check `GET /api/healthz` → `{ ok: true, uptimeMs, ts }`.
- [ ] Check `GET /api/readyz` → `{ ok: true }` (200) hoặc `503` nếu DB/Redis fail.
- [ ] Check `GET /api/version` → `{ name, version, commit, node, ts }` — `commit` SHA khớp deploy.
- [ ] Admin audit log tab không có `ERROR`/`CRITICAL` entry.
- [ ] Browser DevTools → Network tab không có request 5xx (4xx cho unauthenticated là OK).

---

## Nếu phát hiện lỗi

1. Ghi lại **URL** + **User ID** + **thời gian** + **steps reproduce**.
2. Chụp screenshot + copy console log + copy network request body (redact token/cookie).
3. Ghi vào `docs/AI_HANDOFF_REPORT.md` §Known Issues với severity phù hợp.
4. Nếu Critical → block release, mở PR fix ngay.
5. Nếu High → fix trong 24h.
6. Nếu Medium/Low → backlog, fix trong release tiếp theo.

## Automation

Phần lớn check ở section 1-10 có Playwright equivalent đã scaffolded ở `apps/web/e2e/golden.spec.ts`. Mặc định CI chạy chỉ smoke test (`auth page renders`) — full golden path gated bởi env `E2E_FULL=1`.

### Chạy full golden path local

```bash
# Tab 1: bật infra + api + web
pnpm infra:up
pnpm --filter @xuantoi/api exec prisma migrate deploy
pnpm --filter @xuantoi/api dev    # port 3000
# Tab 2:
pnpm --filter @xuantoi/web dev    # port 5173
# Tab 3 (hoặc sau khi tab 1+2 ready):
PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_SKIP_WEBSERVER=1 \
  E2E_FULL=1 pnpm --filter @xuantoi/web e2e
```

### Test cases hiện có

**Session 9h-C baseline** (3 test):
- `register → onboard → home → cultivate → mission claim` — flow gốc.
- `daily login claim — first claim today (M9 / G7)` — verify DailyLoginCard render + click "Nhận thưởng hôm nay" không crash.
- `leaderboard tabs — Power / Topup / Sect render danh sách` — verify 3 tab `/leaderboard` switch không crash.

**Session 9k task B expand** (+3 test):
- `shop buy → inventory reflect new item` — /shop render, click nút "Mua" đầu tiên (best-effort, skip nếu INSUFFICIENT_FUNDS), rồi /inventory verify render.
- `mail inbox open → read → claim nếu có reward` — /mail render, nếu có mail row thì click để đọc, nếu có nút "Nhận thưởng" thì click claim.
- `profile /profile/:id public view` — thử click link profile từ leaderboard; fallback direct navigate `/profile/<fake_id>` verify không crash (NotFound/empty state OK).

Tất cả test mới dùng style "best-effort smoke" — `if (await el.isVisible()) await el.click()` thay vì strict assert, để không fail khi state DB khác (ví dụ admin chưa có topup data → tab Topup empty list vẫn ok). Final assertion luôn là `expect(page).toHaveURL(...)` để chắc page không crash.

### CI gate

CI matrix `e2e-smoke` ở `.github/workflows/ci.yml` chạy `pnpm --filter @xuantoi/web exec playwright test --project=chromium` với Postgres+Redis services + build api+web. Vì `E2E_FULL` không set trong CI, **chỉ describe `AuthView smoke` chạy** (1 test: `auth page renders`). Describe `Golden path — full stack required` skip toàn bộ. Full golden path **không** chạy CI mặc định để tránh flaky network/timing. Chạy local trước khi mở PR thay đổi auth / onboarding / home / missions / daily-login / leaderboard.

## 9. `pnpm smoke:beta` CLI (session 9k task E)

**Mục đích**: smoke nhanh ≤ 2 phút end-to-end qua HTTP thuần (không cần browser). Dùng khi muốn verify API vẫn xanh sau deploy mà không phụ thuộc web build / Playwright.

### Chạy local

```bash
# 1. Lên infra
pnpm infra:up
pnpm --filter @xuantoi/api prisma migrate deploy
pnpm --filter @xuantoi/api bootstrap   # seed 3 sect + admin

# 2. Start API (terminal riêng)
pnpm --filter @xuantoi/api dev

# 3. Chạy smoke ở terminal khác
pnpm smoke:beta
```

Exit 0 = all green. Exit 1 = có step fail kèm stderr diagnostic (status code + response body + step name).

### Env overrides

| Env | Default | Công dụng |
|---|---|---|
| `SMOKE_API_BASE` | `http://localhost:3000` | API root (không có `/api` trailing). Dùng khi smoke staging. |
| `SMOKE_TIMEOUT_MS` | `10000` | Timeout per-request (ms). |
| `SMOKE_VERBOSE` | `0` | Set `1` để log request/response body (debug). |
| `SMOKE_SECT_KEY` | `thanh_van` | Sect khi onboard (`thanh_van` / `huyen_thuy` / `tu_la`). |
| `SMOKE_BUY_ITEM` | `huyet_chi_dan` | Item shop để buy (phải trong NPC_SHOP + currency LINH_THACH). |

### Các step

1. `GET /api/healthz` — API up.
2. `POST /api/_auth/register` — tạo user random.
3. `GET /api/_auth/session` — verify login.
4. `POST /api/character/onboard` — tạo character.
5. `GET /api/character/me` — lấy starting linhThach.
6. `POST /api/character/cultivate {cultivating:true}` — start tick.
7. `POST /api/character/cultivate {cultivating:false}` — stop tick (tránh leak).
8. `GET /api/daily-login/me` + `POST /api/daily-login/claim` — skip nếu ALREADY_CLAIMED.
9. `GET /api/missions/me` + `POST /api/missions/claim` — skip nếu không có mission complete.
10. `GET /api/shop/npc` — list catalog.
11. `GET /api/inventory` (before buy).
12. `POST /api/shop/buy` — skip nếu không đủ tiền.
13. `GET /api/inventory` (after buy).
14. `GET /api/mail/me` + `POST /:id/read` + `POST /:id/claim` — skip nếu không có mail.
15. `GET /api/leaderboard/power` — verify entries là array.
16. `POST /api/_auth/logout` — cleanup.

### Không có dependency mới

Script là file ESM `.mjs` (`scripts/smoke-beta.mjs`) dùng native `fetch` + `AbortController` Node 20+. Không install `tsx` / `ts-node` / axios.

### Giới hạn

- Không verify WS `cultivate:tick` push (smoke HTTP-only). Dùng Playwright `E2E_FULL=1` để cover WS (session 9k task B).
- Không verify admin flow (ban/grant/revoke). Dùng Playwright + admin account seed để cover.
- Không test concurrency / race condition. Chỉ happy-path sequential.
- Không cleanup user đã tạo — khi smoke nhiều lần, DB accumulate `smoke-*@smoke.invalid` user. Dùng SQL `DELETE FROM "User" WHERE email LIKE 'smoke-%@smoke.invalid'` để cleanup (xem `docs/ADMIN_GUIDE.md` cẩn thận foreign-key).

## 10. `pnpm smoke:economy` CLI (session 9q-5)

**Mục đích**: smoke runtime ≤ 5 phút verify các invariant kinh tế trong [`docs/ECONOMY_MODEL.md`](./ECONOMY_MODEL.md) §3 còn nguyên trước khi mở rộng Phase 10 content scale (items/skills/missions/boss pack). Phòng regression khi reward/shop/mail code mới bypass `CurrencyService` hoặc grant double.

Khác `smoke:beta`: focus vào **ledger consistency** + **idempotency** + **anti double-spend** thay vì coverage flow gameplay rộng. Khác `pnpm --filter @xuantoi/api audit:ledger`: smoke **perform mutations** (register → onboard → claim → buy) rồi verify ledger row được ghi đúng — audit:ledger chỉ read-only sau-fact.

### Khi nào chạy

- **BẮT BUỘC** trước khi mở Phase 10 content PR (PR-1..5: items/skills/monsters/missions/boss pack). Paste 20-step output `pass / fail` vào PR body.
- **KHUYẾN NGHỊ** sau merge bất kỳ PR đụng tới `apps/api/src/modules/character/currency.service.ts`, `apps/api/src/modules/inventory/inventory.service.ts`, `apps/api/src/modules/shop/shop.service.ts`, `apps/api/src/modules/daily-login/daily-login.service.ts`, `apps/api/src/modules/mail/mail.service.ts`, `apps/api/src/modules/giftcode/giftcode.service.ts` — bất kỳ code path mutate `linhThach` / `tienNgoc` / `InventoryItem.qty`.
- **BẮT BUỘC** ngay trước release tag closed beta v0.x (cùng `smoke:beta` + Playwright golden path).

### Chạy local

```bash
# 1. Lên infra (Postgres + Redis)
pnpm infra:up
pnpm --filter @xuantoi/api prisma migrate deploy
pnpm --filter @xuantoi/api bootstrap          # seed 3 sect

# 2. Start API ở terminal riêng (cần env từ apps/api/.env)
pnpm --filter @xuantoi/api dev                # listen :3000

# 3. Terminal khác — chạy smoke
pnpm smoke:economy
```

**Pass criteria**: exit code `0`, dòng cuối `done: 20 pass / 0 fail / 20 total`.
**Fail criteria**: exit code `1`, có ít nhất 1 step `FAIL` với invariant message dạng `INVARIANT vi phạm: SUM(...) ≠ Character.linhThach`. Khi fail, **DỪNG mở Phase 10 PR** và mở 1 PR riêng fix root cause trước.

### Env overrides

| Env | Default | Công dụng |
|---|---|---|
| `SMOKE_API_BASE` | `http://localhost:3000` | API root. |
| `SMOKE_TIMEOUT_MS` | `10000` | Timeout per-request (ms). |
| `SMOKE_VERBOSE` | `0` | Set `1` để log request/response (debug). |
| `SMOKE_SECT_KEY` | `thanh_van` | Sect onboard (`thanh_van` / `huyen_thuy` / `tu_la`). |
| `SMOKE_BUY_ITEM` | `huyet_chi_dan` | Item shop để buy. Phải trong `NPC_SHOP` + currency `LINH_THACH`. Có fallback tự chọn item LINH_THACH rẻ nhất nếu key custom không có. |

### 20 step

1. `GET /api/healthz`.
2. `POST /api/_auth/register` — random email `smoke-econ-*@smoke.invalid`.
3. `POST /api/character/onboard`.
4. `GET /api/character/me` — snapshot starting linhThach (= 0 theo schema default).
5. `GET /api/logs/me?type=currency` — verify `SUM(delta) == startingLinhThach` (empty hoặc khớp nếu future thêm welcome bonus).
6. `GET /api/logs/me?type=item` — verify shape array.
7. `GET /api/daily-login/me` — verify `nextRewardLinhThach > 0`.
8. `POST /api/daily-login/claim` — first call: `claimed=true` ⇒ `linhThachDelta > 0`, hoặc `claimed=false` (đã claim hôm nay).
9. `GET /api/character/me` — verify `linhThach` tăng đúng `dailyClaimDelta` (hoặc unchanged nếu idempotent path).
10. `GET /api/logs/me?type=currency` — verify `SUM(CurrencyLedger) == Character.linhThach`; nếu `claimed=true` thì có ≥ 1 row `reason=DAILY_LOGIN`, `currency=LINH_THACH`, `delta == DAILY_LOGIN_LINH_THACH`.
11. `POST /api/daily-login/claim` lần 2 — verify `claimed=false`, balance unchanged, ZERO ledger row mới.
12. `GET /api/shop/npc` — tìm `BUY_ITEM` LINH_THACH (fallback: rẻ nhất user mua nổi).
13. `POST /api/shop/buy` 1 item — verify response shape (`itemKey`, `qty`, `totalPrice`, `currency=LINH_THACH`).
14. `GET /api/character/me` — verify `linhThach` giảm đúng `totalPrice`.
15. `GET /api/logs/me?type=currency` — verify ≥ 1 row `reason=SHOP_BUY`, `delta = -totalPrice`, `refType='NPC_SHOP'`, `refId=itemKey`.
16. `GET /api/logs/me?type=item` — verify ≥ 1 row `reason=SHOP_BUY`, `qtyDelta = +qty`, `refType='NPC_SHOP'`.
17. `GET /api/inventory` — verify `Inventory.qty == SUM(ItemLedger.qtyDelta)` per `(character, itemKey)`. Verify `Inventory.qty >= 0` cho mọi item.
18. `POST /api/shop/buy` qty=99 (= 2475 LT) khi balance ~75 LT — verify status ≠ 200, balance unchanged, ZERO CurrencyLedger / ItemLedger row mới (atomic rollback).
19. `GET /api/character/me` + `GET /api/logs/me?type=currency` — final verify `SUM(CurrencyLedger) == Character.linhThach`, `linhThach >= 0`.
20. `POST /api/_auth/logout`.

### CI gating

Smoke `pnpm smoke:economy` **KHÔNG vào CI flow** vì cần API + DB + Redis live cùng process. CI hiện chạy:
- `unit` job: typecheck/lint/vitest/build trên Postgres+Redis service nhưng KHÔNG `pnpm dev`.
- `e2e-smoke` job: Playwright trên build artifact `vite preview`, KHÔNG có API.

Mở rộng CI để chạy `smoke:economy` cần job mới — start API trong background trước Playwright (giống local). **Deferred** vì chi phí maintenance > giá trị (smoke đã verify chỗ ledger consistency mà unit tests đã cover invariants tương đương trong `currency.service.test.ts` + `shop.service.test.ts` + `daily-login.service.test.ts`). Smoke chính xác là để **integration check** trước release / Phase boundary, không phải replace unit tests.

### Deferred sub-checks

- **Mail double-claim**: cần admin grant mail trước → smoke phải login admin (cần secret `INITIAL_ADMIN_PASSWORD`). Defer cho session sau khi smoke admin được thiết kế. Hiện tại unit test `mail.service.test.ts` đã cover `Mail.claimedAt IS NULL` invariant.
- **Giftcode double-redeem**: cần admin tạo gift code trước. Cùng lý do defer như mail. Unit test `giftcode-race.test.ts` đã cover unique `(giftCodeId, userId)` constraint dưới concurrency.
- **Mission claim double-claim**: cần wait cultivate tick → mission complete (15-30s ngẫu nhiên). Defer vì smoke phải tăng timeout đáng kể. `mission.service.test.ts` đã cover `MissionProgress.claimed` flag idempotency.
- **Cross-character anomaly**: smoke chỉ tạo 1 user → không scan toàn DB. Dùng `pnpm --filter @xuantoi/api audit:ledger` (read-only, scan all) cho check cross-user định kỳ.

### Không có dependency mới

Script là `scripts/smoke-economy.mjs` (~470 dòng ESM), dùng native `fetch` + `AbortController` Node 20+. KHÔNG install thêm `tsx`/`ts-node`/`axios`/`@prisma/client` cho runtime smoke. Chỉ verify qua HTTP `/api/character/me`, `/api/logs/me`, `/api/inventory`, `/api/shop/*`, `/api/daily-login/*` (đã có từ PR #88 cho `/logs/me` self-audit).

### Giới hạn

- Không cleanup user — như `smoke:beta`. Cleanup: `DELETE FROM "User" WHERE email LIKE 'smoke-econ-%@smoke.invalid'` (cẩn thận FK → `Character`, `CurrencyLedger`, `ItemLedger`, `DailyLoginClaim`, ...).
- Không cover currency `TIEN_NGOC` (premium). Topup flow cần admin approve → ngoài scope smoke ẩn danh.
- Không cover `CONG_HIEN` / `CHIEN_CONG_TONG_MON` (sect war), `NGUYEN_THACH` (refine). Phase 9 closed beta chưa expose endpoint trực tiếp.

## 11. `pnpm smoke:ws` CLI (session 9q-6)

**Mục đích**: smoke runtime ≤ 30s verify các invariant realtime của `RealtimeGateway` (`apps/api/src/modules/realtime/realtime.gateway.ts`) còn nguyên trước khi mở rộng Phase 10 content scale (đặc biệt skill / mission / boss / dungeon mới đều push qua WS). Phòng regression khi:

- Logic auth cookie `xt_access` thay đổi → user A nhận frame `state:update` của user B (privacy regression).
- Refactor `RealtimeService.emitToUser/broadcast/emitToRoom` → frame duplicate hoặc miss.
- Change `MISSION_PROGRESS_PUSH_THROTTLE_MS` (default 500ms, [`packages/shared/src/ws-events.ts`](../packages/shared/src/ws-events.ts)) → spam mission track flood WS.
- `cultivation.processor.ts` đổi shape payload `cultivate:tick` → FE crash khi parse.
- Reconnect path bug → user reconnect bằng cookie cũ vẫn dính userId map của session trước → broadcast leak.

Khác `smoke:economy`: focus vào **realtime safety + WS auth + push throttle** thay vì ledger consistency. Khác vitest `realtime.gateway.test.ts` (14 case unit): smoke chạy NestApp full + cookie auth thật (không stub JWT) + 2 user A/B isolated cookie jar + reconnect path qua socket.io-client thật.

### Khi nào chạy

- **BẮT BUỘC** trước khi merge bất kỳ PR đụng:
  - `apps/api/src/modules/realtime/realtime.gateway.ts` / `realtime.service.ts`.
  - `apps/api/src/modules/mission/mission-ws.emitter.ts` (throttle).
  - `apps/api/src/modules/chat/chat.service.ts` (broadcast WORLD / room SECT).
  - `apps/api/src/modules/cultivation/cultivation.processor.ts` (BullMQ tick + emit).
  - `apps/api/src/modules/character/character.service.ts` (`emitToUser('state:update', …)` từ onboard/cultivate/breakthrough).
  - `packages/shared/src/ws-events.ts` (`WsEventType` / `WsFrame` / `MISSION_PROGRESS_PUSH_THROTTLE_MS` / `CULTIVATION_TICK_MS`).
- **KHUYẾN NGHỊ** trước khi mở Phase 10 content PR (PR-1..5: items/skills/monsters/missions/boss pack) — content mới track mission progress nhiều hơn → throttle phải còn nguyên.
- **BẮT BUỘC** ngay trước release tag closed beta v0.x (cùng `smoke:beta` + `smoke:economy` + Playwright golden path).

### Chạy local

```bash
# 1. Lên infra (Postgres + Redis cho BullMQ tick scheduler)
pnpm infra:up
pnpm --filter @xuantoi/api prisma migrate deploy

# 2. Start API ở terminal riêng (cần env từ apps/api/.env)
pnpm --filter @xuantoi/api dev                # listen :3000, WS path /ws

# 3. Terminal khác — chạy smoke (default: SKIP cultivate:tick — nhanh ~5s)
pnpm smoke:ws

# 4. (Optional) Bật cultivate:tick check (cộng ~30-40s đợi BullMQ tick):
SMOKE_WAIT_TICK_MS=40000 pnpm smoke:ws
```

**Pass criteria**: exit code `0`, dòng cuối `done: 19 pass / 0 fail / 19 total in <ms>`.

**Fail criteria**: exit code `1`, có ít nhất 1 step `FAIL` với invariant message dạng `INVARIANT vi phạm: emitToUser leak qua user khác — B nhận N state:update của A`. Khi fail, **DỪNG mở Phase 10 PR** và mở 1 PR riêng fix root cause trước.

### Env overrides

| Env | Default | Công dụng |
|---|---|---|
| `SMOKE_API_BASE` | `http://localhost:3000` | API root. WS origin = `scheme://host:port` (path `/ws` cố định). |
| `SMOKE_TIMEOUT_MS` | `10000` | Timeout per HTTP request (ms). |
| `SMOKE_WS_TIMEOUT_MS` | `4000` | Timeout WS connect / wait frame (ms). |
| `SMOKE_THROTTLE_MS` | `500` | Phải khớp `MISSION_PROGRESS_PUSH_THROTTLE_MS` trong [`packages/shared/src/ws-events.ts`](../packages/shared/src/ws-events.ts). Khi shared bump throttle, override đây. |
| `SMOKE_WAIT_TICK_MS` | `0` | `0` = SKIP cultivate:tick step (default, smoke nhanh). Đặt `≥ 35000` để chờ BullMQ tick (`CULTIVATION_TICK_MS=30000` + buffer). |
| `SMOKE_VERBOSE` | `0` | Set `1` để log HTTP request/response + WS frame inbound (debug). |
| `SMOKE_SECT_KEY` | `thanh_van` | Sect onboard cho 2 user. |

### 19 step (default — `SMOKE_WAIT_TICK_MS=0`)

1. `GET /api/healthz`.
2. Setup user A — `POST /api/_auth/register` (random email `smoke-ws-A-*@smoke.invalid`) → `POST /api/character/onboard` → `GET /api/character/me`.
3. Setup user B — same flow, cookie jar độc lập.
4. WS auth: thiếu cookie → server `client.emit('error') + disconnect(true)` → `sock.connected === false` sau 1.5s.
5. WS connect A với cookie `xt_access` → `sock.connected === true`, `sock.id` non-empty.
6. WS connect B với cookie `xt_access` → connect OK.
7. `ping` → `pong` ack callback roundtrip — verify shape `WsFrame { type:'pong', payload:{}, ts:number }`.
8. **state:update isolation** — `POST /api/character/cultivate {cultivating:true}` (user A) → A nhận `state:update` (`payload.id == characterId(A)`, `cultivating === true`); đợi 150ms — B **KHÔNG** nhận frame nào (verify `emitToUser` không leak).
9. **chat:msg broadcast** — `POST /api/chat/world` (user A) → cả A và B nhận đúng 1 frame `chat:msg` với `payload.id` cùng row, `payload.text` khớp, `payload.senderId == characterId(A)`, `payload.channel === 'WORLD'`.
10. **chat:msg no duplicate** — 1 send → đúng 1 frame trong cửa sổ 600ms (capture array).
11. **mission:progress throttle** — spam 5 `POST /api/chat/world` trong cửa sổ < 500ms (mỗi send tracks `CHAT_MESSAGE` mission → `MissionWsEmitter.tryEmit`) → ≤ 1 frame `mission:progress`. Nếu env quá chậm (5 send ≥ 500ms) → step skip với note.
12. **mission:progress next window** — wait > 500ms+200ms → 1 send → ≤ 1 frame (window reset).
13. **reconnect A (disconnect + reconnect)** — `disconnect()` → `newSock(jarA)` → connect OK + `sock.id` mới khác cũ.
14. **reconnect A — state:update vẫn deliver** — `POST /api/character/cultivate {cultivating:false}` → A nhận `state:update` với `cultivating === false` (userId map intact sau reconnect).
15. **reconnect A — chat:msg broadcast vẫn deliver** — user B gửi → A nhận đúng 1 frame, không duplicate frame leak từ session cũ.
16. **cultivate:tick (gated)** — chỉ chạy khi `SMOKE_WAIT_TICK_MS > 0`. Bật cultivating=true → đợi BullMQ tick processor emit `cultivate:tick` (cron `CULTIVATION_TICK_MS=30s`) → assert payload shape `{ characterId, expGained:string-numeric, exp, expNext, realmKey, realmStage:number, brokeThrough:boolean }`. Cleanup: tắt cultivating sau khi nhận.
17. **logout A** — `POST /api/_auth/logout` → cookie jar A mất `xt_access`.
18. **after logout — WS reconnect fail** — `newSock(jarA)` → server disconnect (`sock.connected === false` sau 1.5s).
19. Cleanup: logout B + clean disconnect cả 2 socket.

### CI gating

`pnpm smoke:ws` KHÔNG vào CI flow vì cần API + DB + Redis (BullMQ scheduler) live cùng process. CI hiện chạy unit + Playwright build-artifact, KHÔNG chạy `pnpm dev`. Script là **manual/gated**.

Khi PR đụng các file thuộc danh sách "BẮT BUỘC" ở §11 trên, reviewer **phải** request:
- Output `pnpm smoke:ws` (default — 19/19 PASS) trong PR body.
- Khi PR đụng `cultivation.processor.ts` hoặc shared `CultivateTickPayload` → output thêm `SMOKE_WAIT_TICK_MS=40000 pnpm smoke:ws` (cultivate:tick PASS).

### Deferred sub-checks (không có trong smoke này)

- **Multi-tab same user**: 1 user mở 2 tab → 1 trigger emit phải deliver cả 2 socket. `realtime.gateway.test.ts` cover gián tiếp qua `userSockets: Map<string, Set<string>>` set logic. Defer vì cần spawn 2 socket cùng cookie jar — phức tạp với socket.io-client `forceNew`.
- **Sect room broadcast**: smoke chỉ test WORLD broadcast. SECT room test cần seed sect + auto-join logic — gateway test đã cover (`sock.join('sect:<id>')` + `emitToRoom`).
- **JWT expired path**: cần expired JWT thật (TTL 0). `realtime.gateway.test.ts` đã cover. Skip trong smoke runtime để giữ < 30s.
- **Race condition rapid reconnect**: disconnect → reconnect 5x trong 1s. Không phải invariant gameplay critical. Defer.

### Không có dependency mới

Script là `scripts/smoke-ws.mjs` (~700 dòng ESM), dùng native `fetch` + `AbortController` Node 20+ + `socket.io-client` load qua `createRequire(apps/api/package.json)` từ workspace dep đã có (`@xuantoi/api` devDep + `@xuantoi/web` dep). KHÔNG install thêm dep ở root.

### Giới hạn

- Không cleanup user — như `smoke:beta` / `smoke:economy`. Cleanup: `DELETE FROM "User" WHERE email LIKE 'smoke-ws-%@smoke.invalid'` (cẩn thận FK).
- Không cover `state:update` từ breakthrough (cần exp ≥ cost realm 9 — không thực tế trong < 30s smoke).
- Không cover `chat:msg` SECT room (cần seed sect + assign character, defer).
- Không cover BullMQ failure path (tick processor crash) — cần test framework integration sâu hơn, defer.
- Rate limit `/api/_auth/register` = 5/IP/15 phút. Smoke tạo 2 user → có thể chạy 2 lần liên tiếp, lần 3 sẽ 429. Khi cần test nhiều, flush key Redis: `docker exec xuantoi-redis redis-cli --scan --pattern 'rl:register*' | xargs -r docker exec -i xuantoi-redis redis-cli DEL`.

---

## 11.5. `pnpm smoke:combat` CLI (session 9r-6)

### Mục tiêu

Smoke runtime ≤ 1 phút verify combat encounter end-to-end (register → onboard → start dungeon → action loop → reward → ledger invariant) còn nguyên trước khi mở rộng Phase 11 elemental combat / spiritual root runtime. Phòng regression khi:

- `CombatService.start` / `action` / `abandon` đổi hợp đồng response.
- `CombatService` bypass `CurrencyService.applyTx` hoặc `InventoryService.grant` (không qua ledger).
- `EncounterStatus` state machine break (start → ACTIVE → WON|LOST|ABANDONED).
- Reward shape `{exp, linhThach, loot[]}` đổi mà FE chưa biết.
- Stamina budget (entry + per-action) bypass server-side check.

Khác `smoke:economy`: focus vào **combat state machine + loot drop ledger** thay vì shop/daily-login flow. Khác vitest `combat.service.test.ts` (RNG seeded unit): smoke chạy NestApp full + cookie auth thật + RNG live (basic attack hơn ~3-5 turn / monster) + assert end status WON|LOST + verify post-combat ledger consistency.

### Khi nào chạy

- **BẮT BUỘC** trước khi merge PR đụng:
  - `apps/api/src/modules/combat/combat.service.ts` (RNG, damage formula, reward distribution).
  - `apps/api/src/modules/combat/combat.controller.ts` (endpoint shape, auth, error code).
  - `packages/shared/src/combat.ts` (DUNGEONS, MONSTERS, STAMINA_PER_ACTION, MIN_DUNGEONS quota).
  - `apps/api/src/modules/inventory/inventory.service.ts` (`grant` reason + refType).
  - `apps/api/src/modules/currency/currency.service.ts` (`applyTx` reason 'COMBAT_LOOT' contract).
- **BẮT BUỘC** trước release tag closed beta v0.x (cùng `smoke:beta` + `smoke:economy` + `smoke:ws` + Playwright golden path).
- **Tự ý chạy** trước khi mở Phase 11 elemental combat MVP PR.

### Cách chạy

Yêu cầu môi trường giống `smoke:beta`:

```bash
pnpm infra:up
pnpm --filter @xuantoi/api exec prisma migrate deploy
pnpm --filter @xuantoi/api bootstrap
pnpm --filter @xuantoi/api dev   # tab 1 — API listen :3000

# Tab khác:
pnpm smoke:combat
```

Env vars (mặc định đủ cho Phase 10 catalog):

- `SMOKE_API_BASE` — `http://localhost:3000`.
- `SMOKE_TIMEOUT_MS` — `10000`.
- `SMOKE_VERBOSE=1` — log request/response (debug).
- `SMOKE_SECT_KEY` — `thanh_van`. Có thể đổi `huyen_thuy` / `tu_la`.
- `SMOKE_DUNGEON` — `son_coc` (3 monster level 1-3, stamina 10). Có thể đổi `hac_lam` / `yeu_thu_dong` / 5 element-thematic dungeon từ Phase 10 PR-3.
- `SMOKE_MAX_TURNS` — `50` (safety stop).

### 18 step expect PASS

1. healthz.
2. `combat/dungeons` — public list, ≥ 9 dungeon (Phase 10 PR-3 baseline), son_coc tồn tại.
3. register fresh user.
4. onboard sect.
5. `character/me` — starting hp/mp/stamina/linhThach + invariant hp ∈ [1, hpMax], mp ∈ [0, mpMax], stamina ≥ entry.
6. `combat/encounter/active` — empty cho fresh user.
7. `combat/encounter/start <dungeon>` → encounter ACTIVE + monster đầu tiên load.
8. Anti double-start lần 2 → 409 ALREADY_IN_FIGHT.
9. `combat/encounter/:id/action` loop tới WON | LOST (max 50 turn).
10. Reward shape `{exp, linhThach, loot[]}` non-null khi WON.
11. action sau khi end → 409 ENCOUNTER_ENDED.
12. abandon sau khi end → 409 ENCOUNTER_ENDED.
13. `combat/encounter/active` — null sau khi end.
14. **INVARIANT**: SUM(CurrencyLedger.LINH_THACH) == Character.linhThach + COMBAT_LOOT row chỉ với refType='Encounter' refId=encounter.id delta>0.
15. ItemLedger COMBAT_LOOT khớp reward.loot per itemKey + qtyDelta>0.
16. **INVARIANT**: Inventory.qty == SUM(ItemLedger.qtyDelta) per itemKey + no qty âm.
17. character invariant exp tăng (WON) + stamina giảm ≥ staminaEntry + hp/mp final trong bound.
18. logout.

Local run reference (session 9r-6): 2 lần chạy idempotent → `done: 18 pass / 0 fail / 18 total in 757-856ms`, final encounter status WON after 15 action(s), reward exp=45 linhThach=15 loot=2.

### Không có dependency mới

Script `scripts/smoke-combat.mjs` (~480 dòng ESM), dùng native `fetch` + `AbortController` Node 20+. KHÔNG install thêm dep ở root.

### Giới hạn

- Không cover skill-pick combat (basic attack only — đủ verify state machine + ledger; skill-pick deferred Phase 11 elemental combat).
- Không cover `LOST` outcome path explicit (smoke depend RNG; nếu `son_coc` 3 monster vs starting char power, nhân vật rất hiếm khi LOST. Để force LOST: dùng dungeon mid-tier + giảm hp DB-direct trước khi action loop — defer Phase 11 polish).
- Không cleanup user — như `smoke:beta` / `smoke:economy` / `smoke:ws`. Cleanup: `DELETE FROM "User" WHERE email LIKE 'smoke-combat-%@smoke.invalid'` (cẩn thận FK → `Character`, `Encounter`, `CurrencyLedger`, `ItemLedger`, ...).
- Stamina regen tick (BullMQ cron 30s) có thể fire trong long-mode → smoke giả định regen tick chưa fire (smoke complete < 5s). Long-mode stamina assertion bypass.

---

## 11.6. `pnpm smoke:admin` CLI (session 9r-7)

### Mục tiêu

Smoke runtime ≤ 2 phút verify admin module HTTP runtime end-to-end (admin login → read-only stats/economy/audit-ledger → write grant linhThach + giftcode + mail → player redeem giftcode + claim mail → ledger/inventory invariants → RBAC isolation → idempotency rejection) còn nguyên trước khi mở rộng Phase 11. Phòng regression khi:

- `AdminService.grant` bypass `CurrencyService.applyTx` hoặc bỏ `AdminAuditLog`.
- `GiftCodeService.create` / `redeem` bypass `CurrencyLedger`/`ItemLedger` (reason `GIFTCODE_REDEEM`).
- `MailService.claim` bypass ledger (reason `MAIL_CLAIM`) hoặc anti-double-claim break.
- `AdminGuard` regress (player cookie qua được `/api/admin/*`).
- Idempotency `ALREADY_REDEEMED` / `ALREADY_CLAIMED` / `CODE_REVOKED` đổi error code shape.
- `admin/economy/alerts` / `admin/economy/audit-ledger` / `admin/audit?action=...` đổi response shape mà admin dashboard chưa biết.

Khác `smoke:economy`: focus **admin write actions + ledger reason linkage** thay vì shop/daily-login flow. Khác `smoke:combat`: không depend RNG (deterministic delta `+1000 LT / -300 LT / +500 LT giftcode / +200 LT mail`). Bổ sung **multi-jar pattern** (admin jar + player jar parallel) — đầu tiên trong smoke suite.

### Khi nào chạy

- **BẮT BUỘC** trước khi merge PR đụng:
  - `apps/api/src/modules/admin/admin.service.ts` (grant, listAudit, stats, getEconomyAlerts, runLedgerAudit).
  - `apps/api/src/modules/admin/admin.controller.ts` (endpoint shape, auth, RequireAdmin decorator).
  - `apps/api/src/modules/admin/admin.guard.ts` (RBAC role check).
  - `apps/api/src/modules/giftcode/giftcode.service.ts` (create / redeem / revoke contract + idempotency).
  - `apps/api/src/modules/mail/mail.service.ts` (send / claim contract + ledger reason).
  - `apps/api/src/modules/auth/auth.service.ts` (login flow, session cookie behavior).
  - Schema migration đụng `AdminAuditLog`, `GiftCode`, `Mail`, `MailRecipient`, `CurrencyLedger`, `ItemLedger`.
- **BẮT BUỘC** trước release tag closed beta v0.x (cùng `smoke:beta` + `smoke:economy` + `smoke:ws` + `smoke:combat` + Playwright golden path).
- **Tự ý chạy** trước khi mở Phase 11 elemental combat MVP PR (đảm bảo admin grant + economy alert pipeline còn xanh để debug runtime nếu Phase 11 phá ledger).

### Cách chạy

Yêu cầu môi trường giống `smoke:combat` + bootstrap admin user:

```bash
pnpm infra:up
pnpm --filter @xuantoi/api exec prisma migrate deploy
pnpm --filter @xuantoi/api bootstrap   # seed admin INITIAL_ADMIN_EMAIL/PASSWORD
pnpm --filter @xuantoi/api dev         # tab 1 — API listen :3000

# Tab khác:
pnpm smoke:admin
```

Env vars (mặc định khớp `apps/api/.env` defaults):

- `SMOKE_API_BASE` — `http://localhost:3000`.
- `SMOKE_TIMEOUT_MS` — `10000`.
- `SMOKE_VERBOSE=1` — log request/response (debug).
- `SMOKE_SECT_KEY` — `thanh_van`. Có thể đổi `huyen_thuy` / `tu_la`.
- `SMOKE_ADMIN_EMAIL` — `admin@example.com` (must khớp `INITIAL_ADMIN_EMAIL` đã bootstrap).
- `SMOKE_ADMIN_PASSWORD` — `change-me-bootstrap-pass` (must khớp `INITIAL_ADMIN_PASSWORD` đã bootstrap).

Pre-condition: `pnpm --filter @xuantoi/api bootstrap` PHẢI đã chạy ít nhất 1 lần (tạo admin user trong DB). Nếu chạy lần đầu trên DB clean, bootstrap idempotent — không tạo trùng.

### 30 step expect PASS

1. healthz.
2. admin login (`POST /api/_auth/login`) — cookie `xt_access` set.
3. admin `/api/_auth/session` — `data.user.role === 'ADMIN'`.
4. admin `/api/admin/stats` — shape (`users.total/admins`, `characters.total`, `economy.linhThachCirculating`).
5. admin `/api/admin/economy/alerts` — shape (`negativeCurrency[]`, `negativeInventory[]`, `stalePendingTopups[]`, `bounds.{defaultHours,minHours,maxHours}`).
6. admin `/api/admin/economy/audit-ledger` — shape (`charactersScanned`, `itemKeysScanned`, `currencyDiscrepancies[]`, `inventoryDiscrepancies[]`). Smoke KHÔNG assert pre-condition `discrepancies=0` vì local dev DB có data dữ từ smoke cũ — production chạy `audit:ledger` script riêng.
7. register player (jar mới, isolated từ admin).
8. player onboard (sect `thanh_van`).
9. player `/character/me` — snapshot starting `linhThach`.
10–11. admin grant `+1000 LT` → player. Verify `character/me.linhThach == starting + 1000`.
12–13. admin grant `-300 LT` → player. Verify `character/me.linhThach == starting + 700`.
14. admin `POST /admin/giftcodes` create code (`+500 LT + 2× huyet_chi_dan`).
15. player `POST /giftcodes/redeem` first redeem.
16. player `/character/me.linhThach == starting + 1200`.
17. player redeem cùng code lần 2 → `409 ALREADY_REDEEMED`.
18. admin `POST /admin/mail/send` to player character (`+200 LT + 1× huyet_chi_dan`).
19. player `/api/mail/me` — see new mail (`unread`, `claimable=true`).
20. player `POST /mail/:id/claim` reward applied.
21. player `/character/me.linhThach == starting + 1400`.
22. player claim cùng mail lần 2 → `409 ALREADY_CLAIMED`.
23. admin `/api/admin/audit?action=user.grant` — ≥ 2 row (positive + negative grant) cho admin smoke. Note: `GiftCodeService` + `MailService` KHÔNG ghi `AdminAuditLog` (known gap, xem `AI_HANDOFF_REPORT.md`).
24. **INVARIANT**: `SUM(CurrencyLedger[reason ∈ {ADMIN_GRANT, GIFTCODE_REDEEM, MAIL_CLAIM}].delta) == Character.linhThach final`. Verify đủ 4 reason: `ADMIN_GRANT` ×2 + `GIFTCODE_REDEEM` + `MAIL_CLAIM`.
25. **INVARIANT**: `Inventory.qty per itemKey == SUM(ItemLedger[itemKey].qtyDelta)`. Verify huyet_chi_dan qty == 3 (giftcode 2 + mail 1). Không qty âm.
26. admin `POST /admin/giftcodes/:code/revoke` — `revokedAt` set ISO.
27. admin `GET /admin/giftcodes?status=REVOKED` — code visible với `revokedAt`.
28. player → `/api/admin/stats` → `403 FORBIDDEN` (admin guard reject PLAYER role).
29. admin logout → cookie cleared.
30. player logout → cookie cleared.

Local run reference (session 9r-7): 2 lần chạy idempotent → `done: 30 pass / 0 fail / 30 total in ~1.3s`.

### Không có dependency mới

Script `scripts/smoke-admin.mjs` (~860 dòng ESM), dùng native `fetch` + `AbortController` Node 20+. CookieJar class đa user (mirror `smoke-ws.mjs`). KHÔNG install thêm dep ở root.

### Giới hạn

- Không cover topup approve/reject flow (cần test client pay flow + topup order create — defer cho `smoke:topup`).
- Không cover MOD role (chỉ ADMIN role login + RBAC isolation từ player). Defer cho future smoke nếu MOD role có phân quyền riêng.
- Không cover mail `system` broadcast (1-to-many) — smoke chỉ test `mail/send` đến 1 character cụ thể.
- Không cover giftcode `expiresAt` / `maxRedeems` exhaustion path — defer (cần manipulate Date hoặc batch test).
- Không cleanup user/character/giftcode/mail — smoke idempotent (random email + random code prefix `SMK-ADM-`). Cleanup: `DELETE FROM "User" WHERE email LIKE 'smoke-admin-%@smoke.invalid'` và `DELETE FROM "GiftCode" WHERE code LIKE 'SMK-ADM-%'` (cẩn thận FK).
- Auth register rate limit 5/IP/15 phút (`auth.service.ts:REGISTER_RATE_LIMIT_*`). Smoke tạo 1 user/run → có thể chạy ~5 lần/15 phút trên cùng IP. Khi cần chạy nhiều, flush:
  ```bash
  docker exec xuantoi-redis redis-cli --scan --pattern 'rl:register*' | xargs -r docker exec -i xuantoi-redis redis-cli DEL
  ```

---

## 12. Playwright Golden Path E2E (`pnpm --filter @xuantoi/web e2e`, session 9q-7 → 9q-8)

### Mục tiêu

Verify **closed beta core loop end-to-end UI flow** ([`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) §QA + Launch — register → onboarding → cultivate → daily login → mission → market/shop browse → chat → leaderboard → profile → logout → shop **buy** → inventory **equip** → mail → dungeon list → settings) trong môi trường full stack thật. Bắt regression UI/route/store/i18n mà vitest component test cô lập + smoke server-side không phát hiện được. Cụ thể:

- Vue Router push/replace + route guard (chưa onboard → `/onboarding`, đã onboard → `/home`).
- Pinia store hydration sau navigation (character store, shop store, mission store).
- i18n button text mismatch (FE binding sai key → user click không thấy gì).
- WS push `chat:msg` deliver vào UI feed end-to-end (không chỉ server emit như `smoke:ws`).
- Onboarding 4-step state machine không bị stuck ở step nào.
- AppShell logout button → `POST /_auth/logout` → cookie clear → redirect `/auth`.

Khác `smoke:beta`/`smoke:economy`/`smoke:ws`: focus vào **UI rendering + user interaction path**, không chỉ HTTP/WS contract.

### Khi nào chạy

- **BẮT BUỘC** trước khi merge bất kỳ PR đụng:
  - `apps/web/src/views/AuthView.vue` / `OnboardingView.vue` / `HomeView.vue` / `MissionView.vue` / `ShopView.vue` / `InventoryView.vue` / `LeaderboardView.vue` / `ProfileView.vue` / `MailView.vue` / `DungeonView.vue` / `SettingsView.vue`.
  - `apps/web/src/components/shell/AppShell.vue` / `ChatPanel.vue`.
  - `apps/web/src/router/*` (route guard logic, redirect rules).
  - `apps/web/src/stores/character.ts` / `auth.ts` (hydration + ws push consumption).
  - `apps/web/src/i18n/vi.json` (key naming → button text mismatch).
  - `apps/api/src/modules/auth/*` (register/login/logout flow, cookie set/clear).
  - `apps/api/src/modules/character/*` (onboard endpoint contract).
- **KHUYẾN NGHỊ** trước release tag closed beta v0.x (cùng `smoke:beta` + `smoke:economy` + `smoke:ws`).

### Chạy local

```bash
# 1. Lên infra (Postgres + Redis cho BullMQ + auth rate limiter)
pnpm infra:up
pnpm --filter @xuantoi/api prisma migrate deploy

# 2. Start API ở terminal riêng (cần env từ apps/api/.env)
pnpm --filter @xuantoi/api dev                # listen :3000

# 3. Start Web dev ở terminal khác
pnpm --filter @xuantoi/web dev                # listen :5173, proxy /api → :3000

# 4. Terminal khác — chạy E2E full
PLAYWRIGHT_BASE_URL=http://localhost:5173 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
E2E_FULL=1 \
pnpm --filter @xuantoi/web e2e --reporter=list
```

**Pass criteria**: exit code `0`, dòng cuối `<N> passed (<time>s)` với N = 16 (suite full sau 9q-8) hoặc N = 1 (smoke-only, không set `E2E_FULL=1`).

**Fail criteria**: exit code `1`, có ít nhất 1 spec `failed`. Khi fail, **DỪNG mở Phase 10 PR** và mở 1 PR riêng fix root cause trước. Trace + screenshot lưu ở `apps/web/test-results/`.

### Env overrides

| Env | Default | Công dụng |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:4173` | URL Web dev/preview server. Dùng `:5173` cho `pnpm dev`, `:4173` cho `pnpm preview` (default Playwright config tự spawn `vite preview`). |
| `PLAYWRIGHT_SKIP_WEBSERVER` | `0` | `1` để Playwright KHÔNG spawn `vite preview` (khi đã có `pnpm dev` chạy sẵn). |
| `E2E_FULL` | unset | `1` để chạy full 16 spec (sau 9q-8, tăng từ 11). Không set → chỉ chạy 1 spec smoke `AuthView` (không cần backend). |
| `API_BASE_URL` | `http://localhost:3000` | API root cho `helpers.ts` seed user qua `page.request`. |
| `REDIS_URL` | `redis://localhost:6379` | Redis cho `flushAuthRateLimits()` xoá `rl:register:*` / `rl:login:*` / `rl:forgot-password:*` trước mỗi spec. |

### Spec breakdown (16 spec, tổng ~22–25s)

**Spec 1–11 (PR #210, session 9q-7)**:

1. **AuthView smoke** (no backend) — form input render + 3 tab button. Luôn chạy, không cần `E2E_FULL`.
2. **Register UI → 4-step onboarding → /home** — full UI flow (3.5s).
3. **Cultivate toggle ON/OFF** — UI label `Nhập Định` ↔ `Xuất Định` + cross-check `/api/character/me.cultivating` flip.
4. **Daily login claim** — claim button → text `Đạo hữu đã nhận quà hôm nay` + `linhThach > 0`.
5. **Mission view tabs** — `Hằng Ngày` / `Hằng Tuần` / `Thiên Kiếp` click không crash.
6. **Shop browse + insufficient-funds disable** — fresh char 0 LT → mọi nút `Mua` `toBeDisabled`.
7. **Inventory empty state** — text `Túi đồ trống`.
8. **Chat WORLD send** — fill input + click `Gửi` → message render trong feed (verify ws end-to-end qua UI).
9. **Leaderboard 3 tab** — `[data-testid="leaderboard-tab-power|topup|sect"]` click + URL persist.
10. **Profile public view ownId** — `/profile/{characterId}` render char name.
11. **Logout** — click `Xuất Quan` → redirect `/auth`.

**Spec 12–16 (this PR, session 9q-8)**:

12. **Shop buy LINH_THACH (UI)** — register + onboard + claim daily login (+100 LT) qua API → goto `/shop` → tìm card "Sơ Kiếm" 30 LT → click `Mua` → `linhThach -= 30` cross-check qua `/api/character/me` poll trong 6s + verify inventory có 1 Sơ Kiếm qua `/api/inventory`.
13. **Inventory equip UI** — setup buy `so_kiem` qua API helper → goto `/inventory` → click `Mang` (i18n `inventory.equip`) → `expect.poll` API `equippedSlot === 'WEAPON'` trong 6s + UI button `Tháo` (i18n `inventory.takeOff`) hiện ra cho slot đã equip.
14. **Mail empty state** — fresh char goto `/mail` → heading `Thiên Đạo Thư Các` (i18n `mail.title`) + empty `Hộp thư trống rỗng` (i18n `mail.empty`) visible.
15. **Dungeon list visible + entry enabled** — fresh char goto `/dungeon` → heading `Luyện Khí Đường` + 3 dungeon catalog (Sơn Cốc / Hắc Lâm / Yêu Thú Động) + Sơn Cốc enter button `Khai ải` (i18n `dungeon.enter`) enabled (fresh stamina 100 ≥ Sơn Cốc staminaEntry 10) + cross-check API `character.stamina ≥ 10`. **KHÔNG enter combat** (random damage RNG + multi-monster turn-based → flaky, defer thành `smoke:combat` riêng).
16. **Settings page load** — goto `/settings` → heading `Tâm Pháp Đường` (i18n `settings.title`) + email seed render đúng + 3 input password (change-password section) visible.

### Flow chưa cover (defer)

- **Cultivation breakthrough end-to-end** — cần exp ≥ realm cost, không thực tế trong < 30s suite. Defer thành `smoke:cultivation` riêng.
- **Cultivation tick (BullMQ 30s)** — đã cover ngoài Playwright bằng `pnpm smoke:ws` với `SMOKE_WAIT_TICK_MS=40000` ($§11 file này).
- **Dungeon enter+clear+loot end-to-end** — random RNG damage + multi-monster turn-based → flaky. Defer thành `smoke:combat` riêng.
- **Mail claim attachment** — cần admin send mail. Defer cùng `smoke:admin`.
- **Inventory use HP pill** — fresh char hp full → no observable change. Defer.
- **Giftcode redeem** — cần admin create giftcode. Defer cùng `smoke:admin`.
- **Multi-tab same user real-time sync** — cần spawn 2 BrowserContext, phức tạp. Defer.
- **Topup IAP simulator** — cần env IAP sandbox. Defer ngoài beta scope.

### Rate limiter caveat

`apps/api/src/modules/auth/auth.service.ts` hardcode `REGISTER_RATE_LIMIT_MAX=5/IP/15min`. Suite chạy tạo 11 user mới cùng IP localhost → **bắt buộc flush Redis key trước mỗi spec**, helper tự lo qua `flushAuthRateLimits()` ở `globalSetup` + `test.beforeEach`. Nếu Redis unreachable, helper chỉ `console.warn` và return → suite vẫn chạy nhưng có thể fail 429 sau spec thứ 5. Manual flush:

```bash
docker exec xuantoi-redis redis-cli --scan --pattern 'rl:register:*' \
  | xargs -r docker exec -i xuantoi-redis redis-cli DEL
```

### CI gating

Playwright golden path chạy trong CI qua workflow gated `.github/workflows/e2e-full.yml` — KHÔNG required mọi PR (giữ CI nhanh), nhưng tự động trigger khi PR đụng FE / BE / shared / lockfile. Workflow chính `ci.yml` vẫn giữ nguyên: `build` job (typecheck/lint/test/build, có Postgres + Redis service) + `e2e-smoke` job (build artifact `vite preview` + 1 spec `AuthView` smoke, KHÔNG cần backend) — đó là CI bắt buộc. Workflow `e2e-full.yml` là **layer thứ 2** chạy 16 spec full-stack với Postgres + Redis + API + Web dev cùng chạy.

**Trigger workflow `e2e-full.yml`** (xem `.github/workflows/e2e-full.yml`):

| Trigger | Khi nào |
|---|---|
| `workflow_dispatch` | Bất kỳ ai có quyền Actions có thể chạy manual từ tab Actions → "e2e-full" → "Run workflow" (chọn branch). Dùng để smoke trước khi merge một PR docs-only / unrelated path. |
| `pull_request` (path-filtered) | PR đụng `apps/web/**`, `apps/api/**`, `packages/shared/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, hoặc chính `.github/workflows/e2e-full.yml`. |
| `push` to `main` (path-filtered) | Khi PR merge vào main hoặc ai đó push thẳng (KHÔNG khuyến khích). Cùng path filter với `pull_request`. |

**Concurrency**: `cancel-in-progress` theo `${{ github.workflow }}-${{ github.ref }}` — push commit mới lên cùng PR sẽ huỷ run cũ, tiết kiệm CI minutes.

**Workflow steps** (~5–8 phút cold cache, ~3–5 phút khi đã cache Playwright browsers):

1. Checkout + setup pnpm + Node 20.
2. `pnpm install --frozen-lockfile=false`.
3. `pnpm --filter @xuantoi/api prisma:generate` + `pnpm --filter @xuantoi/api exec prisma migrate deploy` (no seed/bootstrap cần — sect tự upsert qua `character/onboard`, shop catalog từ `packages/shared`).
4. `pnpm --filter @xuantoi/shared build` + `pnpm --filter @xuantoi/api build`.
5. Cache + install Playwright Chromium (cache key dựa `apps/web/package.json` + `pnpm-lock.yaml` hash).
6. Start API (`node apps/api/dist/src/main.js` background) → wait `/api/healthz` 60s + `/api/readyz` 30s.
7. Start Web (`pnpm --filter @xuantoi/web dev` background, vite dev :5173 proxy `/api` + `/ws` → :3000) → wait `:5173` 60s.
8. Run `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_FULL=1 E2E_API_BASE=http://localhost:3000 pnpm --filter @xuantoi/web exec playwright test --project=chromium --reporter=list`.
9. On failure: upload `apps/web/test-results/` + `apps/web/playwright-report/` + `.ci-logs/api.log` + `.ci-logs/web.log` thành artifact `playwright-full-{run_id}-{run_attempt}` retention 7d.

**Env workflow**:

- `DATABASE_URL=postgresql://mtt:mtt@localhost:5432/mtt?schema=public`
- `REDIS_URL=redis://localhost:6379`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` = ephemeral CI placeholder (`ci-e2e-*-not-for-prod-*`, KHÔNG trùng `change-me-*` / `dev-*-secret` blacklist).
- `NODE_ENV=development` → CORS dev fallback cho phép `http://localhost:5173`, helmet CSP off (vite dev cần inline script).
- `MAIL_TRANSPORT=console` (forgot-password test chưa cover, không cần SMTP).
- `MISSION_RESET_TZ=Asia/Ho_Chi_Minh`, `SESSION_COOKIE_DOMAIN=localhost`, `WEB_PUBLIC_URL=http://localhost:5173`.

**Pass criteria CI**: workflow `e2e-full.yml` → green; `Run Playwright golden path (E2E_FULL=1)` step exit 0, dòng cuối `16 passed (<time>s)`.

**Fail criteria CI**: 1+ spec fail → workflow đỏ. Reviewer download artifact `playwright-full-{run_id}-{run_attempt}` để xem trace + screenshot + server log. KHÔNG được skip spec hoặc tắt workflow để PR xanh giả; root-cause + fix trước.

**Khi PR đụng `apps/web/**` / `apps/api/**` / `packages/shared/**`**: reviewer phải verify workflow `e2e-full` xanh trong PR Status Checks. Nếu workflow KHÔNG run (PR docs-only), chạy manual qua `workflow_dispatch` nếu cần xác nhận.

**Verified status (post #212 merge, session 9r-2)**: workflow đã chạy thật trên main HEAD `6fd1120` (run `25203605650`) — 1m35s tổng (Playwright step 20s với browsers cache hit), 16/16 spec pass, GREEN. PR #212 ban đầu run cold-cache ~5–8 phút; sau khi cache Playwright browsers stick (key dựa `apps/web/package.json` + `pnpm-lock.yaml`), warm runs ổn định ~1m30s–2m. Cancel-in-progress concurrency hoạt động đúng (push lên cùng PR huỷ run cũ).

**Roadmap (post-PR này)**:
- Sau 2–3 tuần stable, đánh giá có nên upgrade `e2e-full` thành required check trong branch protection rules.
- Nếu tiếp tục stable, xem xét add 1 spec `forgot-password` (cần SMTP Mailhog service container).

### Deferred sub-checks (không có trong spec hiện tại)

- **Cultivation breakthrough end-to-end**: cần exp ≥ cost realm — không thực tế trong < 30s suite. Defer cho `smoke:cultivation` riêng.
- **Combat dungeon**: cần seed monster + skill — defer cho Phase 10 content content QA.
- **Sect join/leave**: cần seed sect ≥ 2 + member quota — defer.
- **Boss fight**: cần seed boss + party — defer.
- **Mail receive + claim attachment**: cần admin send mail — defer cùng `smoke:admin`.
- **Giftcode redeem**: cần admin create giftcode — defer cùng `smoke:admin`.
- **Multi-tab same user real-time sync**: cần spawn 2 BrowserContext với cookie share — phức tạp, defer.
- **Topup IAP simulator**: cần env IAP sandbox — defer ngoài beta scope.

### Không có dependency mới

`apps/web/e2e/helpers.ts` (~200 lines) + `apps/web/e2e/global-setup.ts` (~30 lines) + `apps/web/e2e/golden.spec.ts` (rewrite) — Playwright + ioredis đã là devDep workspace. ioredis load qua `createRequire(apps/api/package.json)` từ `apps/api/node_modules`. KHÔNG install thêm dep ở root.

### Giới hạn

- Không cleanup user — như `smoke:beta` / `smoke:economy` / `smoke:ws`. Cleanup: `DELETE FROM "User" WHERE email LIKE 'e2e_%@local.test'` (cẩn thận FK cascade tới Character/Inventory/CurrencyLedger).
- 11 spec chạy `--workers=1` (default Playwright config khi `webServer` không spawn) để tránh DB write conflict — nếu cần parallel, thêm `--workers=N` với DB schema riêng cho mỗi worker.
- Timing assertion (`waitCharacter` polling 200ms × 30 = 6s) có thể flaky trên CI runner chậm — local Linux máy dev pass < 50ms mỗi poll.
