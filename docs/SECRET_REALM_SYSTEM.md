# Secret Realm / Bí Cảnh System

> **Status**: Phase 44.1 (PR #591) — runtime guards (cooldown / daily
> limit / active-run / claim idempotent). Phase trước (40.x) đã có
> catalog + entry/run state machine.

## 1. Modules

| File | Vai trò |
|---|---|
| `packages/shared/src/secret-realm.ts` | Catalog `SECRET_REALMS`, reward caps, helpers. |
| `apps/api/src/modules/secret-realm-runtime/secret-realm-runtime.service.ts` | Runtime: `list` / `enter` / `progress` / `complete` / `claim` / `history`. |
| `apps/api/src/modules/secret-realm-runtime/secret-realm-runtime.controller.ts` | Player endpoint `/secret-realms/*`. |
| `prisma/schema.prisma` model `CharacterSecretRealmRun` | Run state + objective progress JSON. |

## 2. Catalog (shared)

`SECRET_REALMS` — readonly array of `SecretRealmDef`:

| Field | Mục đích |
|---|---|
| `key` | Unique catalog key (e.g. `sr_pham_cavern`). |
| `requiredRealmOrder` | Cảnh giới min order để unlock. |
| `cooldownHours` | Cooldown sau khi claim/cleared. |
| `objectives` | List `{key, kind, target, titleVi/En}`. |
| `rewardProfile` | `{linhThach, exp, tienNgoc: 0, items: []}` — không cấp tiên ngọc. |

Caps shared `SECRET_REALM_REWARD_CAPS`:

| Field | Value | Mục đích |
|---|---|---|
| `linhThachMax` | `1500` | Cap LT/run. |
| `expMax` | `4000` | Cap EXP/run. |
| `dailyRunsPerRealm` | `1` | 1 run / realm / UTC day. |

## 3. Run state machine

```
ENTERED → CLEARED → CLAIMED
       ↘  (abandoned / timeout → no state change, ENTERED giữ)
```

- `enter(userId, realmKey)` → `ENTERED`, `objectiveProgressJson = {key: 0}`.
- `progress(userId, runId, objKey, delta)` → clamp `progress + delta ≤
  target`. Throw `SECRET_REALM_OBJECTIVE_INVALID` nếu key sai.
- `complete(userId, runId)` → chỉ chạy khi tất cả objective ≥ target.
  Update `status = CLEARED, clearedAt = now`.
- `claim(userId, runId)` → CAS `status: 'CLEARED' → 'CLAIMED'`,
  `claimedAt = now`. Grant LT + EXP qua `CurrencyService.applyTx({reason:
  'SECRET_REALM_CLAIM', refId: runId})`. Idempotent — gọi 2 lần lần 2
  no-op (`claimed: false`).

## 4. Guards (Phase 44.1)

### 4.1. Realm-order gate

```ts
if (def.requiredRealmOrder > realmOrder) throw SECRET_REALM_REALM_LOCKED;
```

Character `realmKey` → `realmOrder` lookup. UI render LOCKED row với
required realm name.

### 4.2. Cooldown

```ts
const recent = await findFirst({
  status: { in: ['CLAIMED', 'CLEARED'] },
  orderBy: { startedAt: 'desc' },
});
if (recent && (now - (recent.claimedAt ?? recent.clearedAt)) <
    def.cooldownHours * 3_600_000) throw SECRET_REALM_COOLDOWN;
```

Cooldown TÍNH TỪ `claimedAt` (hoặc `clearedAt` nếu abandon trước claim).
UI hiển thị `cooldownRemainingMs` qua `list()` để player biết khi nào
vào được.

### 4.3. Active-run guard

```ts
const active = await findFirst({
  status: { in: ['ENTERED', 'CLEARED'] },
});
if (active) throw SECRET_REALM_RUN_ACTIVE;
```

**Race window**: `findFirst` + `create` không có composite UNIQUE → có
race window vài ms. Test `Promise.allSettled` cover trường hợp serial.
Hardening hoàn toàn cần `(characterId, secretRealmKey) WHERE status IN
('ENTERED', 'CLEARED')` partial unique index → **TODO Phase 44.2**.

### 4.4. Daily limit

```ts
const todayStart = new Date(`${utcDateKey()}T00:00:00.000Z`);
const todayCount = await count({
  startedAt: { gte: todayStart },
});
if (todayCount >= SECRET_REALM_REWARD_CAPS.dailyRunsPerRealm)
  throw SECRET_REALM_DAILY_LIMIT;
```

Đếm tất cả run được tạo trong UTC date hôm nay cho realm này, bất kể
status (kể cả CLEARED/CLAIMED).

### 4.5. Claim idempotent

`claim()` dùng `updateMany({where: {status: 'CLEARED'}, data: {status:
'CLAIMED', claimedAt: now}})` → CAS. Nếu count === 0 → run đã CLAIMED
từ trước → return `{claimed: false}`. Không double grant.

## 5. UI condition display (player)

`list(userId)` trả entry cho mọi realm với:

| Field | Mục đích |
|---|---|
| `status` | `LOCKED` / `AVAILABLE` / `COOLDOWN` / `ACTIVE` / `DAILY_LIMIT` / `CLAIMED` |
| `requiredRealmOrder` | Hiển thị "Cần cảnh giới X". |
| `cooldownHours` | Hiển thị cooldown nominal. |
| `cooldownRemainingMs` | Hiển thị "Còn HH:MM:SS". |
| `entryTicketItemKey` | Hiển thị "Cần ticket X" nếu có (optional). |
| `rewardProfile` | Hiển thị "Thưởng dự kiến: LT + EXP + items". |
| `objectives` | List target/progress cho UI render checklist. |

## 6. Tests (Phase 44.1)

| # | Test | File |
|---|---|---|
| 14 | Parallel enter 3× — chỉ 1 winner, không spawn vô hạn | `secret-realm-runtime.service.test.ts` |
| 15 | Cooldown sau CLAIMED — enter lại → `SECRET_REALM_COOLDOWN` | `secret-realm-runtime.service.test.ts` |
| 15 | Daily-limit — same UTC day → `SECRET_REALM_DAILY_LIMIT` | `secret-realm-runtime.service.test.ts` |
| 16 | Claim 2× — lần 2 `claimed: false`, không double grant | `secret-realm-runtime.service.test.ts` |
| + | Reward cap `≤ SECRET_REALM_REWARD_CAPS.linhThachMax / expMax` | `secret-realm-runtime.service.test.ts` |
| + | Ledger entry `reason: 'SECRET_REALM_CLAIM'` | `secret-realm-runtime.service.test.ts` |

## 7. Risks & follow-ups

- **Race window**: enter() có thể fail-trigger nếu 2 request đúng <1ms.
  Partial unique index cần thiết — Phase 44.2.
- **Reward cap tăng theo tier**: hiện tại flat cap `linhThachMax = 1500`
  cho mọi realm. Phase 44.2 có thể wire per-tier cap qua catalog.
- **Battle integration**: objectives `defeat_guardian` / `clear_rooms`
  hiện chỉ là counter — chưa wire vào combat thật. Phase 44.2 cần
  combat hook báo progress.
- **History pagination**: `history(userId, limit)` hiện hard-cap; nếu
  player có hàng nghìn run cần cursor pagination.
