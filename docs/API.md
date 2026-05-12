# Xuân Tôi — API Inventory

Tóm tắt mọi endpoint REST + WebSocket event đang có ở `@xuantoi/api`. Mọi response REST bọc trong `{ ok: boolean, data?: T, error?: { code, message } }` trừ `/healthz` / `/readyz` / `/version`.

**Global prefix**: tất cả route REST đều có prefix `/api/` (set trong `apps/api/src/main.ts` qua `app.setGlobalPrefix('api')`). Các path bên dưới ghi tương đối — ví dụ `/character/me` thực tế là `/api/character/me`.

## Auth cookie

- `xt_access` (JWT, 15 phút, httpOnly, SameSite=Lax)
- `xt_refresh` (JWT, 30 ngày, httpOnly, SameSite=Lax)

Đổi mật khẩu / logout-all → `passwordVersion`++ → access token cũ bị reject ở guard. Logout đơn lẻ chỉ revoke refresh row hiện tại + clear cookie (không bump `passwordVersion` — intentional trade-off, xem `docs/SECURITY.md`).

## Health & Metadata

| Method | Path       | Auth | Mô tả |
|--------|------------|------|-------|
| GET    | `/healthz` | —    | Liveness. 200 luôn nếu process chạy; trả `{ ok, uptimeMs, ts }`. |
| GET    | `/readyz`  | —    | Readiness. Check DB + Redis. 200 ok, 503 khi fail. |
| GET    | `/version` | —    | `{ name, version, commit, node, ts }`. |
| GET    | `/admin/metrics` | ADMIN | **Phase 17.5** — Runtime metrics snapshot (admin-only, `@RequireAdmin()` — PLAYER + MOD reject 403). JSON shape `{ ok: true, data: MetricsSnapshot }` (xem dưới). Không audit log (polled high-frequency). Không trả PII / secret / cookie / token. |

### Phase 17.5 — `MetricsSnapshot` payload

Shape `{ schema: 1, generatedAt, system, api, ws, queue, cron, errors[] }`.
Mỗi block fail-soft: nếu collector lỗi → block null + entry trong `errors[]`,
KHÔNG bao giờ throw 500.

- **`system`**: `{ uptimeMs, node: { version, platform }, memory: { rssBytes, heapUsedBytes, heapTotalBytes, externalBytes }, cpu: { userMicros, systemMicros }, pid, appVersion, collectedAt }`. Snapshot cumulative — caller tự diff giữa 2 lần poll.
- **`api.request`**: `{ totalRequests, totalDurationMs, avgDurationMs, byMethod: { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD, OTHER }, byStatusBucket: { 1xx, 2xx, 3xx, 4xx, 5xx, other }, inFlight, lastResetAt }`. **Bounded** — không track per-path để tránh memory leak (cardinality unbounded). Skip `/api/healthz`, `/api/readyz`, `/api/admin/metrics`. Per-path histogram để follow-up Phase 17.6.
- **`ws`**: `{ onlineUsers, serverBound }` hoặc null nếu collector lỗi. `onlineUsers` = số user (1 user có thể có nhiều socket, count theo user).
- **`queue`**: `{ available, queues: [{ name, waiting, active, delayed, completed, failed }] }`. 7 queue: `cultivation`, `ops`, `mission-reset`, `territory-cron`, `sect-season-cron`, `ledger-checker-cron`, `anomaly-scanner-cron`. Đọc qua Redis `llen`/`zcard` trên prefix `bull:<name>:<state>`. Redis down → `available=false`, `queues=[]`.
- **`cron`**: `{ available, jobs: [{ job, lastRunAt, lastStatus, contextKey }] }`. 4 job: `economy-ledger-check` (status từ `EconomyLedgerCheckRun.status`: RUNNING/OK/ISSUES_FOUND/ERROR), `territory-settle` (`SectTerritorySettlementSnapshot.settledAt`), `territory-decay` (`SectTerritoryDecayLog.triggeredAt`), `sect-season-snapshot` (`SectSeasonSnapshot.finalizedAt`). `lastRunAt=null` nếu chưa run lần nào. 1 query lỗi không block job khác.
- **`errors[]`**: `[{ stage: 'system'|'api'|'ws'|'queue'|'cron', message }]`. Empty trong happy path. KHÔNG chứa stack trace, KHÔNG chứa `req.body`.

**Auth/Security**:
- `@UseGuards(AdminGuard)` — UNAUTH 401, banned 403. Cookie `xt_access` + `xt_refresh` (xem [Auth cookie](#auth-cookie)).
- `@RequireAdmin()` — chỉ ADMIN, MOD bị reject 403. PLAYER cũng reject 403.
- Payload đã pass test scan substring: KHÔNG có `cookie/password/jwt/refreshToken/userId/characterId/email`.

## Auth — `AuthController` (prefix `_auth`)

| Method | Path                      | Auth | Mô tả |
|--------|---------------------------|------|-------|
| POST   | `/_auth/register`         | —    | Body `{ email, password }`. 201 set cookie. **Rate limit per-IP 5 / 15min** (PR #60). |
| POST   | `/_auth/login`            | —    | Rate limit 5 fail / 15p / IP+email qua `LoginAttempt`. |
| POST   | `/_auth/logout`           | Yes  | Revoke refresh row hiện tại + clear cookie. |
| POST   | `/_auth/logout-all`       | Yes  | Revoke toàn bộ refresh token của user (mọi thiết bị). FE confirm modal trước (PR #83/#85). |
| POST   | `/_auth/refresh`          | Yes (xt_refresh) | Rotation + reuse-detection. Sai → revoke cả chain. |
| GET    | `/_auth/session`          | Yes  | Trả `{ user: PublicUser }`. |
| POST   | `/_auth/change-password`  | Yes  | `{ oldPassword, newPassword }`. `passwordVersion`++ → kill mọi phiên. |
| GET    | `/_auth/sessions`         | Yes  | **Phase 18.2** — list `UserSession` của chính user. Query `includeRevoked=true` để xem REVOKED/EXPIRED (mặc định chỉ ACTIVE). Mỗi item có `current: boolean` (true nếu match refresh cookie hiện tại). Response: `{ ok: true, data: { sessions: UserSessionSummary[], generatedAt } }`. KHÔNG bao giờ trả `hashedToken` / `jti`. |
| DELETE | `/_auth/sessions/:id`     | Yes  | **Phase 18.2** — revoke session của chính user. Self-ownership guard: mask `SESSION_NOT_FOUND 404` nếu session không thuộc user (chống enumeration). Idempotent — revoke 2 lần OK. Nếu là current session → clear cookies (FE redirect login). Audit `SESSION_REVOKED` reason `USER_LOGOUT`. |

## Character — `CharacterController`

| Method | Path                     | Auth | Mô tả |
|--------|--------------------------|------|-------|
| GET    | `/character/me`          | Yes  | Nhân vật của user hoặc `null`. |
| GET    | `/character/profile/:id` | Yes  | Public profile. **Rate limit per-IP 120 / 15min** (PR #62 — anti-scrape). 404 NOT_FOUND nếu không tồn tại. |
| GET    | `/character/state`       | Yes  | Giống `me` + 404 NO_CHARACTER nếu chưa onboard. |
| POST   | `/character/onboard`     | Yes  | Body `{ name, sectKey: 'thanh_van' \| 'huyen_thuy' \| 'tu_la' }`. |
| POST   | `/character/cultivate`   | Yes  | Body `{ cultivating: boolean }`. Bật/tắt Nhập Định (tick qua cron BullMQ). |
| POST   | `/character/breakthrough` | Yes | Đột phá cảnh giới khi đủ EXP + đỉnh stage. **Phase 14.3.A**: nếu transition kế tiếp có `TribulationDef` (kim_dan→nguyen_anh trở lên), throw `TRIBULATION_REQUIRED` để FE redirect tới `/tribulation`. Low-tier (luyenkhi→truc_co, truc_co→kim_dan) tiếp tục dùng path cũ. |
| GET    | `/character/tribulation/preview` | Yes | **Phase 14.3.A + 14.3.B + 14.3.C** — read-only deterministic preview. Trả `{ preview }` với `preview = null` nếu transition không cần kiếp (low-tier hoặc realm cuối) hoặc `TribulationPreview` shape `{ requirement, fromRealmKey, toRealmKey, atPeak, def, successChance: { base, supportBonus, elementAdjustment, raw, final, floorHit, ceilHit }, supports[], supportTotalBonus, rewardHint, penaltyHint, cooldownAt, taoMaUntil, availableSupportItems[], maxSelectedSupportItems }`. **Phase 14.3.B**: `supports[]` populate từ 4 provider (item / buff / equipment / talent) catalog — mỗi entry `{ source, key, bonus, label?, element? }`; `successChance.supportBonus` là tổng additive đã clamp; `elementAdjustment` (rename từ `affinity`) bonus/penalty Ngũ Hành primary vs kiếp; `raw = base + supportBonus + elementAdjustment` pre-clamp; `floorHit/ceilHit` báo FE render warning khi clamp về `[0.05, 0.95]`. **Phase 14.3.C**: `availableSupportItems[]` resolve từ shared catalog × inventory qty>0 (chỉ kind PILL_HP/PILL_MP/PILL_EXP/MISC, KHÔNG equipment); mỗi entry `{ itemKey, label, bonus, qty }`. `maxSelectedSupportItems` = `TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS` (= 3). KHÔNG roll RNG, KHÔNG ghi `TribulationAttemptLog`, **KHÔNG consume item / KHÔNG decrement buff** (read-only). |
| GET    | `/character/tribulation/encounter/current` | Yes | **Phase 14.3.D** — read-only encounter snapshot. Trả `{ encounter }` với `encounter = null` nếu transition không có catalog encounter (low-tier / no def). Nếu có: `TribulationEncounterCurrentView` shape `{ requirement: true, atPeak, fromRealmKey, toRealmKey, tribulationKey, severity, type, encounter: { key, element, effectType (BURST/SUSTAIN/POISON_RECOVERY/ARMOR_CRIT/DEFENSE_ENDURANCE), name, description, difficulty, phaseCount, successThreshold, requiredPowerHint, failPenaltyMultiplier, rewardHintMultiplier, playerHpMax, playerPrimaryElement, elementAdvantage }, successChance, pending: TribulationEncounterRowView \| null, cooldownAt, taoMaUntil }`. `elementAdvantage` Ngũ Hành: `+2` đồng hệ / `+1` player counter encounter (hoặc encounter sinh player) / `0` trung tính / `-1` player sinh encounter / `-2` encounter counter player. KHÔNG mutate state (read-only). |
| POST   | `/character/tribulation/encounter/start` | Yes | **Phase 14.3.D** — start tribulation encounter (snapshot selected items). Body: `{ selectedSupportItemKeys?: string[] }` (≤ 3 keys, optional; same shape & validation Phase 14.3.C). Server: (1) verify peak gate + cooldown + character có def kiếp + có encounter catalog cho element; (2) validate selectedSupportItemKeys ∈ shared catalog + ownership; (3) **idempotent**: nếu đã có pending row cho cùng `tribulationKey`, trả pending row đó (KHÔNG tạo mới); ngược lại tạo `TribulationEncounter` row state=`pending`. Errors: 409 `NOT_AT_PEAK/COOLDOWN_ACTIVE/NO_NEXT_REALM/NO_TRIBULATION_FOR_TRANSITION/ENCOUNTER_ALREADY_PENDING`, 400 `INVALID_SUPPORT_SELECTION/TOO_MANY_SUPPORT_ITEMS/DUPLICATE_SUPPORT_ITEM/INVALID_SUPPORT_ITEM`, 409 `SUPPORT_ITEM_MISSING`. Trả `{ encounter: TribulationEncounterRowView }`. |
| GET    | `/character/tribulation/battle/current` | Yes | **Phase 14.3.E.1** — return active mini-battle (or null). Trả `{ battle: TribulationMiniBattleView \| null }`. Mini-battle row có shape `{ id, characterId, encounterId, tribulationKey, realmKey, effectType (BURST/SUSTAIN/POISON_RECOVERY/ARMOR_CRIT/DEFENSE_ENDURANCE), element, difficulty, state (PENDING/ACTIVE/RESOLVED/FAILED/EXPIRED), currentPhase, phaseCount, playerHp, playerHpMax, tribulationHp, tribulationHpMax, shield, dotStacks, focusCharge, seed, actionLog: TribulationBattleEvent[], result: TribulationMiniBattleSummary \| null, startedAt, resolvedAt, createdAt, updatedAt }`. Read-only. Khi feature flag `TRIBULATION_MINI_BATTLE_ENABLED=false` (default) → trả `{ battle: null }` (KHÔNG throw). Errors: 401 `UNAUTHENTICATED`, 404 `NO_CHARACTER`, 501 `TRIBULATION_MINI_BATTLE_UNAVAILABLE`. |
| POST   | `/character/tribulation/battle/start`   | Yes | **Phase 14.3.E.1** — start a new mini-battle. Body: `{ selectedSupportItemKeys?: string[] }` (≤ 3 keys, optional; same shape & validation Phase 14.3.C). Server: (1) verify feature flag enabled (501 nếu disabled); (2) verify peak gate + cooldown + character có encounter catalog cho element; (3) reuse pending encounter row hoặc tạo mới Phase 14.3.D — tránh bypass gate; (4) tạo `TribulationMiniBattle` row state=`PENDING` với seed deterministic + `effectType` từ catalog encounter + initial snapshot (`playerHp/Max`, `tribulationHp/Max`, `phaseCount` theo severity). Errors: 409 `MINI_BATTLE_ALREADY_ACTIVE/NOT_AT_PEAK/COOLDOWN_ACTIVE/NO_NEXT_REALM/NO_TRIBULATION_FOR_TRANSITION/ENCOUNTER_ALREADY_PENDING`, 400 `INVALID_SUPPORT_SELECTION/TOO_MANY_SUPPORT_ITEMS/DUPLICATE_SUPPORT_ITEM/INVALID_SUPPORT_ITEM`, 409 `SUPPORT_ITEM_MISSING`, 501 `MINI_BATTLE_DISABLED`. Trả `{ battle: TribulationMiniBattleView }`. Metric counter `tribulation_battle_started++`. |
| POST   | `/character/tribulation/battle/action`  | Yes | **Phase 14.3.E.1** — submit one player action. Body: `{ battleId: string, action: 'ATTACK' \| 'DEFEND' \| 'FOCUS' \| 'CLEANSE' \| 'CHANNEL', clientNonce?: string }`. Server: (1) load battle row, verify owner = current character; (2) verify state=PENDING/ACTIVE; (3) validate action input via `validateTribulationBattleAction`; (4) **idempotent**: nếu cùng `clientNonce` đã xài → trả snapshot hiện tại không advance; (5) compute next snapshot via `computeTribulationPhaseResult` (deterministic seeded RNG) + apply effectType-specific damage/shield/heal/dot/crit; (6) **race-safety**: optimistic `updateMany({where: {id, state, currentPhase}})` — nếu concurrent caller đã advance phase → throw `MINI_BATTLE_INVALID_ACTION`; (7) auto-transition PENDING→ACTIVE→RESOLVED/FAILED khi terminal điều kiện (player HP ≤ 0 → FAILED; tribulation HP=0 hoặc completed all phases → RESOLVED). Errors: 400 `MINI_BATTLE_INVALID_ACTION/INVALID_BODY`, 404 `MINI_BATTLE_NOT_FOUND`, 409 `MINI_BATTLE_TERMINAL`, 501 `MINI_BATTLE_DISABLED`. Trả `{ battle: TribulationMiniBattleView }`. Action log append-only — mỗi action thêm 1 entry `{ phase, action, damage, shield, heal, dot, crit, result, messageKey }`. |
| POST   | `/character/tribulation/battle/resolve` | Yes | **Phase 14.3.E.1** — resolve a terminal mini-battle apply WIN/LOSE outcome. Body: `{ battleId: string }`. Server: (1) load battle, verify owner; (2) verify state=RESOLVED/FAILED (KHÔNG cho resolve trước khi terminal); (3) **idempotent**: nếu `resultJson.attemptLogId` đã set → reconstruct outcome từ existing `TribulationAttemptLog` row (KHÔNG double reward / KHÔNG double consume support / KHÔNG double realm-advance); (4) call `TribulationService.runAttemptInTxWithForcedOutcome(tx, characterId, supports, {success, finalHp}, rng, now)` — reuse pipeline realm advance + reward + consume support + penalty + title unlock + achievement track 1:1 với legacy `attemptTribulation`; (5) link `attemptLogId` vào `resultJson` + encounter `resolvedAttemptLogId` (nếu encounter row pending). Errors: 400 `MINI_BATTLE_NOT_TERMINAL/INVALID_BODY`, 404 `MINI_BATTLE_NOT_FOUND`, 501 `MINI_BATTLE_DISABLED`. Trả `{ tribulation: TribulationAttemptOutcomeView }` (cùng shape POST `/character/tribulation`). Metric counter `tribulation_battle_resolved++` (success) hoặc `tribulation_battle_failed++` (lose). |
| POST   | `/character/tribulation/encounter/resolve` | Yes | **Phase 14.3.D** — atomic resolve pending encounter. Body: `{}`. Server: (1) load pending row; (2) call `runAttemptInTx` extracted helper với `selectedSupportItemKeys` từ pending row → simulate + consume + ghi `TribulationAttemptLog` + atomic update character/currency/buff (SAME logic legacy `POST /character/tribulation`); (3) update encounter row state=`resolved` với `resolvedAttemptLogId` link. **Idempotent**: re-call sau resolved trả cached outcome reconstructed từ log (KHÔNG double breakthrough/consume/reward). Errors: 404 `NO_PENDING_ENCOUNTER`, 503 `TRIBULATION_UNAVAILABLE/INVENTORY_UNAVAILABLE`. Outcome cùng shape POST `/character/tribulation`: `{ tribulation: TribulationOutcomeView }`. |
| POST   | `/character/tribulation`        | Yes | **Phase 11.6.B + 14.3.C** — server-authoritative tribulation attempt (legacy 1-shot path; Phase 14.3.D thêm flow encounter `start → resolve` ở 3 endpoint riêng phía trên, dùng cùng `runAttemptInTx` simulation logic). Body: `{ selectedSupportItemKeys?: string[] }` (≤ 3 keys, optional; omit / `[]` = no support). Server: (1) verify peak gate + cooldown + character có def kiếp; (2) verify selected items ∈ shared catalog + ownership + qty>0; (3) **consume items in tx atomic** với attempt — mỗi item ledger reason `TRIBULATION_SUPPORT_CONSUME` `refType=TribulationAttemptLog`; (4) **server-side recalc** support bonus từ 4 nguồn (selected items + equipment + buffs + talents), KHÔNG tin FE bonus value; (5) simulate kiếp deterministic + ghi `TribulationAttemptLog`. Cả success path + fail path đều consume item (no free retry). Idempotent: pre-check ownership → consume fail → throw `SUPPORT_ITEM_MISSING` → tx rollback → KHÔNG mất EXP. Errors: 400 `INVALID_SUPPORT_SELECTION/TOO_MANY_SUPPORT_ITEMS/DUPLICATE_SUPPORT_ITEM/INVALID_SUPPORT_ITEM`, 409 `SUPPORT_ITEM_MISSING`, 409 `NOT_AT_PEAK/COOLDOWN_ACTIVE/NO_NEXT_REALM/NO_TRIBULATION_FOR_TRANSITION`, 404 `NO_CHARACTER`, 503 `TRIBULATION_UNAVAILABLE/INVENTORY_UNAVAILABLE`. Outcome: `{ tribulation: { success, tribulationKey, fromRealmKey, toRealmKey, severity, type, wavesCompleted, totalDamage, finalHp, attemptIndex, reward, penalty, logId, consumedSupportItems[]: { itemKey, label, bonus }, supportTotalBonus, successChance: { base, supportBonus, elementAdjustment, raw, final, floorHit, ceilHit } } }`. |
| GET    | `/character/tribulation/log?limit=` | Yes | **Phase 11.6.B** — read-only attempt log. `?limit=` clamp 1..`TRIBULATION_LOG_MAX_LIMIT` (= 100), default `TRIBULATION_LOG_DEFAULT_LIMIT` (= 20). Invalid (non-numeric / ≤0) → fallback default. Trả `{ ok: true, data: { rows: TribulationAttemptLogRow[], limit } }` DESC theo `createdAt`. Mỗi `row` shape `{ id, attemptedAt (createdAt), fromRealmKey, toRealmKey, tribulationKey, severity, type, success, wavesCompleted, totalDamage, finalHp, attemptIndex, reward, penalty, supportTotalBonus, successChance, items: { itemKey, label, bonus }[] }`. BigInt fields cast → string ở service để FE serialize an toàn. Read-only — KHÔNG mutate state. Errors: 401 `UNAUTHENTICATED`, 404 `NO_CHARACTER`, 501 `TRIBULATION_UNAVAILABLE`. |
| GET    | `/character/titles`        | Yes | Phase 11.9.C — `{ owned[], catalog (26 def), equipped }`. `owned[]` sort `unlockedAt asc`. |
| POST   | `/character/title/equip`   | Yes | Phase 11.9.C — `{ titleKey }` → set `Character.title`. 404 `TITLE_NOT_FOUND` khi key ∉ catalog; 409 `TITLE_NOT_OWNED` khi chưa unlock. Idempotent re-equip. |
| POST   | `/character/title/unequip` | Yes | Phase 11.9.C — clear `Character.title = null`. Idempotent (no-op khi đang null). |
| GET    | `/character/buffs`         | Yes | Phase 11.8.D — list `active[]` non-expired, auto-prune trước khi return. Sort `expiresAt asc`. Mỗi entry `{ buffKey, stacks, source, expiresAt (ISO), def }`. |
| POST   | `/character/equipment/reforge`         | Yes | **Phase 15.0.A** — re-roll substat phụ (atk/def/hpMax/mpMax/spirit) cho 1 trang bị. Body `{ equipmentInventoryItemId: string }`. Server (atomic `$transaction`): (1) verify ownership + `isUpgradableItemKind` + `def.slot != null`; (2) compute cost qua `getReforgeCost(quality)` (PHAM 80 / LINH 240 / HUYEN 720 / TIEN 2400 / THAN 7200 linhThach + material `tinh_thiet`/`yeu_dan`/`han_ngoc`); (3) `updateMany` material `gte` guard → ghi `ItemLedger` reason `EQUIPMENT_REFORGE_COST` `refType=InventoryItem` `refId=<inventoryItemId>` qtyDelta < 0; (4) `CurrencyService.applyTx` linhThach reason `EQUIPMENT_REFORGE` delta < 0 (`gte` guard); (5) `rollReforgedSubstats(quality, rng)` overwrite `InventoryItem.substatsJson` (slots PHAM 1 / LINH 2 / HUYEN 3 / TIEN 3 / THAN 4); (6) ghi `EquipmentReforgeHistory { characterId, inventoryItemId, itemKey, beforeJson, afterJson, costJson, createdAt }`. Outcome `{ ok: true, data: { reforge: { inventoryItemId, before: EquipmentSubstat[], after: EquipmentSubstat[], cost: { linhThachCost, materialKey, materialQty } } } }`. Errors: 404 `EQUIPMENT_NOT_FOUND` (sai id hoặc khác character), 400 `INVALID_EQUIPMENT` (kind không upgradable: PILL/ORE/SKILL_BOOK/MISC), 409 `INSUFFICIENT_FUNDS`, 409 `INSUFFICIENT_MATERIAL`. **Concurrent-safe**: 2 thread reforge cùng item → 1 thread thắng (`updateMany count=1`), thread kia hoặc `INSUFFICIENT_FUNDS` (currency `gte`) hoặc `INSUFFICIENT_MATERIAL` (material `gte`) → no double spend / no corrupt stat. KHÔNG phá hủy trang bị (fail = rollback, success = overwrite substat). |
| POST   | `/character/equipment/enchant`         | Yes | **Phase 15.0.A** — gắn 1 hệ Ngũ Hành (`kim`/`moc`/`thuy`/`hoa`/`tho`) lên trang bị + level 0→1..MAX_ENCHANT_LEVEL (5). Body `{ equipmentInventoryItemId: string, element: ElementKey }`. Server (atomic `$transaction`): (1) verify ownership + upgradable kind; (2) verify `element ∈ ELEMENTS`; (3) lock check — nếu `enchantLevel >= 1` && `enchantElement !== element` → 409 `ELEMENT_LOCKED` (foundation phase chưa hỗ trợ chuyển hệ); (4) cap check — nếu `enchantLevel >= MAX_ENCHANT_LEVEL` → 409 `MAX_ENCHANT_REACHED`; (5) compute cost qua `getEnchantCost(quality, currentLevel)` = `baseLinhThachCost × (currentLevel+1)` (PHAM 100 / LINH 320 / HUYEN 960 / TIEN 3000 / THAN 9000 base; material same as reforge); (6) consume material + currency (cùng pattern reforge: `EQUIPMENT_ENCHANT_COST` ItemLedger + `EQUIPMENT_ENCHANT` CurrencyLedger); (7) update `enchantElement = element`, `enchantLevel = currentLevel + 1`; (8) ghi `EquipmentEnchantHistory { characterId, inventoryItemId, itemKey, beforeElement, beforeLevel, afterElement, afterLevel, costJson, createdAt }`. Outcome `{ ok: true, data: { enchant: { inventoryItemId, beforeElement, beforeLevel, afterElement, afterLevel, cost } } }`. Errors: 404 `EQUIPMENT_NOT_FOUND`, 400 `INVALID_EQUIPMENT/INVALID_ELEMENT`, 409 `INSUFFICIENT_FUNDS/INSUFFICIENT_MATERIAL/MAX_ENCHANT_REACHED/ELEMENT_LOCKED`. Per-level bonus map (`ELEMENTAL_ENCHANT_EFFECTS`): Mộc → +12 hpMax/level, Hỏa → +2 atk/level, Thổ → +2 def/level, Kim → +1 atk/level, Thủy → +6 mpMax/level (bonus deliberately nhỏ để không phá Arena/PvE balance). |
| POST   | `/character/equipment/upgrade-preview` | Yes | **Phase 15.0.A** — read-only preview cho FE render. Body `{ equipmentInventoryItemId: string }`. KHÔNG mutate state, KHÔNG ghi ledger / history. Trả `{ ok: true, data: { preview: { inventoryItemId, itemKey, quality, kind, slot, reforge: { slots, currentSubstats[], currentBonus: { atk, def, hpMax, mpMax, spirit }, nextCost: { linhThachCost, materialKey, materialQty } }, enchant: { currentElement, currentLevel, maxLevel, lockedElement: boolean, currentBonus: { atk, def, hpMax, mpMax, spirit }, nextCost: { linhThachCost, materialKey, materialQty } \| null, effects: { element, statKind, bonusPerLevel, labelVi, labelEn }[] } } } }`. `enchant.nextCost = null` khi `currentLevel >= MAX_ENCHANT_LEVEL`. Errors: 404 `EQUIPMENT_NOT_FOUND`, 400 `INVALID_EQUIPMENT`. |
| POST   | `/character/equipment/merge`           | Yes | **Phase 23.4** — ghép 3 món cùng `equipmentTier` / slot / quality / item family → 1 món quality cao hơn (PHAM→LINH→HUYEN→TIEN→THAN). Body `{ inventoryItemIds: [id1, id2, id3], idempotencyKey?: string }`. Server (atomic `prisma.$transaction`): (1) `validateEquipmentMergeRequest` enforce 3 input + same tier/slot/quality/family + non-equipped + non-locked + chưa vượt THAN; (2) `updateMany` 3 source rows guard `equippedSlot=null` + `characterId=current`; (3) `getEquipmentMergeCost(input)` → `CurrencyService.applyTx` linhThach reason `EQUIPMENT_MERGE` (`gte` guard) + material `updateMany` `gte` guard ItemLedger reason `EQUIPMENT_MERGE_COST`; (4) ghi `ItemLedger` reason `EQUIPMENT_MERGE_CONSUME` cho 3 source row; (5) delete 3 source row; (6) grant 1 output row qua `InventoryService.grantEquipment` + ItemLedger reason `EQUIPMENT_MERGE_GRANT`; (7) nếu `idempotencyKey` present → ghi vào `ItemLedger.meta.idempotencyKey` + `CurrencyLedger.meta.idempotencyKey` để retry không double-output. Outcome `{ ok: true, data: { merge: { outputInventoryItemId, outputItemKey, outputQuality, cost: { linhThachCost, materialKey, materialQty } } } }`. Errors: 400 `MERGE_INPUT_COUNT_INVALID`/`MERGE_INPUT_DUPLICATE`/`MERGE_MIXED_INPUT`, 404 `MERGE_ITEM_NOT_FOUND`, 403 `MERGE_ITEM_NOT_OWNED`/`MERGE_ITEM_EQUIPPED`, 409 `MERGE_CAP_REACHED`/`MERGE_OUTPUT_UNAVAILABLE`/`INSUFFICIENT_FUNDS`/`INSUFFICIENT_MATERIAL`. Feature flag `EQUIPMENT_MERGE_ENABLED` (default ON; ops disable nhanh nếu phát hiện exploit). |
| POST   | `/character/equipment/dismantle`       | Yes | **Phase 23.4** — phân giải 1 trang bị thành material + linh thạch + trả gem đang khảm về inventory. Body `{ inventoryItemId: string, idempotencyKey?: string }`. Server (atomic): (1) `validateDismantleRequest` (non-equipped, non-locked, owned); (2) `getEquipmentDismantleYield` deterministic theo `tier × quality × slot`; (3) detach gems (ItemLedger reason `EQUIPMENT_DISMANTLE_RETURN_GEM`); (4) delete InventoryItem row (ItemLedger reason `EQUIPMENT_DISMANTLE_CONSUME`); (5) grant material yield (ItemLedger reason `EQUIPMENT_DISMANTLE_YIELD`) + CurrencyService.applyTx linhThach delta > 0 reason `EQUIPMENT_DISMANTLE`; (6) idempotency: nếu `idempotencyKey` đã có row → trả về cached outcome thay vì mutate lần 2. Outcome `{ ok: true, data: { dismantle: { yield: { linhThach, materials: { itemKey, qty }[], returnedGems: { gemKey, qty }[] } } } }`. Errors: 404 `EQUIPMENT_NOT_FOUND`, 403 `EQUIPMENT_NOT_OWNED`/`EQUIPMENT_EQUIPPED`. Anti-infinite invariant test: `dismantleYield × 3 < mergeCost` cho mọi quality + tier. Feature flag `EQUIPMENT_DISMANTLE_ENABLED`. |
| POST   | `/character/equipment/merge-preview`   | Yes | **Phase 23.4** — read-only preview cho FE render. Body `{ inventoryItemIds: [id1, id2, id3] }`. Trả `{ ok: true, data: { preview: { canMerge: boolean, validationError?: string, outputItemKey?: string, outputQuality?: string, cost?: { linhThachCost, materialKey, materialQty }, currentLinhThach: bigint, currentMaterialQty: number } } }`. KHÔNG mutate state. |
| POST   | `/character/equipment/dismantle-preview` | Yes | **Phase 23.4** — read-only preview cho FE render. Body `{ inventoryItemId: string }`. Trả `{ ok: true, data: { preview: { canDismantle: boolean, validationError?: string, yield?: { linhThach, materials: { itemKey, qty }[], returnedGems: { gemKey, qty }[] } } } }`. KHÔNG mutate state. |

Tick EXP thực hiện bởi BullMQ processor `cultivation.processor.ts`. WS event `cultivate:tick` emit per-user khi tick xong. `CharacterStatePayload.title: string \| null` (Phase 11.9.C) push qua `state:update` event để FE hiển thị title đang trang bị trong topbar.

### Phase 15.0.A — Equipment Reforge / Enchant Foundation (chi tiết)

3 endpoint POST `/character/equipment/{reforge,enchant,upgrade-preview}` (xem bảng trên) là sink late-game tối ưu trang bị, song song refine (Phase 11.5) và gem (Phase 11.4). Cả 2 op (reforge + enchant) đều **server-authoritative**, **atomic** (consume currency + material → mutate equipment → ghi history trong cùng `prisma.$transaction`), và **concurrent-safe** (`updateMany` `gte` guard cho material; `CurrencyService.applyTx` `gte` guard cho linhThach). KHÔNG phá hủy trang bị (fail = rollback, success = overwrite stat). KHÔNG có gacha — input deterministic theo quality + element.

- **Schema** (migration `20260619000000_phase_15_0_a_equipment_reforge_enchant`): `InventoryItem` thêm 3 cột (`substatsJson` JSONB default `[]`, `enchantElement` TEXT NULL, `enchantLevel` INT default 0) + 2 audit table mới (`EquipmentReforgeHistory`, `EquipmentEnchantHistory`) FK `Character` cascade.
- **Ledger reason mới**: `CurrencyLedger.reason = 'EQUIPMENT_REFORGE' | 'EQUIPMENT_ENCHANT'`; `ItemLedger.reason = 'EQUIPMENT_REFORGE_COST' | 'EQUIPMENT_ENCHANT_COST'`. `refType=InventoryItem`, `refId=<inventoryItemId>` cho audit replay.
- **Combat integration**: `InventoryService.equipBonus` cộng substat (`composeSubstatBonus`) + enchant (`composeEnchantBonus(element, level)`) vào `InventoryView.equipBonus` → `CombatService.derivedStats` tự include qua pipeline cũ. Arena snapshot (Phase 14.1.B) capture `equipBonus` đã tính reforge + enchant tại thời điểm match.
- **Balance cap** (xem `docs/BALANCE_MODEL.md §15.0.A`): substat ranges + enchant bonusPerLevel cố ý giữ thấp hơn refine multiplier — tổng power foundation < +20% baseline → không lật meta Arena/PvE tier.
- **Foundation limitations**: chưa hỗ trợ chuyển hệ enchant (`ELEMENT_LOCKED` từ level 1); chưa có protection charm (reroll always overwrites — UI confirm modal); chưa hỗ trợ reforge main stat (chỉ substat phụ). Future PR sẽ mở rộng.

## Combat PvE — `CombatController`

| Method | Path              | Auth | Mô tả |
|--------|-------------------|------|-------|
| POST   | `/combat/engage`  | Yes  | `{ dungeonKey }`. Tạo encounter ACTIVE. |
| POST   | `/combat/turn`    | Yes  | Tấn công 1 lượt; kết thúc → loot + linhThach via ledger. **Phase 14.2.C** — body `{ skillKey? }` cast skill; nếu skill có tag `DOT` → set `EncounterState.monsterDot = { skillKey, element, perTurnDamage, turnsLeft: 3 }` (multi-turn persist, decrement mỗi lượt, clear khi monster chết / WON / LOST). Skill có tag `SHIELD` → áp same-turn `floor(playerHpMax × 0.10)` absorb monster reply (single-use, KHÔNG persist sang turn). Encounter `log[]` thêm system-side line: `"<monster> chịu N sát thương DOT (hệ <element>)."`, `"<monster> bị nhiễm <hệ> — DOT N sát thương / lượt × 3 lượt."`, `"Khiên <element> dựng — sẵn sàng hấp thu <hpAbsorb> sát thương phản kích."`, `"Khiên <element> hấp thu N sát thương phản kích."`. KHÔNG thay shape API response (`EncounterStateView` extend optional field, backward-compat). |
| GET    | `/combat/current` | Yes  | Encounter đang chạy (nếu có). **Phase 14.2.C** — response `state.monsterDot?: { skillKey, element, perTurnDamage, turnsLeft }` optional khi DOT đang active trên monster. |

## Inventory — `InventoryController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/inventory/me`       | Yes  | List item + equipped slot. Equipment `item` payload may include Phase 23.2 progression metadata: `equipmentTier`, `equipmentTierName`, `equipmentGradeWithinTier`, `requiredRealmOrder`, `requiredRealmKey`, `powerBudget`, `computedPowerScore`, `maxEnhanceLevel`, `maxSocketCount`, `equipmentElement?`. |
| POST   | `/inventory/equip`    | Yes  | `{ inventoryItemId }`. Server validates ownership, equippable slot, and Phase 23.2 realm gate. If `characterRealmOrder < item.requiredRealmOrder`, returns 409 `EQUIPMENT_REALM_LOCKED`. |
| POST   | `/inventory/unequip`  | Yes  | `{ slot }`. Unequip is not blocked by realm gate. |
| POST   | `/inventory/use-pill` | Yes  | Tiêu đan. Ghi `ItemLedger` qtyDelta âm. |

## Market — `MarketController`

| Method | Path                          | Auth | Mô tả |
|--------|-------------------------------|------|-------|
| GET    | `/market/listings`            | Yes  | Browse listings. |
| POST   | `/market/listings`            | Yes  | Đăng bán. |
| POST   | `/market/listings/:id/buy`    | Yes  | Mua — bilateral lock via ledger. Phí `MARKET_FEE_PCT` (env). |
| POST   | `/market/listings/:id/cancel` | Yes  | Huỷ (chỉ chủ listing). |

## Sect & Chat — `SectController`, `ChatController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| POST   | `/sect/create`        | Yes  | Tạo tông môn. |
| POST   | `/sect/join`          | Yes  | Gia nhập. |
| POST   | `/sect/leave`         | Yes  | Rời. |
| POST   | `/sect/contribute`    | Yes  | Đóng linh thạch → treasury + cống hiến. |
| GET    | `/chat/world?limit=N` | Yes  | Lịch sử world chat. |
| POST   | `/chat/send`          | Yes  | Gửi. Rate limit 8 msg / 30s / player (Redis). |

## Social — `SocialController` (Phase 19.1 + Phase 19.1.B + Phase 19.1.C)

> Friend / block lifecycle + public profile inspect. Server-authoritative invariants: cấm self-friend / self-block, block 2 chiều cancel mọi pending request + xoá Friendship. Detection-first: reject ở send time. Error code (Envelope): `SELF_NOT_ALLOWED`, `ALREADY_PENDING`, `ALREADY_FRIENDS`, `BLOCKED`, `NOT_FOUND`, `NOT_AUTHORIZED`, `INVALID_TRANSITION`, `INVALID_INPUT`. Khi rate-limit hit, `RateLimitGuard` (Phase 18.1) thêm 429 với `RATE_LIMITED` / `ABUSE_BLOCKED`. Cột **Rate** = `@RateLimitPolicy()` key gắn ở controller.

| Method | Path                                   | Auth | Rate                | Mô tả |
|--------|----------------------------------------|------|---------------------|-------|
| GET    | `/social/friends`                       | Yes  | —                   | Danh sách bạn bè kèm flag `online` (RealtimeService.isOnline). |
| GET    | `/social/friend-requests/incoming`      | Yes  | —                   | Lời mời đến PENDING. |
| GET    | `/social/friend-requests/outgoing`      | Yes  | —                   | Lời mời đi PENDING. |
| POST   | `/social/friend-requests`               | Yes  | `SOCIAL_FRIEND_REQUEST` (10/60s user) | Body `{ receiverUserId, message? }`. Message ≤140ch. |
| POST   | `/social/friend-requests/:id/accept`    | Yes  | —                   | Receiver only. Tạo Friendship cặp low<high. |
| POST   | `/social/friend-requests/:id/decline`   | Yes  | —                   | Receiver only. |
| DELETE | `/social/friend-requests/:id`           | Yes  | —                   | Sender only (cancel PENDING). |
| DELETE | `/social/friends/:friendUserId`         | Yes  | —                   | Xoá Friendship 2 chiều (caller xoá quan hệ với target). |
| GET    | `/social/blocks`                        | Yes  | —                   | Danh sách player đã chặn. |
| POST   | `/social/block`                         | Yes  | `SOCIAL_BLOCK_TOGGLE` (30/10p user) | Body `{ userId }`. Cancel pending FriendRequest 2 chiều + xoá Friendship. |
| DELETE | `/social/block/:userId`                 | Yes  | `SOCIAL_BLOCK_TOGGLE` (30/10p user) | Bỏ chặn. KHÔNG tự khôi phục FriendRequest cũ. |
| GET    | `/social/profile/:userId`               | Yes  | `SOCIAL_PROFILE_VIEW` (60/60s user, block 5m) | **Phase 19.1.C** — Public player profile / inspect. Trả `PublicPlayerProfileDto` `{userId, displayName, character?, relationshipStatus (SELF/FRIEND/PENDING_INCOMING/PENDING_OUTGOING/BLOCKED_BY_ME/STRANGER), actions, online, joinedYearMonth, mutualFriendCount, sameSect}`. **Privacy mask**: target đã block viewer → 404 (KHÔNG leak existence). User/character không tồn tại → 404. **Whitelisted fields only** — KHÔNG bao giờ trả email/role/banned/currency (linhThach/tienNgoc)/inventory/payment/ipHash/sessionId. `character` snapshot = `{characterName, level, powerScore, realmKey, realmStage, realmFullName, title?, sectId?, sectName?}` (KHÔNG raw stats power/spirit/speed/hp/mp/settings). `mutualFriendCount` chỉ trả khi `STRANGER` (FRIEND → `null` privacy social-graph). `BLOCKED_BY_ME` trả minimal profile `character=null`. |
| GET    | `/social/presence?userIds=csv`          | Yes  | —                   | **Phase 19.3** — Batch presence query. Query param `userIds` CSV (cap 50, dedupe). Trả `PresenceQueryResponse` `{presences: PresenceRow[]}` với `{userId, status (ONLINE/OFFLINE), lastSeenAt?}`. **Privacy mask**: target đã block viewer → `OFFLINE + lastSeenAt=null` (KHÔNG leak online time). |

## Notification — `NotificationController` (Phase 19.3)

> Bell + dropdown notification inbox. Server-authoritative own-user-only — mọi REST filter `WHERE userId === requesterUserId`. **i18n-key only** `titleKey`/`bodyKey` — KHÔNG nhận free-text (chống XSS / injection). Sender/group name nhúng vào `dataJson` đã sanitize qua `sanitizeNotificationData` (cap depth=3 + length=500). Trigger nguồn: friend request (received/accepted), private message received, group message received, group invite/member added, chat report resolved, security alert. Error code (Envelope): `NOTIFICATION_NOT_FOUND`, `FORBIDDEN`. Realtime mirror: server emit `notification:new` + `notification:unread-count` WS event (emit-to-user-only) khi user online.

| Method | Path                              | Auth | Rate | Mô tả |
|--------|-----------------------------------|------|------|-------|
| GET    | `/notifications`                  | Yes  | —    | Query `?cursor=&limit=&types=CSV&unread=true|false`. Cursor by `createdAt` (ISO). Trả `NotificationListResponse{notifications,total,unreadCount}`. Cap `limit≤50`. |
| GET    | `/notifications/unread-count`     | Yes  | —    | Trả `{unreadCount}`. |
| POST   | `/notifications/:id/read`         | Yes  | —    | Mark 1 notification đã đọc. Idempotent (đã read → no-op). Cross-user → `FORBIDDEN`. |
| POST   | `/notifications/read-all`         | Yes  | —    | Mark all unread của caller. Trả `{markedCount, unreadCount:0}`. |

## Party — `PartyController` (Phase 19.4)

> Cooperative tổ đội gameplay-ready cho dungeon/boss co-op (Phase 20+). Mỗi user 1 active party tại một thời điểm; leader có thể invite/kick/transfer/disband. Soft-ref (không FK đến User) — service-layer consistency. Invite expire sau `PARTY_LIMITS.inviteExpireMinutes=10`. Block 2-chiều giữa inviter–invitee reject `BLOCKED`. Race accept invite idempotent qua unique `(partyId,userId,leftAt=NULL)`. Cột **Rate** = `@RateLimitPolicy()` key gắn ở controller.

| Method | Path                                | Auth | Rate                  | Mô tả |
|--------|-------------------------------------|------|-----------------------|-------|
| GET    | `/party/me`                         | Yes  | —                     | Trả `MyPartyResponse{party,members}`. Không thuộc party → `party=null, members=[]`. |
| GET    | `/party/members`                    | Yes  | —                     | Trả `PartyMemberListResponse{members}` của party hiện tại. Không thuộc party → `members=[]`. |
| GET    | `/party/invites/incoming`           | Yes  | —                     | Trả `PartyInviteListResponse{invites}` (PENDING tới caller; lazy transition `EXPIRED`). |
| GET    | `/party/invites/outgoing`           | Yes  | —                     | Trả `PartyInviteListResponse{invites}` (PENDING do caller gửi). |
| POST   | `/party`                            | Yes  | `PARTY_CREATE`        | Body `{name?}` (3..40ch trimmed hoặc null). Tạo party + caller làm LEADER. Reject `ALREADY_IN_PARTY`/`INVALID_INPUT`. |
| POST   | `/party/invites`                    | Yes  | `PARTY_INVITE_SEND`   | Body `{inviteeUserId}`. Leader-only. Reject `NOT_AUTHORIZED`/`SELF_NOT_ALLOWED`/`BLOCKED`/`DUPLICATE_INVITE`/`INVITEE_IN_OTHER_PARTY`/`PARTY_FULL`/`TOO_MANY_PENDING_INVITES`. |
| POST   | `/party/invites/:id/accept`         | Yes  | `PARTY_MUTATION`      | Caller phải là invitee. Reject `INVITE_NOT_PENDING`/`INVITE_EXPIRED`/`ALREADY_IN_PARTY`/`PARTY_FULL`/`PARTY_DISBANDED`. Idempotent qua unique constraint. |
| POST   | `/party/invites/:id/decline`        | Yes  | `PARTY_MUTATION`      | Caller phải là invitee. Reject `INVITE_NOT_PENDING`. |
| DELETE | `/party/invites/:id`                | Yes  | `PARTY_MUTATION`      | Cancel invite. Caller = inviter hoặc leader của party. |
| POST   | `/party/leave`                      | Yes  | `PARTY_MUTATION`      | Rời party. Leader rời → auto-transfer cho longest-tenured member (joinedAt asc); chỉ còn 1 → auto-disband. |
| POST   | `/party/members/:userId/kick`       | Yes  | `PARTY_MUTATION`      | Leader-only. Reject `NOT_AUTHORIZED`/`SELF_NOT_ALLOWED`/`TARGET_NOT_MEMBER`. |
| POST   | `/party/leader/transfer`            | Yes  | `PARTY_MUTATION`      | Body `{targetUserId}`. Leader-only. Target phải là member. |
| POST   | `/party/disband`                    | Yes  | `PARTY_MUTATION`      | Leader-only. Mark all `leftAt=NOW`, status=DISBANDED, cancel pending invites. |

WS events (best-effort fanout — không có recipient online thì im lặng drop):

| Event                    | Recipients                          | Payload                                                                       |
|--------------------------|-------------------------------------|-------------------------------------------------------------------------------|
| `party:updated`          | All current members                 | `PartyUpdatedBroadcastPayload{party,members}`                                 |
| `party:invite`           | Invitee only                        | `PartyInviteBroadcastPayload{invite}`                                         |
| `party:member-joined`    | All members (sau khi join)          | `PartyMemberJoinedBroadcastPayload{partyId,userId,role,displayName}`          |
| `party:member-left`      | Members + caller; `reason` enum     | `PartyMemberLeftBroadcastPayload{partyId,userId,reason}` (`LEFT|KICKED|DISBANDED`) |
| `party:leader-changed`   | All members                         | `PartyLeaderChangedBroadcastPayload{partyId,previousLeaderUserId,newLeaderUserId}` |

## Co-op Boss — `CoopBossController` (Phase 20.2)

> Foundation cho tổ đội (Phase 19.4) tham gia boss event co-op với contribution tracking. Mỗi party tại 1 thời điểm có tối đa **1 active run** (`maxActiveRunPerParty=1`). Leader tạo `CoopBossRun` với `bossKey` từ catalog `BOSSES` (shared) → member của cùng party join → mỗi member self-report `damageDone`/`supportScore`/`survivalSeconds` qua `recordContribution` (server clamp + anomaly log theo `COOP_BOSS_LIMITS`, không cho client tự khai damage không bound) → leader `finishRun` → server snapshot tier `NONE/LOW/NORMAL/HIGH/MVP` → reward claim PENDING cho member `eligibleForReward=true` + tier ≠ `NONE`. Member claim qua endpoint riêng (atomic CAS `PENDING→CLAIMED` + ledger). KHÔNG realtime combat, KHÔNG matchmaking public, KHÔNG loot bidding / share-pool. `maxMembers=8`, `minSurvivalSeconds=30`, `contributionWindowSeconds=1800` (xem `COOP_BOSS_LIMITS`).

| Method | Path                                                | Auth | Rate                       | Mô tả |
|--------|-----------------------------------------------------|------|----------------------------|-------|
| GET    | `/coop/boss/runs/current`                           | Yes  | —                          | Trả `MyCoopBossRunResponse{run,participants,myContribution,myReward,myRewardPreview}`. Không thuộc party hoặc chưa có run → `run=null, participants=[]`. |
| GET    | `/coop/boss/runs/mine?limit=`                       | Yes  | —                          | Trả `CoopBossRunListResponse{runs}` lịch sử run caller tham gia. `limit` cap theo `COOP_BOSS_LIMITS.listPageMax`. |
| GET    | `/coop/boss/runs/:id`                               | Yes  | —                          | Trả `CoopBossRunDetailResponse{run,participants,myReward,...}`. Caller phải là participant của run; ngoài run → `RUN_NOT_FOUND` (mask). |
| GET    | `/coop/boss/runs/:id/reward-preview`                | Yes  | —                          | Trả `{preview: CoopBossRewardPreview|null}` — tier dự kiến live cho caller. Run chưa CLEARED → preview tính từ snapshot live. |
| POST   | `/coop/boss/runs`                                   | Yes  | —                          | Body `{bossKey, worldBossEventId?}`. Leader-only. Reject `NOT_IN_PARTY`/`NOT_PARTY_LEADER`/`INVALID_BOSS_KEY`/`RUN_ALREADY_EXISTS`. Auto-join caller làm participant đầu tiên. |
| POST   | `/coop/boss/runs/:id/join`                          | Yes  | `COOP_BOSS_JOIN`           | Body `{}`. Member cùng party join. Reject `NOT_PARTY_MEMBER`/`RUN_NOT_FOUND`/`RUN_NOT_LOBBY`/`NO_CHARACTER`. Idempotent — re-join chỉ refresh `leftAt=null`. |
| POST   | `/coop/boss/runs/:id/leave`                         | Yes  | —                          | Body `{}`. Participant rời run. Nếu run đã `IN_PROGRESS` và `survivalSeconds < minSurvivalSeconds` → finish sau đó `eligibleForReward=false`. |
| POST   | `/coop/boss/runs/:id/contribution`                  | Yes  | `COOP_BOSS_CONTRIBUTION`   | Body `{damageDone, supportScore, survivalSeconds}`. Participant-only. Server clamp tất cả input theo `COOP_BOSS_LIMITS.maxDamagePerContribution`/`maxSupportPerContribution`/`maxSurvivalSecondsPerContribution` + warning log anomaly. Auto-promote LOBBY → IN_PROGRESS. Cộng dồn UNIQUE `(runId,participantId)`. Reject `PARTICIPANT_NOT_FOUND`/`PARTICIPANT_LEFT`/`CONTRIBUTION_WINDOW_CLOSED`/`RUN_NOT_ACTIVE`. |
| POST   | `/coop/boss/runs/:id/finish`                        | Yes  | —                          | Body `{result: 'CLEARED'\|'FAILED'}`. Leader-only. Snapshot eligibility + MVP (tier-based). CLEARED → reward claim PENDING cho mỗi participant eligible + tier ≠ NONE. FAILED → không tạo claim. Reject `NOT_PARTY_LEADER`/`RUN_NOT_ACTIVE`/`RUN_ALREADY_FINISHED`/`NOT_ENOUGH_MEMBERS`. |
| POST   | `/coop/boss/runs/:id/cancel`                        | Yes  | —                          | Body `{}`. Leader-only, run phải LOBBY. Reject `NOT_PARTY_LEADER`/`RUN_NOT_LOBBY`. |
| POST   | `/coop/boss/runs/:id/claim-reward`                  | Yes  | `COOP_BOSS_CLAIM`          | Atomic CAS `PENDING→CLAIMED`. Grant reward qua `CurrencyService.applyTx` (`reason='COOP_BOSS_REWARD'`, refType `'CoopBossRewardClaim'`) + `InventoryService.grantTx` + `tx.character.update{exp:{increment}}`. Reject `RUN_NOT_FOUND`/`RUN_NOT_FINISHED`/`REWARD_NOT_FOUND` (non-participant fall vào đây — mask)/`REWARD_NOT_ELIGIBLE`/`REWARD_ALREADY_CLAIMED`. |

WS events (best-effort fanout chỉ tới participant của run — KHÔNG broadcast party / public):

| Event                                | Recipients                          | Payload                                                                       |
|--------------------------------------|-------------------------------------|-------------------------------------------------------------------------------|
| `coop-boss:run-updated`              | Run participants (active)           | `CoopBossRunUpdatedBroadcastPayload{runId,partyId,bossKey,status,participantsCount}` |
| `coop-boss:contribution-updated`     | Run participants                    | `CoopBossContributionUpdatedBroadcastPayload{runId,participantId,userId,contributionScore}` |
| `coop-boss:finished`                 | Run participants                    | `CoopBossFinishedBroadcastPayload{runId,partyId,status,mvpUserId?}`           |
| `coop-boss:reward-available`         | Reward owner only (per-user)        | `CoopBossRewardAvailableBroadcastPayload{runId,userId,rewardClaimId,tier}`    |

## Party Dungeon — `PartyDungeonController` (Phase 20.1)

> Co-op PvE foundation gắn party (Phase 19.4). Mỗi party tại 1 thời điểm có tối đa **1 active room** (`maxActiveRoomPerParty=1`). Leader tạo room với `dungeonKey` từ catalog `DUNGEONS` (shared) → member của cùng party `joinFromParty` → set ready → leader `startRun`. Foundation phase: server auto-resolve inline khi `startRun` → `PartyDungeonRun.result=CLEAR` + tạo `PartyDungeonRewardClaim` PENDING cho mỗi participant. Member claim qua endpoint riêng (atomic CAS `PENDING→CLAIMED` + ledger). KHÔNG matchmaking public, KHÔNG loot bidding, KHÔNG share-pool. `minMembers=2`, `maxMembers=5` (xem `COOP_DUNGEON_LIMITS`).

| Method | Path                                              | Auth | Rate                       | Mô tả |
|--------|---------------------------------------------------|------|----------------------------|-------|
| GET    | `/party/dungeon/room`                             | Yes  | —                          | Trả `MyPartyDungeonRoomResponse{room,participants,currentRun,myReward}`. Không thuộc party hoặc chưa có room → `room=null, participants=[]`. |
| GET    | `/party/dungeon/runs/:id`                         | Yes  | —                          | Trả `PartyDungeonRunDetailResponse{run,rewards}`. Caller phải là participant của run (lookup qua `roomId`); ngoài party → `NOT_PARTY_MEMBER`. |
| POST   | `/party/dungeon/rooms`                            | Yes  | `PARTY_DUNGEON_CREATE`     | Body `{dungeonKey}`. Leader-only. Reject `NOT_IN_PARTY`/`NOT_PARTY_LEADER`/`INVALID_DUNGEON`/`ROOM_ALREADY_EXISTS`. Auto-join caller làm participant đầu tiên. |
| POST   | `/party/dungeon/join`                             | Yes  | `PARTY_DUNGEON_READY`      | Body `{roomId}`. Member của party có room join. Reject `NOT_PARTY_MEMBER`/`ROOM_NOT_FOUND`/`ROOM_NOT_LOBBY`/`NO_CHARACTER`. Idempotent — re-join chỉ re-activate row hiện hữu. |
| POST   | `/party/dungeon/ready`                            | Yes  | `PARTY_DUNGEON_READY`      | Body `{roomId}`. Participant set `readyAt`. Reject `PARTICIPANT_NOT_FOUND`/`ROOM_NOT_LOBBY`. |
| POST   | `/party/dungeon/unready`                          | Yes  | `PARTY_DUNGEON_READY`      | Body `{roomId}`. Participant clear `readyAt`. |
| POST   | `/party/dungeon/start`                            | Yes  | `PARTY_DUNGEON_START`      | Body `{roomId}`. Leader-only. Gate qua `canStartPartyDungeon` (shared helper): đủ `minMembers` + tất cả ready + room LOBBY/READY_CHECK + dungeonKey hợp lệ. Reject `NOT_PARTY_LEADER`/`NOT_ENOUGH_MEMBERS`/`NOT_ALL_READY`/`INVALID_DUNGEON`/`ROOM_NOT_LOBBY`. Server tạo `PartyDungeonRun.result=CLEAR` + reward claim PENDING. |
| POST   | `/party/dungeon/cancel`                           | Yes  | `PARTY_DUNGEON_START`      | Body `{roomId}`. Leader-only, room phải LOBBY/READY_CHECK. Reject `ROOM_NOT_LOBBY` (đã COMPLETED). |
| POST   | `/party/dungeon/runs/:id/claim-reward`            | Yes  | `PARTY_DUNGEON_CLAIM`      | Atomic CAS `PENDING→CLAIMED`. Grant reward qua `CurrencyService.applyTx` (`reason='PARTY_DUNGEON_REWARD'`) + `InventoryService.grantTx` + `tx.character.update{exp:{increment}}`. Reject `RUN_NOT_FOUND`/`RUN_NOT_COMPLETED`/`REWARD_NOT_FOUND` (non-participant fall vào đây — mask)/`REWARD_ALREADY_CLAIMED`. |

WS events (best-effort fanout chỉ tới participant của room — KHÔNG broadcast party / public):

| Event                              | Recipients                          | Payload                                                                       |
|------------------------------------|-------------------------------------|-------------------------------------------------------------------------------|
| `party-dungeon:room-updated`       | Room participants (active)          | `PartyDungeonRoomUpdatedBroadcastPayload{roomId,partyId,status,participantsCount,readyCount}` |
| `party-dungeon:ready-updated`      | Room participants                   | `PartyDungeonReadyUpdatedBroadcastPayload{roomId,partyId,userId,ready}`       |
| `party-dungeon:started`            | Room participants                   | `PartyDungeonStartedBroadcastPayload{roomId,partyId,runId,dungeonKey}`        |
| `party-dungeon:completed`          | Room participants                   | `PartyDungeonCompletedBroadcastPayload{roomId,partyId,runId,result}`          |
| `party-dungeon:reward-available`   | Reward owner only (per-user)        | `PartyDungeonRewardAvailableBroadcastPayload{roomId,partyId,runId,userId,rewardClaimId}` |

## Chat Private — `ChatPrivateController` (Phase 19.1 + Phase 19.1.B)

> Chat riêng 1-1. Thread invariant: `userAId < userBId` (lexicographic). Server-side: non-member → 404 mask (KHÔNG 403 leak existence). Block 2 chiều reject `sendPrivateMessage` với `BLOCKED`. Message body 1..500ch trimmed. Cột **Rate** = `@RateLimitPolicy()` key gắn ở controller (Phase 19.1.B).

| Method | Path                                                  | Auth | Rate (Phase 19.1.B) | Mô tả |
|--------|-------------------------------------------------------|------|---------------------|-------|
| GET    | `/chat/private/threads`                                | Yes  | —                   | Danh sách thread caller, kèm last message snapshot. |
| POST   | `/chat/private/threads`                                | Yes  | —                   | Body `{ peerUserId }`. Find-or-create. Cấm self / block. |
| GET    | `/chat/private/threads/:threadId/messages?limit=`      | Yes  | —                   | DESC. Default 50, max 200. Non-member → 404. |
| POST   | `/chat/private/threads/:threadId/messages`             | Yes  | `CHAT_PRIVATE_SEND` (30/60s user) | Body `{ body }`. Emit WS `private-chat:msg`. |

## Chat Group — `ChatGroupController` (Phase 19.1 + Phase 19.1.B)

> Group chat cơ bản. Member cap 30. Owner-only ops cho add/remove member. Non-member → 404 mask cho GET/POST messages. Owner KHÔNG self-remove (cần `deleteGroup` follow-up). Group name 3..60ch trimmed. Cột **Rate** = `@RateLimitPolicy()` key gắn ở controller (Phase 19.1.B).

| Method | Path                                                            | Auth | Rate (Phase 19.1.B) | Mô tả |
|--------|-----------------------------------------------------------------|------|---------------------|-------|
| GET    | `/chat/groups`                                                   | Yes  | —                   | Danh sách group caller là member. |
| POST   | `/chat/groups`                                                   | Yes  | `CHAT_GROUP_CREATE` (10/60min user) | Body `{ name }`. Caller = owner, auto-add. |
| POST   | `/chat/groups/:groupId/members`                                  | Yes  | `CHAT_GROUP_MEMBER_ADD` (30/10p user) | Owner only. Body `{ userId }`. Cấm block 2 chiều, cap 30. |
| DELETE | `/chat/groups/:groupId/members/:targetUserId`                    | Yes  | —                   | Owner only. Cấm self-remove. |
| GET    | `/chat/groups/:groupId/messages?limit=`                          | Yes  | —                   | Member only. Non-member → 404. DESC. Default 50, max 200. |
| POST   | `/chat/groups/:groupId/messages`                                 | Yes  | `CHAT_GROUP_SEND` (30/60s user) | Member only. Body `{ body }`. Emit WS `group-chat:msg` loop member. |

## Chat Moderation — `ChatModerationController` (Phase 19.2)

> User-facing endpoint cho player report tin nhắn vi phạm. Error code (Envelope): `INVALID_INPUT`, `NOT_FOUND`, `NOT_AUTHORIZED`, `DUPLICATE_REPORT`, `RATE_LIMITED`, `ABUSE_BLOCKED`. Duplicate report cùng `(reporterUserId, messageType, privateMessageId|groupMessageId)` → `DUPLICATE_REPORT`. `messageType=PRIVATE` thì `privateMessageId` bắt buộc & `groupMessageId` phải null (và ngược lại).

| Method | Path                       | Auth | Rate              | Mô tả |
|--------|----------------------------|------|-------------------|-------|
| POST   | `/chat/reports`            | Yes  | `CHAT_REPORT_SUBMIT` (10/60min user, block 10p) | Body `{ messageType, privateMessageId?, groupMessageId?, reason, detailsText? ≤500ch }`. Tạo `ChatMessageReport` status `OPEN`. |
| GET    | `/chat/reports/mine`       | Yes  | —                 | List report của caller. Query `page`, `pageSize`. |
| GET    | `/chat/reports/catalog`    | Yes  | —                 | Trả enum (reason / type / status / muteScope) cho FE i18n dropdown. |

## Admin Chat Moderation — `AdminChatModerationController` (Phase 19.2, role `ADMIN`)

> Admin moderation dashboard: list/ack/resolve report, mute user theo scope, soft-hide message, lock/dissolve group. **Tất cả mutation ghi `AdminAuditLog`** với target = report/mute/message/group id. Soft-hide KHÔNG xoá body (audit/appeal). Lock/dissolve cập nhật cột trên `GroupChat`, KHÔNG xoá member/message.

Mọi mutation đều rate-limit policy `ADMIN_MUTATION` + ghi `AdminAuditLog` action `ADMIN_CHAT_MODERATION_*`.

| Method | Path                                              | Auth   | Mô tả |
|--------|---------------------------------------------------|--------|-------|
| GET    | `/admin/chat/reports`                             | Admin  | Filter `status` / `reason` / `messageType` / `reporterUserId` / `targetUserId` + pagination. Trả `AdminChatReportListItem[]` kèm `messagePreview`, `messageHiddenAt`, `reporterDisplayName`, `targetDisplayName`. |
| GET    | `/admin/chat/reports/summary`                     | Admin  | 6 counter: `openReports`, `acknowledgedReports`, `resolvedToday`, `mutedUsers`, `hiddenMessages`, `lockedGroups`. |
| POST   | `/admin/chat/reports/:id/ack`                     | Admin  | State `OPEN → ACKNOWLEDGED`. Idempotent. Audit `ADMIN_CHAT_MODERATION_REPORT_ACK`. |
| POST   | `/admin/chat/reports/:id/resolve`                 | Admin  | Body `{ status: 'RESOLVED' \| 'REJECTED', note? }`. State `OPEN \| ACKNOWLEDGED → RESOLVED \| REJECTED`. Audit `ADMIN_CHAT_MODERATION_REPORT_RESOLVE` / `_REPORT_REJECT`. |
| GET    | `/admin/chat/mutes`                               | Admin  | Filter `userId` / `scope` / `activeOnly` + pagination. Server trả field `isActive` derived (revokedAt null + (expiresAt null hoặc > now)). |
| POST   | `/admin/chat/mutes`                               | Admin  | Body `{ userId, scope, reason, expiresAt? }`. Tạo `ChatMute`. Audit `ADMIN_CHAT_MODERATION_MUTE_CREATE`. |
| DELETE | `/admin/chat/mutes/:id`                           | Admin  | Set `revokedAt` + `revokedByAdminId`. Audit `ADMIN_CHAT_MODERATION_MUTE_REVOKE`. |
| POST   | `/admin/chat/messages/:id/hide`                   | Admin  | Body `{ messageType, reason? }`. Soft-hide (set `hiddenAt` / `hiddenByAdminId` / `hideReason`). Body giữ nguyên. Audit `ADMIN_CHAT_MODERATION_MESSAGE_HIDE`. |
| POST   | `/admin/chat/messages/:id/unhide`                 | Admin  | Body `{ messageType }`. Clear soft-hide cols. Audit `ADMIN_CHAT_MODERATION_MESSAGE_UNHIDE`. |
| POST   | `/admin/chat/groups/:id/lock`                     | Admin  | Body `{ reason? }`. Set `lockedAt`. Member KHÔNG gửi message được. Audit `ADMIN_CHAT_MODERATION_GROUP_LOCK`. |
| POST   | `/admin/chat/groups/:id/unlock`                   | Admin  | Clear `lockedAt`. Audit `ADMIN_CHAT_MODERATION_GROUP_UNLOCK`. |
| POST   | `/admin/chat/groups/:id/dissolve`                 | Admin  | Body `{ reason? }`. Set `dissolvedAt`. Group bị đánh dấu giải tán; member/message giữ nguyên. Audit `ADMIN_CHAT_MODERATION_GROUP_DISSOLVE`. |

### Mute enforcement wiring (Phase 19.2)

`ChatModerationService.findActiveMuteForSend(userId, channelScope)` được gọi trước business logic trong:

- `ChatPrivateService.sendPrivateMessage` → check scope `PRIVATE_CHAT`.
- `ChatGroupService.sendGroupMessage` → check scope `GROUP_CHAT`.
- `ChatService.sendWorldChat` / `sendSectChat` → check scope `WORLD_SECT_CHAT`.

Server enforce ma trận `muteScopeCoversChannel`: scope `ALL_CHAT` cover mọi channel; scope cụ thể chỉ cover channel target. Nếu tìm thấy mute active → throw `MUTED`. Mute revoked hoặc expired KHÔNG enforce. Lookup query indexed `(userId, revokedAt, expiresAt)`.

## Territory — `TerritoryController` (Phase 14.0.A + 14.0.B + 14.0.C)

Lớp **Sect Territory Influence + Settlement + Region Buff + Decay** — read views cho Influence Leaderboard theo region + Settlement (chiếm vùng) thật + Region buff khi sở hữu vùng + Influence decay per period.
Server-authoritative; FE KHÔNG mutate. Mọi điểm influence chỉ được cộng qua **gameplay hook** (dungeon clear / boss participation / boss top damage) — KHÔNG có endpoint mutate trực tiếp.
Settlement (Phase 14.0.B) + Decay (Phase 14.0.C) chỉ trigger qua admin endpoint hoặc cron weekly job (chưa wire cron trong PR này).

| Method | Path                                          | Auth   | Mô tả |
|--------|-----------------------------------------------|--------|-------|
| GET    | `/territory/regions`                          | Yes    | List 9 region (`MAP_REGIONS` parity) + `totalPoints` + `contributors` + `topSect` snapshot **+ owner** `ownerSectId? / ownerSectName? / ownerPeriodKey? / ownerSettledAt?` (Phase 14.0.B) **+ buff preview** `buffs: TerritoryRegionBuffPreviewLite[]` (Phase 14.0.C — luôn render catalog, FE phân biệt active qua `ownerBuffActive`) + `ownerBuffActive: boolean` (true khi region có owner). Response top-level cũng có `currentPeriodKey` + `previousPeriodKey` (Phase 14.0.C, ISO 8601 week). Region không có influence vẫn xuất hiện với `totalPoints=0`, `topSect=null`. Sort theo `MapRegionDef.sortOrder`. |
| GET    | `/territory/regions/:regionKey/leaderboard`   | Yes    | Top 10 sect trong region, `points` desc, tie-break `sectId` asc. Throw 404 `REGION_INVALID` nếu key không hợp lệ. |
| GET    | `/territory/regions/:regionKey/history`       | Yes    | (Phase 14.0.B) Settlement history per region — DESC theo `settledAt`, default limit 20 (clamp 1..100 qua `?limit=`). Response `{ regionKey, current: TerritoryRegionOwnerLite \| null, snapshots: TerritorySettlementSnapshotView[] }`. Throw 404 `REGION_INVALID`. |
| GET    | `/territory/me`                               | Yes    | Personal view: per-region rank/points của sect user + `personalPoints` cá nhân **+ active buffs** `activeBuffs: TerritoryRegionBuffPreviewLite[]` (Phase 14.0.C — buff đang được áp dụng vì sect của user đang sở hữu region tương ứng). Character không có sect → `hasSect=false`, `activeBuffs=[]`, `regions[]` đầy đủ với `sectPoints=0`/`sectRank=null`. Throw 404 `NO_CHARACTER` nếu user chưa onboard. |
| POST   | `/admin/territory/settle`                     | ADMIN  | (Phase 14.0.B) Settle **all 9 regions** cho `?periodKey=…`. `periodKey` validate qua `isTerritoryPeriodKey` (ISO week `YYYY-Www` hoặc `manual_*`). Nếu không truyền → fallback `previousTerritoryPeriodKey()` (tuần trước). Response `TerritorySettlementRunResult { periodKey, settledAt, snapshots[], skippedRegions[] }`. Idempotent qua UNIQUE `(regionKey, periodKey)` — gọi lại cùng `periodKey` trả cùng snapshot id. Non-admin → 403 `ADMIN_ONLY`. Invalid `periodKey` → 400 `PERIOD_INVALID`. |
| POST   | `/admin/territory/regions/:regionKey/settle`  | ADMIN  | (Phase 14.0.B) Manual settle 1 region (debug/override). Body/query `periodKey` cùng convention như endpoint trên. Response `{ snapshot: TerritorySettlementSnapshotView \| null, skipped: boolean, regionKey, periodKey }`. 404 `REGION_INVALID`, 400 `PERIOD_INVALID`, 403 `ADMIN_ONLY`. |
| POST   | `/admin/territory/decay`                      | ADMIN  | (Phase 14.0.C) Trigger influence decay cho `periodKey` (default `previousTerritoryPeriodKey()` nếu không truyền). Body `{ periodKey?: string, decayBps?: number }`. `decayBps` mặc định `TERRITORY_DECAY_DEFAULT_BPS=2500` (25%), cap `TERRITORY_DECAY_MAX_BPS=5000` (50%), range `1..5000`. Idempotent qua `SectTerritoryDecayLog` UNIQUE `(periodKey)` — gọi cùng `periodKey` 2 lần → lần 2 trả `{ skipped: true }`. Race-safe (P2002 retry). Response `TerritoryDecayResult { periodKey, decayBps, skipped, rowsAffected, pointsBefore, pointsAfter, delta, triggeredAt }`. Errors: 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID`, 400 `DECAY_BPS_INVALID`. |
| GET    | `/admin/territory/decay/history?limit=`       | ADMIN  | (Phase 14.0.C) Read recent `SectTerritoryDecayLog` rows DESC theo `triggeredAt`. `?limit=` clamp 1..100, default 20 (invalid → fallback 20). Response `{ ok: true, data: TerritoryDecayLogRow[] }` — `TerritoryDecayLogRow { periodKey, decayBps, rowsAffected, pointsBefore, pointsAfter, triggeredBy (userId \| null), triggeredAt (ISO string) }`. Read-only — KHÔNG mutate state. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`. |
| GET    | `/territory/war/current`                      | No     | (Phase 14.0.D) War state cho period **hiện tại**. Response `TerritoryWarStateView { periodKey, previousPeriodKey, startsAt, endsAt, nextResetAt, serverNow, timeRemainingMs, regions: TerritoryRegionWarSummaryView[] }`. `regions[]` luôn 9 phần tử (sort theo `sortOrder`), mỗi entry có `topStandings` top 3 sect (sort `points` DESC, tie-break `sectId.localeCompare()` ASC), `contested` (≥ 2 sect tranh), `currentOwnerSectId/Name/PeriodKey` (kỳ trước). `timeRemainingMs` server-authoritative (FE countdown source of truth). Public — không cần auth. |
| GET    | `/territory/war/regions/:regionKey`           | No     | (Phase 14.0.D) Region detail cho war panel. Response `TerritoryRegionWarStatusView` mở rộng `Summary` với `standings` top 10 (thay vì top 3) + `recentSettlements: TerritorySettlementSnapshotView[]` 5 settlement gần nhất + owner snapshot. Throw 404 `REGION_INVALID` nếu key không hợp lệ. |
| GET    | `/territory/war/history?limit=`               | No     | (Phase 14.0.D) War history grouped by `periodKey`. Response `TerritoryWarHistoryView { entries: TerritoryWarHistoryEntry[] }`. `entries[]` order DESC theo `settledAt` gần nhất; mỗi entry có `periodKey`, `startsAt/endsAt` (null nếu period là `manual_*`), `settledAt` (max settledAt across snapshots), `snapshots[]` 9 region (region nào skip period đó không có entry). `limit` default 8, clamp `1..32`. |
| POST   | `/admin/territory/war/settle-current`         | ADMIN  | (Phase 14.0.D) Settle period **hiện tại** (cắt sớm — admin/test trigger). Khác `/admin/territory/settle` (mặc định settle previous period). Idempotent qua UNIQUE `(regionKey, periodKey)` race-safe; gọi 2 lần → cùng snapshot id. Response `TerritoryWarSettleCurrentResult { periodKey, settledAt, snapshots[], skippedRegions[], ownersAfter: TerritoryRegionOwnerSnapshotView[] }` — `ownersAfter` cho FE refresh không cần round-trip. **No-influence rule**: region không có sect đủ điểm → KHÔNG ghi snapshot, KHÔNG đổi owner state → liệt kê trong `skippedRegions`. Audit `settledBy = req.userId`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID` (defensive). |
| POST   | `/admin/territory/rewards/grant-weekly`       | ADMIN  | (Phase 14.0.E) Grant weekly territory owner reward mail. Body JSON `{ periodKey?: string, dryRun?: boolean \| 'true' \| 'false' }` — tất cả optional. `periodKey` default `previousTerritoryPeriodKey()`. Với mỗi region đã settle (lookup `SectTerritorySettlementSnapshot`), service tìm winner sect → tất cả `Character` đang `sectId === winnerSectId` (snapshot rule: **member hiện tại tại thời điểm grant**) → gửi mail từ `TERRITORY_OWNER_REWARDS` shared catalog (linhThach + exp + items). Idempotent qua UNIQUE `(periodKey, regionKey, characterId)` ở `TerritoryOwnerRewardGrant` — gọi lại cùng `periodKey` KHÔNG gửi mail trùng. `dryRun=true` đếm "would create" KHÔNG mutate (không insert grant row, không tạo mail). Response `TerritoryRewardGrantSummary { periodKey, regionsProcessed, mailsCreated, skippedAlreadyGranted, skippedNoWinner, skippedNoMembers, dryRun, regions: { regionKey, skippedNoWinner, skippedNoMembers, winnerSectId, winnerSectName, mailsCreated, alreadyGranted, memberCount }[] }`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `INVALID_INPUT` (zod strict), 400 `PERIOD_INVALID`. **NO cron tự động** — admin trigger only (Phase 14.0.F handoff cho automation). |
| POST   | `/admin/liveops/run-weekly-cycle`             | ADMIN  | (Phase 13.2.D + 14.0.F + 15.7) Force-run combo weekly cycle: territory settle previous period → decay influence → grant owner reward mail → sect season snapshot → **Champion + MVP reward grant** (Phase 15.7). Body JSON `{ periodKey?: string, bypassLease?: boolean }` — strict zod, key extra → 400 `INVALID_INPUT`. `periodKey` default `previousTerritoryPeriodKey()`. `bypassLease=true` skip Redis lease (chỉ admin force-run; cron tự động luôn dùng lease). Idempotent qua DB UNIQUE — gọi 2 lần KHÔNG double mail (P2002 swallow trả `skippedAlreadyGranted`/`alreadyGranted`). Race-safe (Redis lease optimistic + DB UNIQUE final). Response `WeeklyCycleSummary { startedAt, finishedAt, skippedAlreadyDone, triggeredBy, territory: TerritoryCycleSummary, sectSeason: SectSeasonCycleSummary }` — `TerritoryCycleSummary { periodKey, territorySettled, territorySkipped, territoryDecaySkipped, territoryDecayDelta, rewardMailsCreated, rewardSkippedAlreadyGranted, errors[] }`, `SectSeasonCycleSummary { seasonSnapshotsCreated, seasonSnapshotsSkipped, seasonsProcessed: string[], championMailsCreated, championAlreadyGranted, mvpMailsCreated, mvpAlreadyGranted, errors[] }` (4 field cuối Phase 15.7). Fail-soft: lỗi 1 stage push vào `errors[]` KHÔNG block stage còn lại. Audit `ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE` (no secret meta). Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `INVALID_INPUT`, 400 `PERIOD_INVALID`. |
| POST   | `/admin/territory/cron/run-now`               | ADMIN  | (Phase 13.2.D + 14.0.F) Chỉ chạy phần territory cycle (settle + decay + reward mail) — không snapshot sect season. Body cùng schema `/admin/liveops/run-weekly-cycle`. Response = `TerritoryCycleSummary` (xem trên). Idempotent + race-safe cùng cách. Audit `ADMIN_TERRITORY_CRON_RUN`. |
| POST   | `/admin/sect-season/cron/run-now`             | ADMIN  | (Phase 13.2.D + 14.0.F + 15.7) Chỉ chạy phần sect season snapshot + **Champion + MVP reward grant** — không chạy territory. Body JSON `{ bypassLease?: boolean }` strict. Snapshot mọi `SECT_SEASONS` có `endsAtIso ≤ now`, idempotent qua UNIQUE `seasonKey` (`sectSeasonSnapshot` + `sectSeasonSectRank` + `sectSeasonTopMember`). Sau snapshot, grant Champion mail cho mọi member của sect rank-1 (cap 100 theo characterId ASC) + MVP mail cho top-1 cá nhân — idempotent qua UNIQUE `(seasonKey, rewardType, characterId)` ở `SectSeasonRewardGrant`. Gọi 2 lần → lần 2 trả `championAlreadyGranted`/`mvpAlreadyGranted` cao. Response = `SectSeasonCycleSummary` (xem trên). Audit `ADMIN_SECT_SEASON_CRON_RUN`. |
| GET    | `/admin/territory/cron/status`                | ADMIN  | (Phase 15.7 + 15.8) Read-only snapshot tình trạng cron territory. Response `{ enabled, cron, timezone, previousPeriodKey, lastSettlement: { periodKey, settledAt } \| null, lastDecay: { periodKey, appliedAt } \| null, lastReward: { periodKey, grantedAt } \| null, health: { status: 'OK' \| 'STALE' \| 'DEGRADED' \| 'DISABLED', lastRunAt: string \| null, lastSuccessAt: string \| null, lastErrorAt: string \| null, staleReason: string \| null, nextExpectedRunAt: string \| null } }`. **Phase 15.8** — `health` field thêm. `staleReason` semantic codes: `CRON_DISABLED`, `TERRITORY_CRON_NEVER_RAN`, `TERRITORY_CRON_LAST_SUCCESS_MS_TOO_OLD`, `TERRITORY_CRON_LAST_RUN_FAILED`. Threshold stale = 8 ngày silence (1 ngày buffer trên weekly cycle). KHÔNG audit. |
| GET    | `/admin/sect-season/cron/status`              | ADMIN  | (Phase 15.7 + 15.8) Read-only snapshot tình trạng cron sect season. Response `{ enabled, cron, timezone, lastSnapshot: { seasonKey, finalizedAt } \| null, lastChampionGrant: { seasonKey, grantedAt } \| null, lastMvpGrant: { seasonKey, grantedAt } \| null, health: <same shape as territory> }`. **Phase 15.8** — `health` field thêm. Threshold stale = 2 ngày silence (1 ngày buffer trên daily cycle). KHÔNG audit. |

**Buff catalog (Phase 14.0.C)** — `packages/shared/src/territory-buffs.ts` `TERRITORY_REGION_BUFFS`:

| Region | Buff key | Type | Value | AppliesTo | Element |
|---|---|---|---|---|---|
| `son_coc` | `territory_son_coc_exp` | `EXP_BONUS` | 0.05 | `DUNGEON_REWARD` | — |
| `hac_lam` | `territory_hac_lam_drop` | `LINH_THACH_BONUS` | 0.05 | `DUNGEON_REWARD` | — |
| `moc_huyen_lam` | `territory_moc_huyen_lam_dmg` | `ELEMENTAL_DAMAGE` | 0.05 | `COMBAT`,`ELEMENTAL` | `moc` |
| `kim_son_mach` | `territory_kim_son_mach_dmg` | `ELEMENTAL_DAMAGE` | 0.05 | `COMBAT`,`ELEMENTAL` | `kim` |
| `hoang_tho_huyet` | `territory_hoang_tho_huyet_def` | `DEFENSE_BONUS` | 0.05 | `COMBAT` | — |

Buff CHỈ áp dụng nếu character thuộc Tông sở hữu region (`character.sectId === ownerSectId`). Phase 14.0.C wire `DUNGEON_REWARD` (EXP_BONUS / LINH_THACH_BONUS) trong `DungeonRunService.claimRun()` fail-soft owner-only — KHÔNG double-apply khi retry. `COMBAT/ELEMENTAL/DEFENSE` catalog ship sẵn, defer wire vào combat pipeline phase sau.

**Influence sources (Phase 14.0.A)** — chỉ ghi điểm qua hook chạy trong tx của gameplay flow:

| Source key             | Points | Daily cap | Weekly cap | Trigger |
|------------------------|--------|-----------|------------|---------|
| `dungeon_clear`        | 8      | 60        | 420        | `DungeonRunService.claimRun()` khi dungeon template có `regionKey`. SourceId = `runId`. |
| `boss_participation`   | 12     | —         | 96         | `BossService.distributeRewards()` cho mọi participant rank ≥ 1 với boss có `regionKey ∈ MAP_REGIONS`. SourceId = `${bossId}:${characterId}`. |
| `boss_top_damage`      | 20     | —         | 80         | Cộng thêm cho rank-1 participant khi boss có `regionKey ∈ MAP_REGIONS`. SourceId = `${bossId}:${characterId}` (sourceKey khác → composite UNIQUE riêng row). |

Idempotency qua composite UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)` ở table `SectTerritoryInfluence` — caller retry an toàn, KHÔNG ghi double điểm.

Cap enforcement compute trước insert; reject = no-op (return `null` từ `addInfluenceTx`). Hook chạy trong `try/catch` swallow → gameplay flow KHÔNG fail nếu territory ghi điểm fail.

Character không có sect → `addInfluenceTx` skip silent (không ghi row, không throw).

## Boss — `BossController`

| Method | Path                | Auth  | Mô tả |
|--------|---------------------|-------|-------|
| GET    | `/boss/current`     | Yes   | Boss đang active + top 10 damage. |
| POST   | `/boss/:id/attack`  | Yes   | Đánh boss; khi HP ≤ 0 → distribute reward theo rank (top 1 = 50%). Phase 13.0 §C: reward hooks unlock title `achievement_first_boss` (mọi participant), apply buff `event_double_drop` (top-1, 1h), unlock title `event_huyet_nguyet_2026` nếu spawn từ Huyết Nguyệt slot. |
| POST   | `/boss/admin/spawn` | ADMIN | Spawn boss thủ công. Body `{ bossKey?: string, regionKey?: BossRegionKey, level?: 1\|2\|3, reason?: string≤200 }`. Audit kép: legacy `BOSS_SPAWN` (backwards-compatible) **+** Phase 13.1.C `ADMIN_FORCE_BOSS_SCHEDULE` cùng meta `{ bossKey, regionKey, level, bossId, scheduledEventKey?: string\|null, reason: string\|null }`. `reason` trim; whitespace-only → `null`. Response `{ id, bossKey, name, level, regionKey, currentHp, maxHp }`. |

**Phase 13.0 §B — scheduled boss heartbeat**: BossService heartbeat (mỗi N giây) đọc `bossScheduleForToday(now, MISSION_RESET_TZ)` từ shared `LIVE_OPS_EVENTS`, mỗi region check active/upcoming slot. Spawn nếu slot active + region không có `WorldBoss` ACTIVE + chưa có spawn `(regionKey, bossKey, spawnedAt >= slotStart)` (slot dedup, idempotent qua parallel heartbeat). KHÔNG schema migration — slot dedup query-based.

## LiveOps — `LiveOpsController` (Phase 13.0 §D)

| Method | Path             | Auth | Mô tả |
|--------|------------------|------|-------|
| GET    | `/liveops/today` | None | Pure compute (< 1ms) trả retention dashboard snapshot. |

**Response shape** (`200 OK`):

```json
{
  "ok": true,
  "data": {
    "nowIso": "2026-05-09T14:30:00.000Z",
    "timezone": "Asia/Ho_Chi_Minh",
    "todayEvents": [{ "key": "...", "type": "BOSS|DAILY|WEEKLY|LIMITED|STORY", "titleI18nKey": "liveops.event.<key>.title", "descriptionI18nKey": "...", "rewardHintI18nKey?": "...", "bossKey?": "...", "regionKey?": "...", "dailyTime?": "12:00", "daysOfWeek?": [6], "durationMinutes?": 30 }],
    "activeEvents": [/* same shape, filter active at nowIso */],
    "nextEvent": { /* shape + slotStartIso, slotEndIso, secondsUntilStart */ } | null,
    "bossSchedule": [{ "key": "...", "bossKey": "...", "regionKey": "...", "slotStartIso": "...", "slotEndIso": "...", "status": "upcoming|active|completed", "secondsUntilStart": 0 }],
    "suggestedActivities": [{ "key": "...", "kind": "boss|event|daily|weekly", "titleI18nKey": "...", "bossKey?": "...", "regionKey?": "...", "secondsUntilStart?": 0 }]
  }
}
```

Override timezone qua env `LIVEOPS_TZ` (default `Asia/Ho_Chi_Minh` reuse `MISSION_RESET_TZ`). Không cache HTTP — backend pure compute đủ nhanh; FE auto refresh 60s.

## Daily Login — `DailyLoginController` (PR #80, M9)

| Method | Path                 | Auth | Mô tả |
|--------|----------------------|------|-------|
| GET    | `/daily-login/me`    | Yes  | `{ todayDateLocal, canClaimToday, currentStreak, nextRewardLinhThach }`. Tính theo `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`). |
| POST   | `/daily-login/claim` | Yes  | Idempotent: lần đầu trong ngày → +100 LT + ghi `CurrencyLedger reason=DAILY_LOGIN`; gọi lần 2 → `{ claimed: false }`. |

## Leaderboard — `LeaderboardController` (PR #59)

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/leaderboard/power?limit=50` | Yes | Top theo `(realm, power)` desc, clamp `1 ≤ limit ≤ 50`. Trả `{ entries: [{ rank, characterId, name, sectKey, realmKey, realmStage, power }] }`. |

## Shop — `ShopController`

| Method | Path        | Auth | Mô tả |
|--------|-------------|------|-------|
| GET    | `/shop/npc` | Yes  | Catalog NPC items. Mỗi entry kèm `dailyLimit: number \| null` (M10) để FE hiển thị badge "X/Y today". |
| POST   | `/shop/buy` | Yes  | `{ itemKey, qty }` → trừ tiền + grant item + ghi `ItemLedger reason=SHOP_BUY`. M10 layered guard: **per-user rate limit** 30 req/60s (Redis sliding window + in-memory failover) → 429 `RATE_LIMITED`; **per-item daily cap** từ `ShopEntryDef.dailyLimit` (sum `qtyDelta` ledger SHOP_BUY trong cửa sổ DAILY local tz `MISSION_RESET_TZ`) → 409 `SHOP_DAILY_LIMIT`. Pre-check trước transaction → KHÔNG trừ tiền khi reject. |

## Mission — `MissionController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/missions/me`        | Yes  | Progress daily/weekly/once của player + `serverDateLocal`. Reset theo `MISSION_RESET_TZ`. |
| POST   | `/missions/:id/claim` | Yes  | Nhận thưởng khi `progress >= target`. Idempotent qua `claimedAt`. **Phase 16.5 update**: response thêm `{ missions, claim: { missionKey, granted: { exp, linhThach, tienNgoc }, capped, cappedAmount?, dailyCapRemaining: { exp, linhThach } } }` từ `RewardCapService.applyCapTx` (per-character / per-day / per-source MISSION cap). Ledger ghi số grant THỰC. |

WS push: `mission:progress` (PR #63) emit sau `MissionService.track()` qua `MissionWsEmitter` throttle 500ms/user.

## Mail — `MailController`

| Method | Path                | Auth  | Mô tả |
|--------|---------------------|-------|-------|
| GET    | `/mail/me`          | Yes   | Inbox (≤100 mail desc). |
| GET    | `/mail/unread-count`| Yes   | `{ count }`. Hydrate badge sau login (PR #71, M7). |
| POST   | `/mail/:id/read`    | Yes   | Đánh dấu đã đọc. |
| POST   | `/mail/:id/claim`   | Yes   | Nhận thưởng; CAS chống double-claim. |

## Giftcode — `GiftcodeController` + `AdminController`

| Method | Path                              | Auth  | Mô tả |
|--------|-----------------------------------|-------|-------|
| POST   | `/giftcodes/redeem`               | Yes   | `{ code }` → trao reward, 1 user / 1 code. |
| GET    | `/admin/giftcodes?q=&status=&limit=` | ADMIN | List codes + filter (PR #81 G22). Status: `ACTIVE` / `REVOKED` / `EXPIRED` / `EXHAUSTED`. |
| POST   | `/admin/giftcodes`                | ADMIN | Tạo code. Trùng `code` → 409 `CODE_EXISTS` (PR #84 G23). |
| POST   | `/admin/giftcodes/:code/revoke`   | ADMIN | Vô hiệu hoá. |

## Topup & Admin — `TopupController`, `AdminController`

| Method | Path                                  | Auth  | Mô tả |
|--------|---------------------------------------|-------|-------|
| GET    | `/topup/packages`                     | —     | Catalog gói topup. |
| GET    | `/topup/me`                           | Yes   | Lịch sử đơn của user. |
| POST   | `/topup/create`                       | Yes   | `{ packageId, proofMessage }`. |
| GET    | `/admin/users?q=&role=&banned=&page=` | ADMIN | List user + filter (PR earlier — role/banned). |
| POST   | `/admin/users/:id/ban`                | ADMIN | `{ banned }`. |
| POST   | `/admin/users/:id/role`               | ADMIN | `{ role }` — ADMIN-only (M8). |
| POST   | `/admin/users/:id/grant`              | ADMIN | `{ linhThach, tienNgoc, reason }` — qua `CurrencyService` + ghi ledger `ADMIN_GRANT`. |
| POST   | `/admin/users/:id/inventory/revoke`   | ADMIN | `{ itemKey, qty, reason }` (PR #66) — trừ qty + ghi `ItemLedger reason=ADMIN_REVOKE`. |
| GET    | `/admin/topups?status=&q=&from=&to=&page=` | ADMIN | List đơn topup + filter date/email. |
| POST   | `/admin/topups/:id/approve`           | ADMIN | `{ note }` → credit tienNgoc + ledger. |
| POST   | `/admin/topups/:id/reject`            | ADMIN | `{ note }`. |
| GET    | `/admin/audit?action=&q=&page=`       | ADMIN | Audit log + filter action/actor email. |
| GET    | `/admin/stats`                        | ADMIN | Dashboard counters (users/topups pending/economy). |
| GET    | `/admin/economy/alerts`               | ADMIN | Smart alerts: currency âm, item qty âm, ledger discrepancy (PR #54). |
| POST   | `/admin/mail/send`                    | ADMIN | Gửi cho 1 character. |
| POST   | `/admin/mail/broadcast`               | ADMIN | Gửi toàn server. |

## Next Action — `NextActionController` (smart UX)

| Method | Path                | Auth | Mô tả |
|--------|---------------------|------|-------|
| GET    | `/me/next-actions`  | Yes  | Trả list "Nên làm gì tiếp?" — sắp đột phá / mission claim / mail unread / giftcode khả dụng / boss đang mở / daily login. |

## Logs — `LogsController` (PR #88, M6)

| Method | Path                                     | Auth | Mô tả |
|--------|------------------------------------------|------|-------|
| GET    | `/logs/me?type=currency\|item&limit=&cursor=` | Yes | Self audit log của user — query `CurrencyLedger` hoặc `ItemLedger` của character mình. Keyset pagination `(createdAt DESC, id DESC)`. `limit ∈ [1, 50]`, default 20. Cursor opaque base64url `{createdAt.toISOString()}|{id}`. Response `{ entries: LogEntry[], nextCursor }`. Errors: `NO_CHARACTER` (404), `INVALID_CURSOR` (400). BigInt `delta` serialize as string. |

`LogEntry` shape:
- `LogEntryCurrency`: `{ kind: 'CURRENCY', id, createdAt, reason, refType, refId, actorUserId, currency: 'LINH_THACH'|'TIEN_NGOC', delta: string }`
- `LogEntryItem`: `{ kind: 'ITEM', id, createdAt, reason, refType, refId, actorUserId, itemKey, qtyDelta: number }`

## WebSocket — `/ws` (RealtimeGateway)

Auth từ cookie `xt_access` (ưu tiên) hoặc `handshake.auth.token`.

| Event                | Direction      | Payload |
|----------------------|----------------|---------|
| `cultivate:tick`     | server → user  | `{ exp, realm, cultivating }` per tick. |
| `chat:msg`           | server → room  | `{ id, characterName, channel, body, createdAt }`. |
| `boss:update`        | server → all   | HP + top damager sau attack. |
| `market:listing:new` | server → all   | Listing mới. |
| `mission:progress`   | server → user  | `{ characterId, changes: MissionProgressChange[] }` (PR #63 — throttle 500ms). |
| `mail:new`           | server → user  | (kế hoạch) Khi admin gửi mail mới. |

## Sect War — `SectWarController` (prefix `/sect-war`)

> Phase 13.1.A — Tông Môn Chiến theo tuần. weekKey = ISO `YYYY-Www`, timezone reuse `MISSION_RESET_TZ`. Mọi state authoritative ở server; FE chỉ render.

| Method | Path                       | Auth | Mô tả |
|--------|----------------------------|------|-------|
| GET    | `/sect-war/current`        | Yes  | Snapshot tuần hiện tại: `{ weekKey, season{startsAtIso,endsAtIso,timezone}, activities[], rewardTiers[], leaderboard[], me }`. `activities` + `rewardTiers` mirror shared catalog (server snapshot, FE không cần import shared). |
| GET    | `/sect-war/leaderboard?weekKey=` | Yes | `{ weekKey, rows: [{ rank, sectId, sectName, points, contributors }] }`. weekKey query optional (default current). |
| GET    | `/sect-war/me`             | Yes  | `{ weekKey, hasSect, sectId, sectName, personalPoints, breakdown[], sectRank, sectPoints, eligibleTierKey, alreadyClaimed, canClaim }`. |
| POST   | `/sect-war/claim`          | Yes  | Claim weekly reward. Atomic CAS qua composite UNIQUE `(weekKey, characterId)`. Trả `{ weekKey, rewardTierKey, granted{linhThach,tienNgoc}, sectRank, personalPoints }`. |

**Sect War error codes**:
- `SECT_REQUIRED` — character chưa gia nhập tông môn.
- `SECT_WAR_NOT_CLAIMABLE` — sect không có rank đủ điều kiện trong tuần (rank > 10) và personal points < participation threshold.
- `SECT_WAR_ALREADY_CLAIMED` — đã claim tuần này (composite UNIQUE).
- `SECT_WAR_NO_REWARD` — không có tier nào áp dụng (no-op safety).
- `NO_CHARACTER` — chưa có nhân vật.

**Idempotency** contribution: composite UNIQUE `(weekKey, characterId, activityKey, sourceType, sourceId)` trên `SectWarContribution`. Hook gameplay (DungeonRun.claim, Boss.distributeRewards, DailyLogin.claim, Quest.claim) gọi `addContributionTx` trong cùng transaction — retry hook → P2002 silently skipped (return null). Daily cap window theo `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`, 00:00 ICT) — đồng nhất với dungeon dailyLimit / mission DAILY / daily-login streak. Weekly cap qua ISO week (Mon 00:00 ICT → Sun 23:59 ICT).

## Sect Season — `SectSeasonController` (prefix `/sect-season`, Phase 13.2.A)

> Phase 13.2.A — mùa giải dài hạn cho Tông Môn. Catalog ở [`packages/shared/src/sect-season.ts`](../packages/shared/src/sect-season.ts). 13 mùa × 4 tuần ISO (≈ 1 năm) phủ `2026-03-30 → 2027-03-28 ICT`, mỗi mùa start Monday 00:00 ICT (`MISSION_RESET_TZ` = `Asia/Ho_Chi_Minh`). 5 milestone cá nhân monotonic increasing (bronze 100pt → silver 500pt → gold 2000pt → platinum 5000pt → diamond 7500pt). **Read-only Phase 13.2.A** — KHÔNG migration, KHÔNG INSERT/UPDATE; service derive điểm season qua `groupBy SectWarContribution where weekKey IN sectSeasonWeekKeys(season)` aggregation. **KHÔNG có claim endpoint** — Phase 13.2.A chỉ display preview milestone; claim sẽ ở Phase 13.2.B+.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/sect-season/current`                | Yes  | Snapshot full state mùa hiện tại: `{ seasonKey, season{key,startsAtIso,endsAtIso,durationWeeks,timezone,labelI18nKey,descriptionI18nKey}, milestones[], leaderboard[], me }`. `season` server snapshot từ catalog (FE không cần import shared). Khi out-of-season (out of all 13 windows): `seasonKey=null`, `season=null`, `milestones=[]`, `leaderboard=[]`, `me=null`. |
| GET    | `/sect-season/leaderboard?seasonKey=` | No   | Top 10 sect tổng hợp theo season: `{ seasonKey, rows: [{ rank, sectId, sectName, points, contributors, weeksContributed }] }`. `seasonKey` query optional (default `currentSectSeason(now).key`). Aggregation: `prisma.sectWarContribution.groupBy by characterId/sectId where weekKey IN sectSeasonWeekKeys(season)` → sum points → top 10 tie-break `(points desc, sectId asc)`. `weeksContributed` = distinct weekKey count cho sect đó. |
| GET    | `/sect-season/me?seasonKey=`          | Yes  | Personal status mùa: `{ seasonKey, hasSect, sectId, sectName, personalPoints, weeksContributed, achievedMilestoneKeys[], nextMilestoneKey }` hoặc `null` khi out-of-season. `personalPoints` = sum `SectWarContribution.points` của character qua `weekKey IN sectSeasonWeekKeys(season)`. `achievedMilestoneKeys[]` = derive từ `sectSeasonAchievedMilestones(personalPoints)`; `nextMilestoneKey` = `sectSeasonNextMilestone(personalPoints)?.key ?? null`. `hasSect=false` khi `Character.sectId == null` — vẫn trả `personalPoints` để player thấy lịch sử trước khi join sect. |

### Phase 13.2.C — Sect Season History + Hall of Fame

> Phase 13.2.C — lưu kết quả mùa giải đã chốt + bảng vinh danh tích lũy. Migration `20260605000000_phase_13_2_c_sect_season_history` thêm 3 bảng mới: `SectSeasonSnapshot { seasonKey unique, finalizedAt, totalSects, totalContributors, totalPoints, championSectId?, championSectName?, championPoints?, mvpCharacterId?, mvpCharacterName?, mvpSectId?, mvpSectName?, mvpPoints? }` (denormalized champion/MVP để list view không cần JOIN), `SectSeasonSectRank { seasonId FK, rank, sectId, sectName, points, contributors, weeksContributed }` (composite UNIQUE `(seasonId, rank)` + `(seasonId, sectId)`), `SectSeasonTopMember { seasonId FK, rank, characterId, characterName, sectId?, sectName?, points }` (composite UNIQUE `(seasonId, rank)` + `(seasonId, characterId)`). Snapshot capture tên Sect/Character tại thời điểm finalize → audit-correct, không follow rename. **`SECT_SEASON_TOP_MEMBERS = 10`** constant — top 10 individual contributors. Snapshot creation **idempotent**: `snapshotSeason(seasonKey)` check `findUnique({ seasonKey })` trước → return existing nếu đã có (no double snapshot). Phase 13.2.C **chưa có endpoint trigger snapshot từ player** — tạo qua test/dev script hoặc Phase 13.2.B+ settlement runtime.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/sect-season/history`                | No   | List tất cả mùa đã chốt (newest first by `finalizedAt desc`). Response `{ seasons: [{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, champion: { rank:1, sectId, sectName, points, contributors:0, weeksContributed:0 }\|null, mvp: { rank:1, characterId, characterName, sectId\|null, sectName\|null, points }\|null }] }`. `champion`/`mvp` = denormalized header từ snapshot, dùng cho list view nhanh không JOIN. Empty array khi chưa có mùa nào finalized. |
| GET    | `/sect-season/history/:seasonKey`     | No   | Detail snapshot 1 mùa. Response `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, sects: SectSeasonSectRank[] (rank asc), topMembers: SectSeasonTopMember[] (rank asc, top 10) }`. 404 `SNAPSHOT_NOT_FOUND` khi `seasonKey` chưa được snapshot; 404 `SEASON_NOT_FOUND` khi `seasonKey` ∉ catalog. |
| GET    | `/sect-season/hall-of-fame`           | No   | Bảng vinh danh tích lũy qua tất cả mùa đã chốt. Response `{ totalSeasonsFinalized, sects: [{ sectId, sectName, championships, podiums, appearances, bestRank, totalPoints, latestSeasonKey }], members: [{ characterId, characterName, mvps, podiums, appearances, bestRank, totalPoints, latestSeasonKey, latestSectName\|null }] }`. Sect ordering: `championships desc → podiums desc → totalPoints desc → sectId asc`. Member ordering: `mvps desc → podiums desc → totalPoints desc → characterId asc`. `bestRank` = min rank đã đạt qua các mùa. `latestSeasonKey` = `finalizedAt desc` mùa tham gia gần nhất. |

**Sect Season History error codes**:

- `SNAPSHOT_NOT_FOUND` — `seasonKey` chưa được finalize/snapshot.
- `SEASON_NOT_FOUND` — `seasonKey` không có trong catalog.

**Idempotency** snapshot: `snapshotSeason(seasonKey)` query `findUnique({ seasonKey })` trước. Nếu đã có row → return existing snapshot (no-op). Nếu chưa → tạo trong 1 transaction: derive sects + topMembers từ `SectWarContribution` qua `sectSeasonWeekKeys(season)` aggregation (giống logic leaderboard live), rồi `prisma.sectSeasonSnapshot.create({ data: { ..., sects: { create: [...] }, topMembers: { create: [...] } } })` nested write atomic. Composite UNIQUE `seasonKey` enforce no-double-snapshot ở DB level.

**Sect Season error codes**:
- `NO_CHARACTER` — chưa có nhân vật (chỉ áp dụng cho `/current` + `/me`).
- `SEASON_NOT_FOUND` — `seasonKey` query không có trong catalog.

**Idempotency** read-only: KHÔNG có write path. Aggregation đọc trực tiếp từ `SectWarContribution` (Phase 13.1.A composite UNIQUE đã chống double-add gameplay hooks). `currentSectSeason(now)` resolve theo `MISSION_RESET_TZ` Monday 00:00 ICT — đồng nhất với Sect War tuần / mission DAILY/WEEKLY / daily-login streak / Sect Season window.

## Sect Missions — `SectMissionController` (prefix `/sect`, Phase 13.1.B)

> Phase 13.1.B — daily/weekly mission Tông Môn cộng `congHien` (= `Character.contribBalance`). Catalog ở [`packages/shared/src/sect-missions.ts`](../packages/shared/src/sect-missions.ts). Server-authoritative; FE chỉ render.

| Method | Path                          | Auth | Mô tả |
|--------|-------------------------------|------|-------|
| GET    | `/sect/missions`              | Yes  | Snapshot mission list của character. Response `{ contribLifetime, contribBalance, sectId, sectName, missions: SectMissionView[] }`. Mỗi `SectMissionView` gồm `{ key, cadence: 'DAILY'\|'WEEKLY', activityKey, target, rewardContribution, rewardCurrency?, rewardCurrencyAmount?, rewardItemKey?, rewardItemQty?, titleI18nKey, descriptionI18nKey, progress, ready, claimed, periodKey, periodStartIso, periodEndIso }`. `progress` derive từ `SectWarContribution` rows hoặc `Character` snapshot trong period window. `claimed` true nếu đã có row `SectMissionClaim(characterId, missionKey, periodKey)`. |
| POST   | `/sect/missions/:key/claim`   | Yes  | `:key` = mission key (ví dụ `sect_daily_dungeon_3`). Atomic transaction: assert `progress >= target` + insert `SectMissionClaim(characterId, missionKey, periodKey)` (P2002 → `MISSION_ALREADY_CLAIMED`) + cộng `Character.contribBalance` + `contribLifetime` + (optional) cộng `linhThach` qua `CurrencyService` + (optional) grant item qua `InventoryService.grantTx`. Ledger `SECT_MISSION_CLAIM`. Trả `{ missionKey, cadence, periodKey, rewardContribution, contribBalanceAfter, contribLifetimeAfter, rewardLinhThach? }`. |

**Sect Mission error codes**:
- `SECT_REQUIRED` — `Character.sectId == null` (chưa gia nhập tông môn).
- `MISSION_NOT_FOUND` — `:key` không có trong catalog.
- `MISSION_NOT_READY` — `progress < target`.
- `MISSION_ALREADY_CLAIMED` — đã claim cho cùng `(characterId, missionKey, periodKey)`.
- `NO_CHARACTER` — chưa có nhân vật.

## Sect Shop — `SectShopController` (prefix `/sect`, Phase 13.1.B)

> Phase 13.1.B — spend `congHien` đổi consumable/material. 5 entry catalog ở [`packages/shared/src/sect-shop.ts`](../packages/shared/src/sect-shop.ts). Atomic CAS, race-safe, rate-limited.

| Method | Path                | Auth | Mô tả |
|--------|---------------------|------|-------|
| GET    | `/sect/shop`        | Yes  | Snapshot catalog + per-character usage. Response `{ contribBalance, contribLifetime, sectId, sectName, entries: SectShopEntryView[] }`. Mỗi `SectShopEntryView` gồm `{ key, itemKey, contributionCost, dailyLimit?, weeklyLimit?, dailyUsed, weeklyUsed, requiredSectLevel?, labelI18nKey, descriptionI18nKey, stackable, maxStack? }`. `dailyUsed` / `weeklyUsed` aggregate từ `SectShopPurchase.qty` trong period window theo `MISSION_RESET_TZ`. |
| POST   | `/sect/shop/buy`    | Yes  | `{ entryKey: string, qty: number }` (qty >= 1). Pre-checks ngoài transaction: rate-limit (`RATE_LIMITED` 429 nếu vượt 30 req/60s), entry exists (`ENTRY_NOT_FOUND`), sectId (`SECT_REQUIRED`), stackable check (`NON_STACKABLE_QTY_GT_1` nếu qty>1 cho item non-stackable), daily/weekly limit (`SHOP_DAILY_LIMIT_REACHED` / `SHOP_WEEKLY_LIMIT_REACHED`). Transaction: CAS `prisma.character.updateMany({ where: { id, contribBalance: { gte: cost*qty } } })` (count=0 → `INSUFFICIENT_CONTRIB`) + `InventoryService.grantTx(tx, charId, itemKey, qty, 'SECT_SHOP_BUY')` + insert `SectShopPurchase` row. Ledger `SECT_SHOP_BUY`. Trả `{ entryKey, itemKey, qty, totalCost, contribBalanceAfter, dailyUsedAfter, weeklyUsedAfter }`. |

**Sect Shop error codes**:
- `SECT_REQUIRED` — chưa gia nhập tông môn.
- `ENTRY_NOT_FOUND` — `entryKey` không có trong catalog.
- `INSUFFICIENT_CONTRIB` — `contribBalance < cost*qty` (CAS reject — KHÔNG trừ tiền).
- `SHOP_DAILY_LIMIT_REACHED` — `dailyUsed + qty > dailyLimit`.
- `SHOP_WEEKLY_LIMIT_REACHED` — `weeklyUsed + qty > weeklyLimit`.
- `NON_STACKABLE_QTY_GT_1` — defensive guard `qty > 1` cho item non-stackable.
- `RATE_LIMITED` (429) — vượt 30 req/60s per user (Redis primary + in-memory fallback).
- `INVALID_INPUT` — qty < 1 hoặc kiểu sai.
- `NO_CHARACTER` — chưa có nhân vật.

## Story Dungeon — `StoryDungeonController` (prefix `/story/dungeons`, Phase 12.8.A + 12.8.B)

> **Phase 12.8.A** (PR #465) — read-only catalog API cho UI map view (GET endpoints).
> **Phase 12.8.B** (this PR) — runtime mutation API: start/advance/clear/claim qua Prisma `StoryDungeonRun` + auto-advance quest step + reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD`.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/story/dungeons`                     | Yes  | List catalog `enabled=true` + status compute. Service flow: (1) load `Character` (`realmKey`), (2) `realmByKey(realmKey).order` → realmOrder, (3) load `QuestProgress` rows → `Map<questKey, status>` + `Map<questKey, stepProgress>`, (4) for each `STORY_DUNGEONS[].enabled=true`: `computeStoryDungeonStatus(template, ctx)` → `'locked'/'available'/'cleared'`, (5) hydrate `monsterByKey` + optional `bossByKey` cho preview. **Phase 12.8.C** — bundle `activeRun: StoryDungeonRunView \| null` cùng response (run đang ACTIVE / CLEARED chưa claim, ưu tiên `startedAt` mới nhất; `null` nếu không có). Response `{ ok: true, data: { dungeons: StoryDungeonView[]; activeRun: StoryDungeonRunView \| null } }`. |
| GET    | `/story/dungeons/:key`                | Yes  | Single template view + status. `:key` regex `^story_dgn_[a-z0-9_]+$` (zod). 404 `DUNGEON_NOT_FOUND` nếu key không tồn tại HOẶC `enabled=false`. |
| POST   | `/story/dungeons/:key/start`          | Yes  | Phase 12.8.B. Start một `StoryDungeonRun` cho character hiện tại. Idempotent: nếu đã có ACTIVE run cùng `(characterId, templateKey)` → trả lại run đó (không tạo row mới). Reject `DUNGEON_LOCKED` (404) khi `computeStoryDungeonStatus !== 'available'` (quest chưa accepted/step chưa tới HOẶC realm chưa đủ). Reject `DUNGEON_ALREADY_CLEARED` (409) cho `template.oneTime=true` khi đã có row `CLAIMED`. Response `{ ok: true, data: { run: StoryDungeonRunView } }`. |
| POST   | `/story/dungeons/:runId/advance`      | Yes  | Phase 12.8.B. Body `{ monsterKey?: string }` (optional ghi log kill). `:runId` regex `^c[a-z0-9]{20,}$` (cuid). Ownership check: 404 `RUN_NOT_FOUND` nếu `run.characterId !== currentCharacterId`. Reject `RUN_NOT_ACTIVE` (409) khi status ≠ ACTIVE. Reject `RUN_STEP_INVALID` (409) khi `currentStep+1 > monsters.length`. Increment `currentStep` + push `monsterKey` vào `killedMonsters[]` Json. |
| POST   | `/story/dungeons/:runId/clear`        | Yes  | Phase 12.8.B. Verify `currentStep === monsters.length`. CAS guard `updateMany({where: {id, status: ACTIVE}, data: {status: CLEARED, clearedAt: now}})` — count=0 → idempotent return existing CLEARED state. Clear hook fires `applyQuestStepAdvance(characterId, template.requiredQuestKey, template.requiredQuestStep)` qua `QuestService.advanceStep` chỉ khi `QuestProgress.status === ACCEPTED` (no-op nếu COMPLETED/CLAIMED — fail-soft try-catch không throw 500). Errors: 404 `RUN_NOT_FOUND`, 409 `RUN_NOT_CLEARABLE` (status ≠ ACTIVE), 409 `RUN_STEP_INCOMPLETE` (chưa đi hết monster). |
| POST   | `/story/dungeons/:runId/claim`        | Yes  | Phase 12.8.B. Verify status=CLEARED. CAS guard `updateMany({where: {id, status: CLEARED}, data: {status: CLAIMED, claimedAt: now}})` — count=0 → 409 `RUN_NOT_CLAIMABLE` (đã CLAIMED HOẶC chưa CLEARED). Concurrent claim 2 request → exactly 1 winner. Reward grant SAU CAS: `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD`, refType `StoryDungeonRun`, refId `runId` cho `linhThach`/`tienNgoc`/`exp` + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD` cho items theo `template.rewardHint`. Composite UNIQUE `(characterId, refType, refId)` chống double-grant. Response `{ ok: true, data: { run, granted: { linhThach, tienNgoc, exp, items[] } } }`. |

**`StoryDungeonView` shape**:
```ts
{
  key: string;                                      // 'story_dgn_phamnhan_back_mountain'
  titleI18nKey: string;                             // 'story_dungeon.<key>.title'
  descriptionI18nKey: string;
  titleVi: string;                                  // hard-coded VN fallback
  descriptionVi: string;
  requiredQuestKey: string;                         // 'phamnhan_realm_01'
  requiredQuestStep: string | null;                 // 'step_01' | null = chỉ cần quest accepted
  regionKey: string;                                // RegionKey ∈ map-regions.ts
  recommendedRealm: string;                         // RealmDef.key (UI hint)
  minRealmKey: string | null;                       // gate; player.realm.order < min → locked
  npcKey: string | null;                            // NpcDef.key
  entryDialogueKey: string | null;                  // STORY_DIALOGUES[].id; Phase 12.8.B sẽ wire trigger
  clearDialogueKey: string | null;
  monsters: { key, name, element, level }[];        // hydrated qua monsterByKey
  boss: { key, name, recommendedRealm, regionKey } | null;
  rewardHint: { linhThach?, tienNgoc?, exp?, items?: { itemKey, qty }[] } | null;
  oneTime: boolean;
  status: 'locked' | 'available' | 'cleared';       // server-authoritative
}
```

**Status compute logic** (`computeStoryDungeonStatus`):
- `template.minRealmKey && realmOrder < min.order` → `locked`.
- `questState[requiredQuestKey] === 'CLAIMED'` → `cleared`.
- `questState[requiredQuestKey]` ∉ `{ACCEPTED, COMPLETED}` → `locked`.
- Có `requiredQuestStep` + state `ACCEPTED` + `stepProgress[step] < step.count` → `locked`.
- `state === 'COMPLETED'` (mọi step coi như đạt) → `available`.
- Else → `available`.

**Catalog seed** (Phase 12.8.A): 4 entries gắn 4 main quest đầu tiên — Phàm Nhân Hậu Sơn Linh Tuyền Động (`phamnhan_realm_01:step_01` — `son_coc`, no minRealm), Luyện Khí Hắc Lâm Tâm Thử (`luyenkhi_main_01:step_02` — `hac_lam`, minRealm=`luyenkhi`), Trúc Cơ Mộc Huyền Lâm Ký Ức Cổ Thụ (`truc_co_main_01:step_03` — `moc_huyen_lam`, minRealm=`truc_co`), Kim Đan Kim Sơn Thiên Lò Lệnh (`kim_dan_main_01:step_02` — `kim_son_mach`, minRealm=`kim_dan`).

**Read-only invariants**: KHÔNG Prisma migration, KHÔNG mutation, KHÔNG `RewardLedger`. Service chỉ đọc `Character.realmKey` + `QuestProgress` qua `PrismaService.findUnique` + `findMany` — KHÔNG re-enter `QuestService` / `DungeonRunService` / `CurrencyService`. Phase 12.8.B sẽ thêm: (1) `StoryDungeonRun` Prisma model với composite UNIQUE `(characterId, templateKey)` cho oneTime guard, (2) 4 endpoint mutation (`POST /story/dungeons/:key/start`, `POST /story/dungeon-runs/:runId/next`, `POST /story/dungeon-runs/:runId/claim`, `POST /story/dungeon-runs/:runId/abandon`), (3) reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` (composite UNIQUE `(characterId, refType, refId)` chống double-grant), (4) auto-advance quest step khi clear (`QuestService.track('kill','monster', ...)` cho mỗi monster trong template hoặc explicit `advance_quest_step` cho narrative step), (5) entry/clear dialogue trigger.

## Story Dialogue — `StoryDialogueController` (prefix `/story/dialogue`, Phase 12 Story PR-7 + Phase 12.9 Branch Advanced)

> Phase 12 Story Dialogue Foundation — branching NPC dialogue catalog cho main quest. Catalog ở [`packages/shared/src/story-dialogues.ts`](../packages/shared/src/story-dialogues.ts) (`STORY_DIALOGUES`, helpers `findStoryDialogueNode`, `getStoryDialogueRoot`). Server-authoritative: FE chỉ render `StoryDialogueNodeView` mà server đã filter theo quest/flag/seen/choice.
>
> **Phase 12.9 Story Dialogue Branch Advanced** nâng cấp foundation: thêm condition `choice_made { nodeId, choiceKey }` (NPC nhớ lựa chọn cũ — server pick followup node theo path đã đi) + effect `clear_flag { flagKey }` (xoá flag, no-op nếu chưa set; cho plot reversal/apology arc) + persistent `Character.storyDialogueChoices` Json map (nodeId → choiceKey, last-write-wins per node). Hàn Dạ multi-step branching tree minh hoạ: `first_meet` rival/neutral → `followup_rival` (gate `choice_made(first_meet, rival)`) | `followup_neutral` → `resolution_apology` (gate `seen(followup_rival)` + `flag_equals(rival)`) choice `apologize` carries `clear_flag(han_da_relation)` revert. Specificity scoring: `choice_made` = 5 (same band quest_status — server pick followup trước fallback intro); `flag_equals` = 4; `seen`/`not_seen` = 3; `realm_min` = 2; always = 1.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/story/dialogue/:npcKey`             | Yes  | Trả node hội thoại story hiện tại cho NPC. Service resolve qua: (1) load `Character` (`realmKey`, `storyFlags`, `storyDialogueSeen`, `storyDialogueChoices`), (2) load `QuestProgress` rows của character, (3) build `CharCtx { realmKey, realmOrder, flags, seen, choices, questStatus }`, (4) filter nodes của NPC qua `evaluateAllConditions(ctx)` rồi pick theo `storyDialogueNodeSpecificity()` cao nhất. Response `StoryDialogueNodeView { nodeId, npcKey, questKey?, text (i18n key hoặc raw), textEn?, seen, previousChoiceKey, choices: StoryDialogueChoiceView[] }`. Mỗi choice gồm `{ key, label, labelEn?, available, unavailableReason, nextNodeId, alreadyApplied, previouslyChosen }`. **Phase 12.9 fields**: `previousChoiceKey: string \| null` (last-pick at this node, từ `storyDialogueChoices[nodeId]`); `previouslyChosen: boolean` per choice (`storyDialogueChoices[nodeId] === key` — KHÔNG disable button, chỉ hint cho FE render badge "đã chọn lần trước"). `unavailableReason` shapes: `'quest_status:foo=accepted'` \| `'flag_equals:bar=baz'` \| `'flag_set:k'` \| `'flag_unset:k'` \| `'seen:nodeId'` \| `'not_seen:nodeId'` \| `'realm_min:order=N'` \| `'choice_made:nodeId=key'` \| `'already_applied'` \| `null`. Choice không pass condition vẫn render với `available=false` để FE explain lý do. |
| POST   | `/story/dialogue/:npcKey/choice`      | Yes  | Body `{ nodeId: string, choiceKey: string }`. Atomic transaction: assert node hợp lệ + choice condition pass + node condition pass + chưa apply (nếu effect grant) + quest step không skip → apply effects theo thứ tự catalog: `set_flag` (set `Character.storyFlags[key]=value`), `clear_flag` (delete `Character.storyFlags[key]`, no-op nếu unset), `advance_quest_step` (chỉ chạy nếu quest ACCEPTED + step hợp lệ + chưa COMPLETED → gọi `QuestService.advanceStep` rollback nếu skip), `give_reward` (gọi `CurrencyService.applyTx` với reason `STORY_DIALOGUE_REWARD`, refType `StoryDialogueNode`, refId `nodeId` — idempotent qua composite UNIQUE chống double-grant; cap linhThach ≤ 100 / tienNgoc ≤ 5 / exp ≤ 200), `mark_seen` implicit (push `nodeId` vào `Character.storyDialogueSeen`). **Phase 12.9 persistence**: ghi `Character.storyDialogueChoices[nodeId] = choiceKey` last-write-wins per node — phục vụ condition `choice_made` cho node tiếp theo. Trả `{ effectsApplied: StoryDialogueEffect[], granted: { linhThach, tienNgoc, exp }, flags: Record<string,string\|number\|boolean>, seen: string[], choices: Readonly<Record<string,string>>, nextNode: StoryDialogueNodeView \| null }`. **Phase 12.9 response field**: `choices` snapshot post-apply để FE store sync (mirror `storyDialogueChoices` cho condition `choice_made` render đúng ở node tiếp theo). `nextNode` resolve qua re-pick highest-specificity node sau khi apply effects (KHÔNG return cùng node để tránh loop nếu đã seen + condition vẫn pass). |

**Choice / node condition kinds** (Phase 12 + 12.9):
- `quest_status` — `{ kind: 'quest_status', questKey, status: 'ACCEPTED'\|'COMPLETED'\|'CLAIMED' }`. Match với `QuestProgress.status` của character.
- `flag_equals` — `{ kind: 'flag_equals', flagKey, value }`. Match `Character.storyFlags[flagKey] === value`.
- `flag_set` — `{ kind: 'flag_set', flagKey }`. Match `flagKey` tồn tại (any value).
- `flag_unset` — `{ kind: 'flag_unset', flagKey }`. Match `flagKey` không tồn tại.
- `seen` — `{ kind: 'seen', nodeId }`. Match `Character.storyDialogueSeen.includes(nodeId)`.
- `not_seen` — `{ kind: 'not_seen', nodeId }`. Match `!Character.storyDialogueSeen.includes(nodeId)`.
- `realm_min` — `{ kind: 'realm_min', minOrder }`. Match `realmOrder(character.realmKey) >= minOrder`.
- **Phase 12.9** `choice_made` — `{ kind: 'choice_made', nodeId, choiceKey }`. Match `Character.storyDialogueChoices[nodeId] === choiceKey`. Specificity 5 (same band quest_status — server pick followup node trước fallback intro). Validator two-pass verify `nodeId` + `choiceKey` ref tồn tại trong catalog.

**Choice effect kinds** (Phase 12 + 12.9):
- `mark_seen` — `{ kind: 'mark_seen' }`. Implicit: server luôn add `nodeId` vào `Character.storyDialogueSeen` khi apply choice (idempotent set semantics).
- `set_flag` — `{ kind: 'set_flag', flagKey, value }`. Set `Character.storyFlags[flagKey] = value` (overwrite).
- **Phase 12.9** `clear_flag` — `{ kind: 'clear_flag', flagKey }`. Delete `Character.storyFlags[flagKey]` (no-op nếu chưa set; cho plot reversal/apology arc, không touch flag khác).
- `advance_quest_step` — `{ kind: 'advance_quest_step', questKey, stepKey, count? }`. Gọi `QuestService.advanceStep` chỉ khi quest ACCEPTED + step hợp lệ + chưa COMPLETED. Reject `QUEST_STEP_LOCKED` nếu skip step (rollback toàn transaction).
- `give_reward` — `{ kind: 'give_reward', linhThach?, tienNgoc?, exp? }`. Gọi `CurrencyService.applyTx` reason `STORY_DIALOGUE_REWARD`, refType `StoryDialogueNode`, refId `nodeId`. Cap: linhThach ≤ 100, tienNgoc ≤ 5, exp ≤ 200. Idempotent qua composite UNIQUE — duplicate apply throws `ALREADY_APPLIED`.

**Story Dialogue error codes**:
- `NPC_NOT_FOUND` — `npcKey` không có trong shared catalog `NPCS`.
- `STORY_DIALOGUE_NOT_AVAILABLE` — NPC không có entry node nào pass condition cho character này (chưa unlock dialog).
- `NODE_NOT_FOUND` — `nodeId` body không tồn tại trong catalog dưới `npcKey` đó.
- `CHOICE_NOT_FOUND` — `choiceKey` body không tồn tại trên node.
- `CHOICE_LOCKED` — choice tồn tại nhưng `available=false` server-side (condition fail giữa GET và POST hoặc client bypass).
- `CHOICE_ALREADY_APPLIED` — choice `oncePerCharacter` đã apply trước đó.
- `QUEST_STEP_LOCKED` — `advance_quest_step` effect chỉ hợp lệ nếu quest ACCEPTED + step matches; nếu sai → reject TOÀN BỘ effects (không partial apply).
- `INVALID_INPUT` — body sai shape (zod).
- `NO_CHARACTER` — chưa có nhân vật.

**Idempotency / atomicity**: toàn bộ effects apply trong cùng `prisma.$transaction`. `give_reward` qua `CurrencyService.applyTx(tx, charId, { linhThach?, tienNgoc?, exp? }, { reason: 'STORY_DIALOGUE_CHOICE', refType: 'StoryDialogueChoice', refId: '${nodeId}:${choiceKey}' })` — composite UNIQUE `(characterId, refType, refId)` chống double-grant nếu retry. `mark_seen` dedupe array client-side trong tx. `set_flag` overwrite key. KHÔNG WebSocket push (FE refetch state qua next `GET /character/state` trong handler).

## NPC Affinity — `NpcAffinityController` (prefix `/story/npc-affinity`, Phase 12.10.A + 12.10.B + 12.10.C + 12.10.D)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET    | `/story/npc-affinity` | Yes | List NPC affinities cho current character. Phase 12.10.A. |
| GET    | `/story/npc-affinity/:npcKey` | Yes | Single NPC affinity detail. Phase 12.10.A. |
| POST   | `/story/npc-affinity/:npcKey/gift` | Yes | Body `{ itemKey: string }`. Phase 12.10.B — tặng item, consume từ inventory, apply tier-aware affinity delta, daily limit. |
| GET    | `/story/npc-affinity/:npcKey/gift/daily` | Yes | Phase 12.10.B — daily gift count `{ used, limit, remaining }`. |
| GET    | `/story/npc-affinity/:npcKey/shop` | Yes | **Phase 12.10.C** — list NPC shop entries. Response `{ ok: true, data: { shop: { npcKey, npcName, currentScore, currentTier, entries: NpcShopEntryView[] } } }`. Mỗi `entries[i]`: `npcKey`, `itemKey`, `requiredAffinityTier`, `requiredTierLabel(En)`, `cost`, `currency` (`LINH_THACH` / `TIEN_NGOC`), `stockType` (`unlimited`/`daily`/`weekly`), `dailyLimit?`, `weeklyLimit?`, `unlockHint(En)`, embedded `item` snapshot, `currentTier`, `unlocked` (boolean: tier reached), `purchased` (count trong window), `remaining` (cap - purchased), `limitReached`. Window count đọc từ `ItemLedger` (`reason='NPC_SHOP_BUY'` + `refId='${npcKey}:${itemKey}'`) cho stock daily/weekly UTC bucket. Errors: 401 `UNAUTHENTICATED`, 404 `NO_CHARACTER`, 404 `NPC_AFFINITY_UNKNOWN`. |
| POST   | `/story/npc-affinity/:npcKey/shop/buy` | Yes | **Phase 12.10.C** — Body `{ itemKey: string, qty?: number }` (default `qty=1`). Atomic Prisma `$transaction`: (1) re-load NPC affinity row, (2) re-check `requiredAffinityTier` reached, (3) count purchased trong window từ `ItemLedger`, (4) verify `dailyLimit`/`weeklyLimit` chưa đạt, (5) `CurrencyService.applyTx` trừ cost (negative delta) reason `NPC_SHOP_BUY` refType `NpcAffinityShop` refId `${npcKey}:${itemKey}`, (6) `InventoryService.grantTx` grant item reason `NPC_SHOP_BUY` refType `NpcAffinityShop` refId `${npcKey}:${itemKey}`. Toàn bộ rollback nếu bất kỳ step fail. Response `{ ok: true, data: { shop, receipt: { characterId, npcKey, itemKey, qty, unitCost, totalCost, currency, purchased, remaining, stockType } } }`. Errors: 400 `INVALID_QTY` / `NON_STACKABLE_QTY_GT_1` / `INSUFFICIENT_FUNDS`, 403 `INSUFFICIENT_AFFINITY_TIER`, 404 `ITEM_NOT_IN_SHOP` / `NPC_AFFINITY_UNKNOWN` / `NO_CHARACTER`, 429 `DAILY_LIMIT_REACHED` / `WEEKLY_LIMIT_REACHED`. |
| GET    | `/story/npc-affinity/:npcKey/unlocks` | Yes | **Phase 12.10.C** — list combined hidden dialogue + quest unlocks gắn với NPC. Response `{ ok: true, data: { npcKey, currentTier, unlocks: NpcHiddenUnlockEntryView[] } }`. Mỗi entry: `kind` (`dialogue`/`quest`), `refKey` (story dialogue key hoặc quest key), `npcKey`, `requiredAffinityTier`, `requiredTierLabel(En)`, `unlockReason(En)`, `unlocked` (tier reached). Sort locked-first theo tier order, sau đó alpha. Errors: 401 `UNAUTHENTICATED`, 404 `NO_CHARACTER` / `NPC_AFFINITY_UNKNOWN`. |
| GET    | `/story/npc-affinity/:npcKey/quest-chain` | Yes | **Phase 12.10.D** — list relationship quest chains for NPC. Response `{ ok: true, data: { npcKey, chains: NpcRelationshipChainView[] } }`. Mỗi `chains[i]`: `chainKey`, `npcKey`, `npcName`, `title(En)`, `description(En)`, `requiredAffinityTier`, `requiredAffinityTierLabel(En)`, `requiredAffinityMinScore`, `tierUnlocked` (boolean: current tier ≥ required), `currentAffinityScore`, `currentAffinityTier`, `quests` (array of `{ questKey, questName, status, giverNpcKey, unlocked }` derived from `QuestProgress`), `claimedCount` / `totalCount`, `completable` (all quests CLAIMED), `claimed` (storyFlags `${chainKey}_claimed === '1'`), `claimedAt` (ISO timestamp parse từ flag), `hidden` (catalog flag), `visible` (`!hidden \|\| tierUnlocked`), `rewardPreview` (`affinity`, `linhThach`, `tienNgoc`, `exp`, `items`), `endingFlags` (catalog), `dialogueNodeKeys`. Errors: 401 `UNAUTHENTICATED`, 404 `NO_CHARACTER` / `NPC_AFFINITY_UNKNOWN`. |
| POST   | `/story/npc-affinity/:npcKey/quest-chain/:chainKey/claim` | Yes | **Phase 12.10.D** — atomic claim chain reward. `prisma.$transaction`: (1) verify chain catalog existence (`CHAIN_UNKNOWN`); (2) verify chain belongs to NPC param (`CHAIN_NPC_MISMATCH`); (3) verify player tier ≥ `requiredAffinityTier` (`CHAIN_LOCKED_TIER`); (4) verify ALL `chain.questKeys[]` have `QuestProgress.status='CLAIMED'` (`CHAIN_NOT_COMPLETABLE`); (5) JSON-path CAS guard via raw SQL `UPDATE "Character" SET "storyFlags"=...::jsonb WHERE id=$1 AND ("storyFlags" ->> $flagKey) IS DISTINCT FROM '1'` — race-safe; loser gets count===0 → `CHAIN_ALREADY_CLAIMED`; (6) grant reward inside same tx: `NpcAffinityService.addAffinityTx` cho affinity, `CurrencyService.applyTx` cho linhThach/tienNgoc/exp với reason `NPC_RELATIONSHIP_CHAIN_REWARD` refType `NpcRelationshipChain` refId `${chainKey}`, `InventoryService.grantTx` cho items với cùng reason. Idempotent — retry sau success luôn 409 `CHAIN_ALREADY_CLAIMED`, KHÔNG double-grant. Response `{ ok: true, data: { receipt: { chainKey, npcKey, granted: { affinity, linhThach, tienNgoc, exp, items[], flags }, newAffinityScore, newAffinityTier, claimedAt }, chain: NpcRelationshipChainView } }`. Errors: 400 `INVALID_INPUT` / `CHAIN_NPC_MISMATCH`, 403 `CHAIN_LOCKED_TIER`, 404 `CHAIN_UNKNOWN` / `NO_CHARACTER`, 409 `CHAIN_NOT_COMPLETABLE` / `CHAIN_ALREADY_CLAIMED`. |

**Atomicity (Phase 12.10.D claim)**: chain catalog là VIEW concept — không có DB entity riêng. State derive 100% từ `CharacterNpcAffinity.score` + `QuestProgress` + `Character.storyFlags`. Idempotency dùng raw-SQL JSON-path CAS thay vì Prisma `NOT { equals: '1' }` filter (filter Prisma không match row khi key absent vì jsonb `#>>` returns NULL → `NULL = '1'` is unknown). `IS DISTINCT FROM '1'` xử lý đúng cả absent + falsy values. Test integration verify race-safe: `Promise.allSettled([claim, claim])` → đúng 1 fulfilled + 1 rejected, exactly 1 ledger row.

**Atomicity (Phase 12.10.C buy)**: `prisma.$transaction` bọc cả 3 step (currency spend + inventory grant + 2 ledger row) — fail bất kỳ step nào rollback toàn bộ; không có nửa-state spend-without-grant. Cả `CurrencyLedger` và `ItemLedger` đều có index `(refType, refId)` để query window count nhanh — KHÔNG dùng composite UNIQUE vì player được phép mua nhiều lần. Daily/weekly limit chống "spam buy" check ngay trong transaction (count ledger row trong UTC bucket trước khi spend) — nếu đã đạt limit, throw `DAILY_LIMIT_REACHED`/`WEEKLY_LIMIT_REACHED` và transaction rollback.

## Admin LiveOps Controls — `AdminLiveOpsController` (Phase 13.1.B + Phase 13.1.C + Phase 13.1.D)

> Phase 13.1.B — admin override LiveOps event toggles + sect-war status/recalculate. Phase 13.1.C — sect-war read-after-audit snapshot + force-spawn boss (xem `POST /boss/admin/spawn` ở §Boss). Phase 13.1.D — schedule preview (read-only) + dry-run (event/boss giả lập, KHÔNG mutate). Mọi endpoint role `ADMIN`/`MOD` (`AdminGuard`); endpoint mutation đánh dấu `ADMIN-only` qua `@RequireAdmin()`.

| Method | Path                              | Auth  | Mô tả |
|--------|-----------------------------------|-------|-------|
| GET    | `/admin/liveops`                  | ADMIN/MOD | Status snapshot. Response `{ nowIso, timezone, eventsTotal, eventsActive, eventsToday, events: AdminLiveOpsEventStatus[], sectWar: AdminSectWarSummary }`. Mỗi `AdminLiveOpsEventStatus` gồm `{ key, type, titleI18nKey, scheduledEnabled (catalog default), overrideEnabled? (LiveOpsEventOverride.enabled nếu có), effectiveEnabled, lastOverrideAt? (ISO), lastOverrideBy? (User.email) }`. `AdminSectWarSummary` = `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek }`. |
| POST   | `/admin/liveops/event/toggle`     | ADMIN | `{ eventKey: string, enabled: boolean }`. Upsert `LiveOpsEventOverride(eventKey)` → `{ enabled, updatedAt, updatedBy: actorUserId }`. Audit log `ADMIN_LIVEOPS_OVERRIDE` (`{ actor, eventKey, enabled, prev: oldEnabled }`). Trả `{ eventKey, enabled, prev, overrideAt }`. |
| GET    | `/admin/sect-war/status`          | ADMIN/MOD | Read-only sect-war diagnostic. Response `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek, leaderboard[] (top N), claimsThisWeek }`. KHÔNG mutation. |
| POST   | `/admin/sect-war/recalculate`     | ADMIN | No-op điểm contribution (read-only audit response). Trả `{ weekKey, recalculatedAt: ISO, contributionsScanned, leaderboardSize, message: 'recalc_no_op' }`. KHÔNG sửa contribution rows hoặc claim rows hiện có. (Future: nếu thêm logic recompute, vẫn phải atomic + audit). |
| POST   | `/admin/sect-war/snapshot`        | ADMIN | **Phase 13.1.C** — read-after-audit snapshot. Body `{ weekKey?: 'YYYY-Www', reason?: string≤200 }` (weekKey thiếu → fallback computed week hiện tại). Service gọi `getSectWarStatus(weekKey)` rồi ghi 1 audit `ADMIN_SECT_WAR_STATUS` cùng `meta { targetType: 'SectWarWeek', targetId: weekKey, summary: { totalSects, totalContributors, totalContributions, topSectIds: string[≤3] }, reason: string\|null }`. `reason` trim; whitespace-only → `null`. **KHÔNG mutate** contribution rows hoặc claim rows. Response identical với `GET /admin/sect-war/status` cho `weekKey` đó. |
| GET    | `/admin/liveops/schedule-preview` | ADMIN/MOD | **Phase 13.1.D** — read-only snapshot. Response `{ tz, nowIso, activeEvents[], upcomingEvents[], bossScheduleToday[], bossScheduleWeek[], sectWar: { season, status }, overrides[] }`. `activeEvents` overlay `LiveOpsEventOverride` (chỉ event có `effectiveEnabled=true` tại `now`). `upcomingEvents` = top N slot (≤5 / event catalog) trong 7 ngày kế, kèm `catalogEnabled`/`effectiveEnabled`/`slotStartIso`/`slotEndIso`. `bossScheduleToday`/`bossScheduleWeek` (7 ngày) group theo `localDate`, status `upcoming`/`active`/`completed`. `sectWar.season` = `currentSectWarSeason(now)`, `sectWar.status` = `getSectWarStatus(weekKey)`. `overrides[]` = full `LiveOpsEventOverride` rows order by `updatedAt desc`. **KHÔNG mutate**, **KHÔNG audit**. |
| POST   | `/admin/liveops/dry-run`          | ADMIN | **Phase 13.1.D** — giả lập event/boss execution KHÔNG mutate. Body `{ kind: 'event'\|'boss', key: string≤80, regionKey?: string≤80, level?: 1..99, reason?: string≤200 }`. `kind='event'` → trả `{ kind:'event', key, type, titleI18nKey, descriptionI18nKey, catalogEnabled, effectiveEnabled, override (DB row hoặc null), nextSlotStartIso, nextSlotEndIso, regionKey?, bossKey?, simulated:true, reason: string\|null, simulatedAt: ISO }`. `kind='boss'` → trả `{ kind:'boss', bossKey, bossName, regionKey, level (clamp 1..99), simulatedMaxHp: bigint string, simulatedReward: { baseLinhThach, topDropPool[], midDropPool[], lowDropPool[] }, recommendedRealm, simulated:true, reason, simulatedAt }`. **KHÔNG ghi `LedgerEntry` / KHÔNG `prisma.worldBoss.create` / KHÔNG `LiveOpsEventOverride` upsert**; chỉ ghi 1 audit `ADMIN_LIVEOPS_DRY_RUN` với `meta { kind, targetType: 'LiveOpsEvent'\|'Boss', targetId: key, regionKey?, level?, reason: string\|null }`. |

**Admin LiveOps error codes**:
- `FORBIDDEN` — không phải ADMIN/MOD (qua `AdminGuard` chặn trước controller).
- `ADMIN_ONLY` — endpoint `@RequireAdmin()` (toggle/recalculate/snapshot/dry-run) bị MOD gọi.
- `EVENT_NOT_FOUND` — `eventKey` (toggle) hoặc `key` (dry-run kind=event) không có trong catalog `LIVE_OPS_EVENTS`.
- `BOSS_NOT_FOUND` — dry-run `kind='boss'` với `key` không có trong catalog boss (`bossByKey`).
- `INVALID_INPUT` — body sai shape (zod). Áp dụng cho `weekKey` không match `/^\d{4}-W\d{2}$/`, `reason > 200 char`, `eventKey/level/regionKey` invalid, `kind` không thuộc `{event,boss}`.

**Audit log entries (Phase 13.1.C + Phase 13.1.D)**:
- `ADMIN_LIVEOPS_OVERRIDE` — toggle event override (Phase 13.1.B).
- `ADMIN_FORCE_BOSS_SCHEDULE` — force-spawn boss qua `POST /boss/admin/spawn` (cùng meta với legacy `BOSS_SPAWN` audit row, kèm `reason` + optional `scheduledEventKey`). Backwards-compatible: consumers cũ vẫn đọc `BOSS_SPAWN`.
- `ADMIN_SECT_WAR_STATUS` — read-after-audit snapshot qua `POST /admin/sect-war/snapshot`.
- `ADMIN_LIVEOPS_DRY_RUN` — Phase 13.1.D dry-run (event hoặc boss). `meta` luôn có `kind`/`targetType`/`targetId`/`reason`; nếu `kind='boss'` kèm `regionKey`/`level`. Schedule preview (`GET /admin/liveops/schedule-preview`) **KHÔNG ghi audit** (read-only).

## Admin Economy Safety — `AdminEconomySafetyController` (Phase 16.6)

> Phase 16.6 Economy Anti-cheat Suite. Detection + reporting only — KHÔNG auto-ban / KHÔNG rollback / KHÔNG public notify. Tất cả endpoint gắn `@RequireAdmin()`; PLAYER + MOD đều bị reject 403 `ADMIN_ONLY`. Mọi POST ghi audit `AdminAuditLog` với `actorUserId` + `action` (`ADMIN_ECONOMY_LEDGER_CHECK_RUN` / `ADMIN_ECONOMY_LEDGER_ISSUE_ACK` / `ADMIN_ECONOMY_LEDGER_ISSUE_RESOLVE` / `ADMIN_ECONOMY_ANOMALY_SCAN_RUN` / `ADMIN_ECONOMY_ANOMALY_ACK` / `ADMIN_ECONOMY_ANOMALY_RESOLVE`) + meta cho BI/SIEM.

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST   | `/admin/economy/ledger-check/run` | ADMIN | Trigger thủ công LedgerChecker. Body `{ forceRerun?: boolean, dayBucket?: string }` (zod strict). Nếu `dayBucket` khuyết → derive từ `now` UTC. Idempotent qua `EconomyLedgerCheckRun.dayBucket` UNIQUE — gọi lại cùng ngày trả `{ alreadyDone: true, run }` trừ khi `forceRerun=true`. Response `LedgerCheckRunSummary { runId, dayBucket, status (OK\|ISSUES_FOUND\|FAILED), issuesCreated, alreadyDone, summary }`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `INVALID_INPUT`. |
| GET    | `/admin/economy/ledger-check/latest` | ADMIN | Latest run + danh sách issues của run đó. Response `{ run: EconomyLedgerCheckRun \| null, issues: EconomyLedgerCheckIssue[] }`. |
| GET    | `/admin/economy/ledger-check/issues?severity=&status=&type=&runId=&limit=` | ADMIN | List issues filter (defaults: severity all, status all, limit=50, max 200). Response `{ issues: EconomyLedgerCheckIssue[] }` order DESC theo `createdAt`. Filters validate qua `isEconomyAnomalySeverity` / `isEconomyIssueStatus`. |
| POST   | `/admin/economy/ledger-check/issues/:id/ack` | ADMIN | Set issue status → `ACKNOWLEDGED` (idempotent — gọi lại trả 200 không change). Audit `ADMIN_ECONOMY_LEDGER_ISSUE_ACK`. 404 `ISSUE_NOT_FOUND`. |
| POST   | `/admin/economy/ledger-check/issues/:id/resolve` | ADMIN | Set issue status → `RESOLVED`. Audit `ADMIN_ECONOMY_LEDGER_ISSUE_RESOLVE`. 404 `ISSUE_NOT_FOUND`. |
| POST   | `/admin/economy/anomalies/scan` | ADMIN | Trigger thủ công EconomyAnomalyScanner. Body `{ windowKey?: string, windowMs?: number }` (zod strict, `windowMs` cap 7 ngày). Idempotent qua `EconomyAnomaly @@unique([source, characterId, windowKey])`. Response `AnomalyScanSummary { windowKey, topCurrencyDelta, rareItemGain, rewardCapBypass, marketOutlier, totalAnomaliesCreated, totalAnomaliesSkipped }`. |
| GET    | `/admin/economy/anomalies?severity=&status=&source=&limit=` | ADMIN | List anomalies filter (limit default=50, max=200). Filters validate qua `isEconomyAnomalySeverity` / `isEconomyIssueStatus` / `isEconomyAnomalySource`. Response `{ anomalies: EconomyAnomaly[] }` DESC theo `createdAt`. |
| POST   | `/admin/economy/anomalies/:id/ack` | ADMIN | Set anomaly status → `ACKNOWLEDGED` (idempotent). Audit `ADMIN_ECONOMY_ANOMALY_ACK`. 404 `ANOMALY_NOT_FOUND`. |
| POST   | `/admin/economy/anomalies/:id/resolve` | ADMIN | Set anomaly status → `RESOLVED`. Audit `ADMIN_ECONOMY_ANOMALY_RESOLVE`. 404 `ANOMALY_NOT_FOUND`. |
| GET    | `/admin/economy/range-report?from=YYYY-MM-DD&to=YYYY-MM-DD` | ADMIN | **Phase 16.1.B** — Date-range economy report. `from` / `to` ISO YYYY-MM-DD optional (default = last 7 days inclusive today, UTC). Max range 31 ngày — vượt → 400 `RANGE_TOO_LARGE`. `from > to` → 400 `FROM_AFTER_TO`. Invalid format → 400 `INVALID_FROM` / `INVALID_TO`. Response `EconomyReportResponse { range: { from, to, days }, bySource: [{ source, inLinhThach, outLinhThach, netLinhThach, inTienNgoc, outTienNgoc, netTienNgoc, entryCount }], totalInLinhThach, totalOutLinhThach, totalNetLinhThach, totalInTienNgoc, totalOutTienNgoc, totalNetTienNgoc, topCharacterDelta: [{ characterId, characterName, userEmail, inLinhThach, outLinhThach, netLinhThach } x10], marketVolume, shopSpend, sectShopSpend, reforgeEnchantSpend, adminGrantTotal, topupTotal, liveOpsRewardTotal, dailyLoginRewardTotal, dungeonRewardTotal, bossRewardTotal, territoryRewardTotal, sectSeasonRewardTotal, anomalySummary: { openCount, acknowledgedCount, resolvedCount, latestSeverity, latestCreatedAt }, latestLedgerCheckRun: { id, dayBucket, status, startedAt, finishedAt } \| null, generatedAt }`. Audit `ADMIN_ECONOMY_REPORT_VIEW` với { from, to, days, totalInLinhThach, totalOutLinhThach, openAnomalies }. Anomaly summary lấy all-time (KHÔNG range-filter) để admin thấy hot anomalies. Source bucket: `MARKET, SHOP, SECT_SHOP, REFORGE_ENCHANT, ADMIN_GRANT, TOPUP, LIVEOPS_REWARD, DAILY_LOGIN, DUNGEON_REWARD, BOSS_REWARD, TERRITORY_REWARD, SECT_SEASON_REWARD, SECT_WAR_REWARD, MISSION_REWARD, QUEST_REWARD, GIFTCODE_REWARD, MAIL_REWARD, TRIBULATION_REWARD, STORY_REWARD, NPC_REWARD, ACHIEVEMENT_REWARD, COMBAT_LOOT, CULTIVATION, SKILL_SPEND, REFINE_SPEND, ALCHEMY_SPEND, GEM_SPEND, INITIAL, OTHER` (unknown reason fail-soft → OTHER). |

**Anomaly sources** (catalog `ECONOMY_ANOMALY_RULES`): `CURRENCY_DELTA_24H`, `RARE_ITEM_GAIN_24H`, `REWARD_CAP_BYPASS`, `ADMIN_GRANT_OVER_LIMIT`, `MARKET_OUTLIER`. Mỗi source có `warnThreshold` + `criticalThreshold` riêng (xem `BALANCE_MODEL.md` §18).

**Severity** (`EconomyAnomalySeverity`): `INFO` < `WARN` < `CRITICAL`. Status (`EconomyIssueStatus`): `OPEN` → `ACKNOWLEDGED` → `RESOLVED`.

**Real-time hook** — `AdminService.grantCurrency` tự gọi `EconomyAnomalyScannerService.scanAdminGrantOverLimit` khi delta vượt threshold (KHÔNG block grant — chỉ tạo anomaly). Anomaly hook fail-soft: lỗi scan KHÔNG lật ngược grant. Audit `adminId, targetCharacterId, delta, reason` (KHÔNG log secret).

**Admin Economy Safety error codes**: `ADMIN_ONLY`, `INVALID_INPUT`, `ISSUE_NOT_FOUND`, `ANOMALY_NOT_FOUND`.

## Admin Anti-cheat Gameplay — `AdminGameplayAntiCheatController` (Phase 16.3)

> Phase 16.3 Gameplay Anti-cheat Deep Detection. **Detection-only** — KHÔNG auto-ban / KHÔNG rollback / KHÔNG tự trừ EXP/item/đá / KHÔNG khoá tài khoản. Tách bảng `GameplayAnomaly` khỏi `EconomyAnomaly` (Phase 16.6) để admin filter sạch theo domain. Tất cả endpoint gắn `@RequireAdmin()`; PLAYER + MOD đều bị reject 403 `ADMIN_ONLY` + `@RateLimitPolicy('ADMIN_MUTATION')`. Mọi POST mutation ghi `AdminAuditLog` (`ADMIN_ANTICHEAT_GAMEPLAY_SCAN` / `ADMIN_ANTICHEAT_GAMEPLAY_ACK` / `ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE`).

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET    | `/admin/anticheat/gameplay/summary` | ADMIN | Dashboard cards. Response `{ openCount, openCriticalCount, openWarnCount, openInfoCount, totalCount, latestCreatedAt, latestResolvedAt }`. |
| POST   | `/admin/anticheat/gameplay/scan` | ADMIN | Trigger thủ công `GameplayAntiCheatService.scanAll`. Body `{ windowKey?: string (≤64ch), windowMs?: number (≤ 30 ngày) }` (zod strict). Default windowMs từ rule catalog (1h / 24h / 7d tuỳ type). Idempotent qua `GameplayAnomaly @@unique([type, characterId, windowKey])` — re-scan cùng window → count vào `totalSkipped`. Response `GameplayScanSummary { totalCreated, totalSkipped, totalErrored, byType: Record<GameplayAnomalyType, number>, windowKeysByType: Record<GameplayAnomalyType, string> }`. Fail-soft per-rule (1 rule fail KHÔNG phá rule khác). Audit `ADMIN_ANTICHEAT_GAMEPLAY_SCAN`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `INVALID_INPUT`. |
| GET    | `/admin/anticheat/gameplay/anomalies?severity=&status=&type=&source=&characterId=&from=&to=&limit=` | ADMIN | List anomalies filter (limit default=50, max 200, invalid filter bỏ qua). Validate qua `isGameplayAnomalySeverity` / `isGameplayAnomalyStatus` / `isGameplayAnomalyType` / `isGameplayAnomalySource`. Sort `severity DESC, createdAt DESC`. Response `{ items: AnomalyRowDto[], total, filters: { severities, statuses, types, sources } }`. `AnomalyRowDto = { id, type, severity, status, source, characterId?, userId?, windowKey, detailsJson, createdAt, updatedAt, acknowledgedAt?, acknowledgedByAdminId?, resolvedAt?, resolvedByAdminId?, resolutionNote? }`. |
| POST   | `/admin/anticheat/gameplay/anomalies/:id/ack` | ADMIN | Chuyển `OPEN → ACKNOWLEDGED` + set `acknowledgedAt` + `acknowledgedByAdminId`. Idempotent: row đã `ACKNOWLEDGED`/`RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_NOT_OPEN`. Audit `ADMIN_ANTICHEAT_GAMEPLAY_ACK`. |
| POST   | `/admin/anticheat/gameplay/anomalies/:id/resolve` | ADMIN | Chuyển `OPEN \| ACKNOWLEDGED → RESOLVED` + set `resolvedAt` + `resolvedByAdminId` + `resolutionNote` (optional, ≤1000ch). Idempotent: row đã `RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_RESOLVED`. Audit `ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE`. Body `{ note?: string (≤1000ch) }` zod strict. |

**Anomaly types** (catalog `GAMEPLAY_ANOMALY_RULES` ở `packages/shared/src/gameplay-anticheat.ts`): `EXP_GAIN_SPIKE`, `CURRENCY_GAIN_SPIKE`, `ITEM_GAIN_SPIKE`, `DUNGEON_REWARD_FARM`, `BOSS_REWARD_FARM`, `MISSION_REWARD_FARM`, `ARENA_REWARD_FARM`, `TERRITORY_REWARD_SPIKE`, `COMBAT_RESULT_MISMATCH` (reserved hook), `REWARD_CAP_BYPASS_ATTEMPT`. Threshold rationale: xem `BALANCE_MODEL.md` §11.27.

**Sources** (11): `CHARACTER`, `CURRENCY_LEDGER`, `ITEM_LEDGER`, `DUNGEON_RUN`, `BOSS`, `MISSION`, `ARENA`, `TERRITORY`, `COMBAT`, `REWARD_CAP`, `OTHER`.

**Severity** (`GameplayAnomalySeverity`): `INFO` < `WARN` < `CRITICAL`. Status (`GameplayAnomalyStatus`): `OPEN` → `ACKNOWLEDGED` → `RESOLVED`. Status transition idempotent (404 nếu sai trạng thái — admin không có nguy cơ ack ngược / resolve ngược).

**Detection-only invariants**: scan KHÔNG mutate `Character.linhThach` / `Character.expCurrent` / `InventoryItem.qty` / `User.bannedAt`. Test enforced ở `gameplay-anticheat.service.test.ts`. Mọi remediation player data (ban / refund / grant) phải qua endpoint admin có sẵn — KHÔNG có ở controller này.

**Privacy**: `detailsJson` đã sanitize ở caller — KHÔNG raw IP / token / cookie / refresh hash. Audit `AdminAuditLog` KHÔNG log secret.

**Admin Anti-cheat Gameplay error codes**: `ADMIN_ONLY`, `INVALID_INPUT`, `ANOMALY_NOT_FOUND_OR_NOT_OPEN`, `ANOMALY_NOT_FOUND_OR_RESOLVED`.

## Admin Market Trade Abuse — `AdminMarketAbuseController` (Phase 16.4)

> Phase 16.4 Market Trade Abuse Hardening. **Detection-first, guard-light** — KHÔNG block giao dịch / KHÔNG auto-cancel listing / KHÔNG auto-rollback trade / KHÔNG auto-refund / KHÔNG khoá tài khoản. Tách bảng `MarketTradeAnomaly` khỏi `EconomyAnomaly` (Phase 16.6) và `GameplayAnomaly` (Phase 16.3) để admin filter sạch theo domain. Tất cả endpoint gắn `@RequireAdmin()`; PLAYER + MOD đều bị reject 403 `ADMIN_ONLY` + `@RateLimitPolicy('ADMIN_MUTATION')`. Mọi POST mutation ghi `AdminAuditLog` (`ADMIN_MARKET_ABUSE_SCAN` / `ADMIN_MARKET_ABUSE_ACK` / `ADMIN_MARKET_ABUSE_RESOLVE`).

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET    | `/admin/market/abuse/summary` | ADMIN | Dashboard cards. Response `{ openCount, openCriticalCount, openWarnCount, openInfoCount, totalCount, latestCreatedAt, latestResolvedAt }`. |
| POST   | `/admin/market/abuse/scan` | ADMIN | Trigger thủ công `MarketTradeAbuseService.scanAll`. Body `{ windowKey?: string (≤64ch), windowMs?: number (≤ 30 ngày) }` (zod strict). Default windowMs từ rule catalog (1h / 24h / 7d tuỳ type). Idempotent qua `MarketTradeAnomaly @@unique([type, listingId, windowKey])` — re-scan cùng window → count vào `totalSkipped`. Response `MarketScanSummary { totalCreated, totalSkipped, totalErrored, rules: MarketRuleScanResult[], windowKeysByType: Record<MarketAbuseType, string>, scannedAt: string }`. `MarketRuleScanResult = { type, created, skipped, errored, errorMessage }`. Fail-soft per-rule. Audit `ADMIN_MARKET_ABUSE_SCAN`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `INVALID_INPUT`. |
| GET    | `/admin/market/abuse/anomalies?severity=&status=&type=&source=&sellerCharacterId=&buyerCharacterId=&itemKey=&from=&to=&limit=` | ADMIN | List anomalies filter (limit default=50, max 200, invalid filter bỏ qua). Validate qua `isMarketAbuseSeverity` / `isMarketAbuseStatus` / `isMarketAbuseType` / `isMarketAbuseSource`. Sort `severity DESC, createdAt DESC`. Response `{ items: AnomalyRowDto[], total, filters: { severities, statuses, types, sources } }`. `AnomalyRowDto = { id, type, severity, status, source, listingId?, sellerCharacterId?, buyerCharacterId?, itemKey?, quantity?, unitPrice?: string \| null (BigInt-as-string), referencePrice?: string \| null, deviationRatio?: number \| null, windowKey, detailsJson, createdAt, updatedAt, acknowledgedAt?, acknowledgedByAdminId?, resolvedAt?, resolvedByAdminId?, resolutionNote? }`. |
| POST   | `/admin/market/abuse/anomalies/:id/ack` | ADMIN | Chuyển `OPEN → ACKNOWLEDGED` + set `acknowledgedAt` + `acknowledgedByAdminId`. Idempotent: row đã `ACKNOWLEDGED`/`RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_NOT_OPEN`. Audit `ADMIN_MARKET_ABUSE_ACK`. |
| POST   | `/admin/market/abuse/anomalies/:id/resolve` | ADMIN | Chuyển `OPEN \| ACKNOWLEDGED → RESOLVED` + set `resolvedAt` + `resolvedByAdminId` + `resolutionNote` (optional, ≤1000ch). Idempotent: row đã `RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_RESOLVED`. Audit `ADMIN_MARKET_ABUSE_RESOLVE`. Body `{ note?: string (≤1000ch) }` zod strict. |

**Anomaly types** (catalog ở `packages/shared/src/market-trade-abuse.ts`): `PRICE_EXTREME_LOW`, `PRICE_EXTREME_HIGH`, `REPEATED_BUYER_SELLER_PAIR`, `LISTING_SPAM`, `MARKET_VOLUME_SPIKE`, `UNKNOWN_REFERENCE_PRICE` (INFO). Threshold rationale: xem `BALANCE_MODEL.md` §11.28.

**Anomaly sources**: `LISTING_CREATE` (hook real-time `MarketService.post()`), `LISTING_BUY` (hook real-time `MarketService.buy()`), `SCAN_BATCH` (admin scan), `OTHER` (fallback fail-soft cho unknown).

**Window key format** (`buildMarketAbuseWindowKey`): `1h:YYYY-MM-DDTHH` / `24h:YYYY-MM-DD` / `7d:YYYY-Www` (ISO-8601, UTC). Cho rule per-character per-window, `listingId=''` + windowKey scope hash.

**Detection-only invariants**: scan + hook KHÔNG mutate `Listing` / `MarketTrade` / `CurrencyLedger` / `ItemLedger` / `Character` / `User`. Test enforced ở `market-trade-abuse.service.test.ts`. Mọi remediation (cancel listing / refund / ban) phải qua endpoint admin có sẵn — KHÔNG có ở controller này. Listing post bị reject ngoài rarity band vẫn qua Phase 16.6 Price Band ở `MarketService.post()` (HTTP 409 `PRICE_TOO_LOW`/`PRICE_TOO_HIGH` — xem dưới).

**Privacy**: `detailsJson` đã sanitize ở caller — KHÔNG raw IP / token / cookie / refresh hash. Audit `AdminAuditLog` KHÔNG log secret.

**Admin Market Trade Abuse error codes**: `ADMIN_ONLY`, `INVALID_INPUT`, `ANOMALY_NOT_FOUND_OR_NOT_OPEN`, `ANOMALY_NOT_FOUND_OR_RESOLVED`.

## Market — Phase 16.6 Price Band reject codes

> Khi listing post (`POST /market/listings`) có `pricePerUnit` ngoài `getMarketPriceBandForItem(itemKey)` band → reject với 1 trong 2 code (HTTP 409 CONFLICT). Existing ACTIVE listings KHÔNG bị mutate (chỉ áp dụng listing mới).

- `PRICE_TOO_LOW` — `pricePerUnit < band.minPrice`. FE i18n key `market.errors.PRICE_TOO_LOW`.
- `PRICE_TOO_HIGH` — `pricePerUnit > band.maxPrice`. FE i18n key `market.errors.PRICE_TOO_HIGH`.

## Arena — `ArenaController` (prefix `/arena`, Phase 14.1.B)

> Phase 14.1.B Async Arena Foundation — PvP bất đồng bộ. Match resolve **synchronous trong cùng request POST** (KHÔNG queue/job) bằng `resolveCombatWithSnapshot` (Phase 14.1.A). Mỗi match lưu `attackerSnapshotJson` + `defenderSnapshotJson` + `seed` + `battleLogJson` → cùng snapshot+seed → cùng kết quả. **Auth + character required** mọi endpoint.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/arena/profile`                      | Yes  | Lazy-create + return `ArenaProfileSummary { characterId, characterName, rating, tier, wins, losses, draws, attacksToday, attacksRemaining, todayBucket, createdAt, updatedAt }`. Rating mặc định 1000. `attacksRemaining = -1` khi `ARENA_DAILY_LIMIT_PER_DAY=0` (unlimited). `tier = arenaRankTierFor(rating)` — Phase 14.1.B chỉ trả `'unranked'` (5 slot reserved cho 14.1.C). |
| GET    | `/arena/opponents?limit=N`            | Yes  | List `ArenaOpponentSummary[]` (mặc định 10, max 50). Filter rating ±200. Fallback random khi sparse. **Loại trừ self**. Field: `characterId, characterName, realmKey, realmStage, rating, tier, wins, losses, sectName?`. |
| POST   | `/arena/matches`                      | Yes  | Body zod strict `{ defenderCharacterId: string, seed?: number }`. Build attacker/defender `CombatActorSnapshot` từ DB row hiện tại → derive seed `hashSeed("arena-match:<matchId>")` (hoặc `seed` từ body cho test) → `resolveCombatWithSnapshot` → tx update `ArenaMatch` (RESOLVED) + cả 2 `ArenaProfile` (rating + W/L/D + `attacksToday++` cho attacker). Response `{ match: ArenaMatchResult }` với `outcome` (`ATTACKER_WIN` / `DEFENDER_WIN` / `DRAW`), `ratingDelta { attacker, defender }`, `attackerRatingAfter`, `defenderRatingAfter`, `totalAttackerDamage`, `totalDefenderDamage`, `rounds`, `battleLog[]` (max ~12 line ngắn). |
| GET    | `/arena/matches/history?limit=N&side=all\|attacker\|defender` | Yes  | List `ArenaMatchResult[]` DESC by `createdAt` cho character hiện tại. `side=all` (default) trả cả attacker + defender; `side=attacker` chỉ outgoing; `side=defender` chỉ incoming. Limit default 20, max 100. |

**Arena error codes** (catalog `ArenaErrorCode` ở `packages/shared/src/arena.ts`):
- `NO_CHARACTER` (HTTP 404) — caller chưa có nhân vật.
- `DEFENDER_NOT_FOUND` (HTTP 404) — `defenderCharacterId` không tồn tại.
- `CANNOT_ATTACK_SELF` (HTTP 400) — `defenderCharacterId === attacker.characterId`.
- `INVALID_INPUT` (HTTP 400) — body sai schema (zod).
- `DAILY_LIMIT_REACHED` (HTTP 429) — `attacksToday >= ARENA_DAILY_LIMIT_PER_DAY` (chỉ check khi limit > 0).

**Determinism guarantee** (Phase 14.1.B + 14.1.A): `attackerSnapshotJson + defenderSnapshotJson + seed` đủ để replay trận. Verification trong `apps/api/src/modules/arena/arena.service.test.ts` "same snapshots + seed → deterministic result" — load row → call `resolveCombatWithSnapshot` lần 2 → outcome + damage **bit-exact identical**. Snapshot snapshot tại thời điểm match created (defender stat lock-in), không re-fetch khi resolve.

**Daily limit** — env var `ARENA_DAILY_LIMIT_PER_DAY` (default `10`, `0`=unlimited). Day bucket theo `Asia/Ho_Chi_Minh` (server tz), reset 00:00 ICT. Server tự rollover `attacksToday=0` + update `lastAttackDayBucket` lazy ở `getOrCreateProfile`.

**Rating delta** (Phase 14.1.B placeholder, sẽ thay bằng ELO ở 14.1.C):
- `ATTACKER_WIN`: attacker `+10`, defender `-5` (clamp `[0, 5000]`).
- `DEFENDER_WIN`: attacker `-5`, defender `+10`.
- `DRAW`: cả 2 = 0.

**KHÔNG có** Phase 14.1.B: season cycle, end-season mail reward, anti-wintrade phức tạp (chỉ no-self + daily limit), realtime PvP, cross-server, ELO progression.

### Phase 14.1.C — Arena Season + ELO + Reward (extension)

> Mở rộng Phase 14.1.B thành PvP **season system** với ELO rating + per-season standing + leaderboard + reward mail. Lazy-create season tự động khi match đầu tiên trong tuần resolve, tránh chết UX. Idempotent settle qua `ArenaSeasonRewardGrant @@unique([seasonId, characterId])`.

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | `/arena/season/current` | Yes | Lazy-create + return current ACTIVE `ArenaSeasonView { seasonKey, status, startsAtIso, endsAtIso, settledAtIso?, cadence: 'weekly', timezone: 'Asia/Ho_Chi_Minh' }`. Season key format `arena_<ISO_year>-W<ISO_week>`. |
| GET | `/arena/leaderboard?seasonKey?&limit?&offset?` | Yes | Paginated leaderboard order `rating DESC, wins DESC, losses ASC, characterId ASC`. Response `ArenaLeaderboardView { seasonKey, total, entries: [{ rank, characterId, characterName, rating, tier, wins, losses, sectName? }] }`. Default limit 20, max 100. |
| GET | `/arena/season/standing?seasonKey?` | Yes | Current character standing với rank live (count rows xếp trên + 1). Returns `ArenaMyStandingView { seasonKey, characterId, rating, tier, wins, losses, rank? }` hoặc `null` nếu chưa có standing. |
| GET | `/arena/season/rewards?seasonKey?` | Yes | Reward preview 5 tier (BRONZE/SILVER/GOLD/DIAMOND/IMMORTAL): `ArenaSeasonRewardPreviewView { seasonKey, tiers: [{ tier, reward: { linhThach, tienNgoc, exp, items[] }, labelI18nKey, descriptionI18nKey }] }`. |
| POST | `/admin/arena/season/settle` | ADMIN | Body `{ seasonKey?: string }` (default: current ACTIVE). Chốt rank, tính tier, tạo `ArenaSeasonRewardGrant` (UNIQUE), gửi mail reward. **Idempotent** — gọi lại không tạo grant trùng + không gửi mail trùng (UNIQUE constraint + check existing grant). Set `season.status = SETTLED`, `settledAt = now()`. |
| POST | `/admin/arena/season/create-next` | ADMIN | Tạo `ArenaSeason` row tuần kế tiếp (key format `arena_<ISO_year>-W<ISO_week+1>`). Idempotent qua `seasonKey @unique`. |

**Season FSM**: `ACTIVE` → `SETTLED` (admin settle) → `ARCHIVED` (manual / future cron). Tại 1 thời điểm chỉ có **1 ACTIVE** season.

**ELO formula** (`packages/shared/src/arena-season.ts`):

```
K = 32
expectedA = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
deltaA    = round(K * (scoreA - expectedA))   // win=1, draw=0.5, lose=0
defenderDelta = round(deltaA * -1 * 0.6)       // 60% scale
```

Tại rating bằng nhau (1000 vs 1000), `ATTACKER_WIN` ⇒ attacker `+16`, defender `-10` (sau scale + round). Floor `0`, ceiling `5000` (`clampArenaRating`).

**Tier breakpoints** (`arenaSeasonTierFor(rating)`):

| Tier | Rating range |
|------|--------------|
| BRONZE   | 0..999 |
| SILVER   | 1000..1199 |
| GOLD     | 1200..1499 |
| DIAMOND  | 1500..1799 |
| IMMORTAL | 1800+ |

**Reward table** (modest — không phá economy):

| Tier | Linh Thạch | Tiên Ngọc | Items |
|------|-----------:|----------:|-------|
| BRONZE   | 200  | — | — |
| SILVER   | 500  | — | huyet_chi_dan ×5 |
| GOLD     | 1000 | — | huyet_chi_dan ×10 |
| DIAMOND  | 2000 | 20 | linh_lo_dan ×5 |
| IMMORTAL | 5000 | 50 | linh_lo_dan ×10 |

**Existing `POST /arena/matches`** (Phase 14.1.B): mở rộng để cập nhật `ArenaStanding` của cả attacker + defender trong cùng TX với match resolve (lazy-create season + standing nếu chưa có). `ratingDelta` trong response giờ tính theo ELO formula (KHÔNG break shape — vẫn 2 field `attacker` / `defender`).

**Error codes Phase 14.1.C**: `SEASON_FETCH_FAILED`, `STANDING_FETCH_FAILED`, `LEADERBOARD_FETCH_FAILED`, `REWARDS_FETCH_FAILED` (FE fallback codes); admin endpoints throw `INVALID_SEASON_KEY` (HTTP 400) / `SEASON_NOT_FOUND` (HTTP 404). Player endpoints inherit Phase 14.1.B error catalog.

**KHÔNG có** Phase 14.1.C: cross-server leaderboard, anti-wintrade detection (defer 14.1.D), realtime PvP, battle pass, season-end title/cosmetic reward.

### Phase 14.1.D — Arena Anti-Wintrade Detection (admin)

> Detection-only anti-cheat layer trên Arena. Phát hiện 5 pattern bất thường, tạo `ArenaWintradeAlert` cho admin review thủ công. **KHÔNG** auto-ban, **KHÔNG** auto-rollback reward, **KHÔNG** xóa match. `ArenaService.createMatch` chain `quickCheckPair()` post-commit (fire-and-forget, fail-soft) cho lightweight detection. Full multi-rule scan force qua admin endpoint.

**Detection rules** (`packages/shared/src/arena-anti-wintrade.ts` → `ARENA_ANTI_WINTRADE_RULES`, override qua env `ARENA_ANTI_WINTRADE_*`):

| Type | Window | WARN | CRITICAL |
|---|---|---|---|
| `REPEATED_OPPONENT_PAIR` | 24h rolling | ≥ 5 trận cùng directional pair attacker→defender | ≥ 12 |
| `RECIPROCAL_WIN_LOSS` | 24h rolling | ≥ 4 swap A→B win + B→A win (sort lex pair key) | ≥ 8 |
| `RATING_GAIN_SPIKE` | 6h rolling | Δrating ≥ 200 | ≥ 400 |
| `REWARD_FARM_PATTERN` | 24h rolling | attacker ≥ 8 trận, distinct opponents < 3 | distinct opponents ≤ 1 |
| `SEASON_SUSPICIOUS_ACTOR` | 24h rolling (TODO upgrade season scope) | ≥ 12 trận, win-rate ≥ 0.95, opponents < 5 | distinct opponents ≤ 1 |

Severity ladder `INFO < WARN < CRITICAL`. Status flow `OPEN → ACKNOWLEDGED → RESOLVED` (admin tay). Idempotency qua composite UNIQUE `(type, windowKey, attackerCharacterId, defenderCharacterId)` — chạy lại trên cùng cửa sổ → P2002 → `alertsSkippedDuplicate`.

| Method | Path                                                   | Role  | Body / Notes |
|--------|--------------------------------------------------------|-------|--------------|
| POST   | `/admin/arena/anti-wintrade/scan`                      | ADMIN | Body `{ periodKeyOverride?: string }`. Chạy `scanAll()` (5 rules), trả `AntiWintradeScanSummary { scannedMatches, alertsCreated, alertsSkippedDuplicate, criticalCount, warningCount, infoCount }`. Audit `ADMIN_ARENA_WINTRADE_SCAN_RUN`. |
| GET    | `/admin/arena/anti-wintrade/alerts?severity&status&type&seasonId&limit` | ADMIN | List alerts DESC by `createdAt`. Filter validation lỏng (severity/status/type không hợp lệ → ignored). Default limit 50, max 200. Response `{ items: ArenaWintradeAlertRow[], total }`. |
| POST   | `/admin/arena/anti-wintrade/alerts/:id/ack`            | ADMIN | `OPEN → ACKNOWLEDGED`. 404 nếu alert đã `RESOLVED` hoặc không tồn tại. Audit `ADMIN_ARENA_WINTRADE_ALERT_ACK`. |
| POST   | `/admin/arena/anti-wintrade/alerts/:id/resolve`        | ADMIN | `OPEN \| ACKNOWLEDGED → RESOLVED`. 404 nếu đã `RESOLVED` hoặc không tồn tại. Audit `ADMIN_ARENA_WINTRADE_ALERT_RESOLVE`. |

Tất cả route guard `@RequireAdmin()` — PLAYER + MOD reject 403. POST log `AdminAuditLog`.

**KHÔNG có** Phase 14.1.D: auto-ban, auto-rollback reward, auto-delete match, block player on WARN, cron auto-scan (env reserved `ARENA_ANTI_WINTRADE_CRON_*`).

## Admin LiveOps Event Scheduler — `AdminLiveOpsEventsController` (Phase 15.1–15.2)

Server-authoritative CRUD + status machine + cron recompute cho event runtime
(không cần deploy code khi vận hành sự kiện). Khác `AdminLiveOpsController`
(override catalog `LIVE_OPS_EVENTS` tĩnh), endpoint này quản event row động
fully-defined-in-DB với 7 type:

```
LIVEOPS_EVENT_TYPES = [
  'DOUBLE_DUNGEON_DROP',     // cap 2.0  — wired ở DungeonRunService.claimRun
  'CULTIVATION_EXP_BOOST',   // cap 2.0  — wired ở CultivationProcessor.process
  'SHOP_DISCOUNT',           // cap 0.5  — TODO Phase 15.3+
  'SECT_SHOP_DISCOUNT',      // cap 0.5  — TODO Phase 15.3+
  'DAILY_LOGIN_BONUS',       // cap 2.0  — TODO Phase 15.3+
  'BOSS_REWARD_BOOST',       // cap 2.0  — TODO Phase 15.3+
  'FESTIVAL_GIFT'            // claim 1× — TODO Phase 15.3+ (LiveOpsEventRewardClaim)
]
```

| Method | Path | Role | Mô tả |
| --- | --- | --- | --- |
| GET    | `/admin/liveops/events`                              | ADMIN | List all events ordered theo `(status asc, startsAt asc)`. |
| POST   | `/admin/liveops/events`                              | ADMIN | Tạo event mới. Body `{ key, type, title, description?, startsAt, endsAt, configJson?: { multiplier?, rewardJson? }, initialStatus?: 'DRAFT' \| 'SCHEDULED' }` (zod `.strict()`). Validate cap multiplier + window + key pattern qua shared `validateLiveOpsScheduledEventInput`. 409 `EVENT_KEY_DUPLICATE` nếu key đã tồn tại. Audit `ADMIN_LIVEOPS_EVENT_CREATE`. |
| PATCH  | `/admin/liveops/events/:id`                          | ADMIN | Update title/description/startsAt/endsAt/configJson/status. Status chỉ chấp nhận `DRAFT \| SCHEDULED \| DISABLED` — `ACTIVE`/`ENDED` reject (phải qua cron để tránh inconsistent). Audit `ADMIN_LIVEOPS_EVENT_UPDATE`. |
| POST   | `/admin/liveops/events/:id/disable`                  | ADMIN | Kill switch — set `status=DISABLED`, không tự recover. Audit `ADMIN_LIVEOPS_EVENT_DISABLE`. |
| POST   | `/admin/liveops/events/recompute-status`             | ADMIN | Force-run cron logic: SCHEDULED→ACTIVE / ACTIVE→ENDED dựa trên `now`. Idempotent — gọi nhiều lần cùng `now` count=0 sau lần đầu. Audit `ADMIN_LIVEOPS_EVENT_RECOMPUTE` với `{ scannedAt, toActivated, toEnded }`. Phase 15.3.B: nếu có status transition, broadcast WS `liveops:event` (`LIVEOPS_EVENT_ACTIVE`/`LIVEOPS_EVENT_ENDED`) — fail-safe, không block transition. |
| GET    | `/admin/liveops/announcements`                       | ADMIN | (Phase 15.3.B) List all announcements ordered theo `startsAt desc`. |
| POST   | `/admin/liveops/announcements`                       | ADMIN | (Phase 15.3.B) Tạo announcement. Body `{ key, severity: 'INFO'\|'EVENT'\|'WARNING'\|'MAINTENANCE', target: 'ALL'\|'AUTHENTICATED'\|'ADMIN_ONLY', titleVi, titleEn?, messageVi, messageEn?, startsAt, endsAt, initialStatus?: 'DRAFT'\|'SCHEDULED' }`. Validate qua shared `validateLiveOpsAnnouncementInput` (cap title 120 / message 500, vi/en parity, HTML/script reject, `startsAt < endsAt`). 409 `ANNOUNCEMENT_KEY_DUPLICATE`. Audit `ADMIN_LIVEOPS_ANNOUNCEMENT_CREATE`. |
| PATCH  | `/admin/liveops/announcements/:id`                   | ADMIN | (Phase 15.3.B) Update fields. Status chỉ chấp nhận `DRAFT\|SCHEDULED` — `ACTIVE/ENDED/DISABLED` reject (phải qua cron). Audit `ADMIN_LIVEOPS_ANNOUNCEMENT_UPDATE`. |
| POST   | `/admin/liveops/announcements/:id/disable`           | ADMIN | (Phase 15.3.B) Kill switch — `status=DISABLED`, không tự recover. Audit `ADMIN_LIVEOPS_ANNOUNCEMENT_DISABLE`. |
| POST   | `/admin/liveops/announcements/recompute-status`      | ADMIN | (Phase 15.3.B) Force-run cron: SCHEDULED→ACTIVE / ACTIVE→ENDED. Idempotent. Broadcast WS `liveops:announcement` khi và chỉ khi status thật transition. Audit `ADMIN_LIVEOPS_ANNOUNCEMENT_RECOMPUTE`. |

**Cron auto-recompute**: BullMQ repeatable job `recompute-status` chạy
`*/5 * * * *` (UTC default, override `LIVEOPS_EVENT_SCHEDULER_CRON_TZ`).
Disabled by default — bật qua env `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true`.
Race-safe multi-instance: Redis lease `xt:liveops-event-scheduler:recompute`
(60s TTL) + DB-level `updateMany` CAS guard.

**Error codes**: `EVENT_NOT_FOUND` (404), `EVENT_KEY_DUPLICATE` (409),
`EVENT_KEY_INVALID`, `EVENT_TITLE_INVALID`, `EVENT_TYPE_INVALID`,
`EVENT_WINDOW_INVALID`, `EVENT_MULTIPLIER_INVALID`,
`EVENT_MULTIPLIER_OVER_CAP`, `INVALID_INPUT` — tất cả 400 (trừ
`EVENT_NOT_FOUND` 404 và `EVENT_KEY_DUPLICATE` 409). **Phase 15.3.A**
thêm `EVENT_REWARD_JSON_REQUIRED`, `EVENT_REWARD_JSON_INVALID`,
`EVENT_REWARD_ITEM_INVALID`, `EVENT_REWARD_QTY_INVALID`,
`EVENT_REWARD_CURRENCY_INVALID`, `EVENT_REWARD_EMPTY`,
`EVENT_REWARD_OVER_CAP` (400) cho FESTIVAL_GIFT reward config validate.

### Public LiveOps Events (Phase 15.3.A)

| Method | Path | Role | Mô tả |
| --- | --- | --- | --- |
| GET    | `/liveops/events/active` | Auth (player) | List active LiveOps events public-safe (KHÔNG leak `createdByAdminId` / DB id). Mỗi entry: `{ key, type, title, description, startsAt, endsAt, publicConfig: { multiplier: number \| null, reward: LiveOpsEventReward \| null }, claimable, runtimeSupported }`. `claimable=true` chỉ khi `type='FESTIVAL_GIFT'` + character chưa từng claim. `runtimeSupported` chỉ là FE hint (BE vẫn validate). Fail-soft KHÔNG bắt buộc — FE client `getActiveLiveOpsEvents()` tự return `[]` khi network error. |
| POST   | `/liveops/events/:eventKey/claim` | Auth (player) | Claim FESTIVAL_GIFT one-time. Server (atomic `$transaction`): (1) load event by `key` → 404 `EVENT_NOT_FOUND` nếu không tồn tại; (2) reject `EVENT_NOT_CLAIMABLE` nếu `type!='FESTIVAL_GIFT'`; (3) reject `EVENT_NOT_ACTIVE` nếu `status!='ACTIVE'`; (4) reject `EVENT_REWARD_EMPTY/OVER_CAP/...` nếu reward config invalid (defense-in-depth qua `validateLiveOpsEventRewardJson`); (5) insert `LiveOpsEventRewardClaim { eventId, characterId, rewardJson, claimedAt }` — UNIQUE `(eventId, characterId)` → P2002 → 409 `EVENT_ALREADY_CLAIMED`; (6) grant CurrencyLedger (linhThach/tienNgoc với reason `LIVEOPS_EVENT_FESTIVAL_GIFT`) + ItemLedger (per-item nếu có). Outcome `{ ok: true, data: { eventKey, claimedAt: string, granted: LiveOpsEventReward } }`. **Idempotent**: retry sau success → 409 `EVENT_ALREADY_CLAIMED`, KHÔNG double reward. **Caps**: linhThach ≤ 1000, tienNgoc ≤ 50, items ≤ 10 entries × qty ≤ 50 (validated server-side). |

**Runtime modifier integration (Phase 15.3.A)** — KHÔNG có endpoint riêng;
modifier áp tự động trong các flow gameplay:

- **`SHOP_DISCOUNT`** (≤ 0.5): `POST /shop/buy` áp `finalPrice = ceil(originalPrice × (1 − mul))`, ledger ghi `finalPrice` thực chi.
- **`SECT_SHOP_DISCOUNT`** (≤ 0.5): tương tự cho cost contribution + linh thạch sect shop.
- **`DAILY_LOGIN_BONUS`** (≤ 2.0): `POST /daily-login/claim` áp multiplier sau Daily Reward Cap.
- **`BOSS_REWARD_BOOST`** (≤ 2.0): boss reward distribution áp multiplier per attribution rank, mail metadata ghi `liveOpsBoostMultiplier` + `liveOpsEventKey`.

Compose policy max-only — nhiều event cùng type ACTIVE → chọn multiplier
tốt nhất, KHÔNG stack. Fail-soft: nếu LiveOps service unavailable, runtime
trả `1.0` (no boost) hoặc `0` (no discount) — KHÔNG block player flow.

## Feature Flags — `FeatureFlagPublicController` + `AdminFeatureFlagController` (Phase 15.4)

Hệ Feature Flag DB-backed cho phép admin bật/tắt nhanh các hệ thống lõi
mà không cần deploy. Catalog 11 flag hardcoded ở
`packages/shared/src/feature-flags.ts` (5 category: `GAMEPLAY`, `ECONOMY`,
`LIVEOPS`, `ADMIN`, `SAFETY`). Cache 2-tier (L1 in-memory TTL 30s, L2
Redis TTL 30s) — Redis fail-soft. Server-authoritative: gate chính qua
runtime `assertFeatureEnabled(key)` trả `503 FEATURE_DISABLED`.

### Public

- `GET /feature-flags/public` — anonymous-safe, trả whitelist (chỉ flag
  FE cần biết để ẩn UI). Payload `{ ok, data: { flags: [{ key, enabled }] } }`.
  Whitelist hiện tại: `ARENA_ENABLED`, `TRIBULATION_MINI_BATTLE_ENABLED`,
  `EQUIPMENT_REFORGE_ENABLED`, `EQUIPMENT_ENCHANT_ENABLED`,
  `LIVEOPS_EVENTS_ENABLED`, `LIVEOPS_ANNOUNCEMENTS_ENABLED`,
  `MARKET_ENABLED`. KHÔNG trả flag SAFETY/ADMIN.

### Admin (`RequireAdmin()`)

- `GET /admin/feature-flags` — full list catalog với DB row state. Payload
  per flag: `{ key, enabled, category, descriptionVi, descriptionEn,
  public, requiresRestart, module, defaultEnabled, updatedByAdminId,
  updatedAt }`. Flag chưa có DB row → trả default catalog state.
- `PATCH /admin/feature-flags/:key` — body `{ enabled: boolean }`. Reject
  `FEATURE_FLAG_KEY_INVALID` nếu key không có trong catalog. Audit
  `ADMIN_FEATURE_FLAG_UPDATE` (diff old→new). Clear cache L1+L2 ngay.
- `POST /admin/feature-flags/refresh-defaults` — idempotent seed: tạo DB
  row cho mọi flag chưa tồn tại, không touch flag đã có. Trả `{ created,
  existing }`. Audit `ADMIN_FEATURE_FLAG_REFRESH_DEFAULTS`.
- `POST /admin/feature-flags/clear-cache` — flush L1+L2 ngay. Trả `{
  cleared: true }`. Audit `ADMIN_FEATURE_FLAG_CLEAR_CACHE`.

### Runtime gates đã wire

| Flag | Module | Behavior khi off |
|---|---|---|
| `ARENA_ENABLED` | `arena` | `POST /arena/matches` 503; FE banner + disable challenge |
| `TRIBULATION_MINI_BATTLE_ENABLED` | `character/tribulation` | Mini-battle start 503 |
| `EQUIPMENT_REFORGE_ENABLED` | `character/equipment` | `POST /character/equipment/reforge` 503 |
| `EQUIPMENT_ENCHANT_ENABLED` | `character/equipment` | `POST /character/equipment/enchant` 503 |
| `EQUIPMENT_MERGE_ENABLED` | `character/equipment-economy` | `POST /character/equipment/merge` 503 (Phase 23.4) |
| `EQUIPMENT_DISMANTLE_ENABLED` | `character/equipment-economy` | `POST /character/equipment/dismantle` 503 (Phase 23.4) |
| `LIVEOPS_EVENTS_ENABLED` | `liveops-event-scheduler` | Runtime modifier (boost/discount) không apply |
| `LIVEOPS_FESTIVAL_GIFT_ENABLED` | `liveops-event-scheduler` | `POST /liveops/events/:key/claim` 503 |
| `LIVEOPS_ANNOUNCEMENTS_ENABLED` | `liveops-announcement` | Public list trả empty + WS broadcast disabled |
| `TERRITORY_WAR_ENABLED` | `territory` | Weekly war engagement 503 |
| `MARKET_ENABLED` | `market` | Create listing + buy 503; list read-only vẫn OK |
| `SHOP_DISCOUNT_EVENTS_ENABLED` | `shop` | Shop discount LiveOps modifier không apply |
| `SECT_SHOP_DISCOUNT_EVENTS_ENABLED` | `sect-shop` | Sect Shop discount LiveOps modifier không apply |

### Error codes — Phase 15.4

- `FEATURE_DISABLED` (503) — runtime gate; payload `{ flag: <key> }`.
- `FEATURE_FLAG_KEY_INVALID` (400) — admin update key không trong catalog.

## Maintenance Windows — `MaintenanceWindowPublicController` + `AdminMaintenanceWindowController` (Phase 15.5)

Hệ Maintenance Window cho phép admin lập lịch + bật/tắt khẩn cấp bảo trì.
Middleware `MaintenanceWindowGuardMiddleware` chạy trước Nest pipeline:
khi maintenance ACTIVE và user không phải admin (hoặc target =
`FULL_LOCKDOWN`), trả `503` `MAINTENANCE_ACTIVE` kèm payload
`{ severity, target, titleVi/En, messageVi/En, endsAt, serverTime }` để FE
render overlay. Cache L1 in-memory TTL 10s; recompute SCHEDULED→ACTIVE /
ACTIVE→ENDED chạy idempotent từ `LiveOpsEventSchedulerCronProcessor` mỗi
5 phút (reuse).

### Public — không yêu cầu auth

- `GET /maintenance/status` — trả `MaintenanceWindowPublicView` shape
  `{ active, severity, target, titleVi, titleEn, messageVi, messageEn,
  startsAt, endsAt, serverTime, allowAdminBypass }`. Không leak
  `id`/`createdByAdminId`/`disabledAt`/`allowHealthcheck`/`allowMetrics`.
  Endpoint luôn được phép truy cập kể cả khi maintenance ACTIVE.

### Admin — `ADMIN` only

- `GET /admin/maintenance-windows` — trả `{ windows: MaintenanceWindowAdminView[] }` (full metadata).
- `POST /admin/maintenance-windows` — body strict whitelist:
  `{ key, severity, target, titleVi, titleEn?, messageVi, messageEn?,
  startsAt, endsAt, allowAdminBypass?, allowHealthcheck?, allowMetrics?,
  initialStatus? }`. Audit `ADMIN_MAINTENANCE_CREATE`.
- `PATCH /admin/maintenance-windows/:id` — partial update; chỉ cho
  status `DRAFT`/`SCHEDULED` (block update khi đã ACTIVE/ENDED/DISABLED).
  Audit `ADMIN_MAINTENANCE_UPDATE`.
- `POST /admin/maintenance-windows/:id/disable` — set `status=DISABLED` +
  `disabledAt=now`; idempotent. Audit `ADMIN_MAINTENANCE_DISABLE`.
- `POST /admin/maintenance-windows/recompute-status` — chạy recompute on
  demand, trả `{ scannedAt, activatedKeys, endedKeys }`. Idempotent.
  Audit `ADMIN_MAINTENANCE_RECOMPUTE`.

### Bypass rules (middleware)

Khi không có window ACTIVE → middleware không block. Khi có ACTIVE:

1. Path `/maintenance/status` luôn cho qua.
2. Path `/health*` cho qua nếu `allowHealthcheck=true`.
3. Path `/metrics*` cho qua nếu `allowMetrics=true`.
4. Path `/_auth/*` cho qua (admin vẫn login được; player block sau khi
   resolve role bằng cookie).
5. Role `ADMIN`/`MOD` cho qua nếu `allowAdminBypass=true` và
   `target ≠ FULL_LOCKDOWN`.
6. Target `API_WRITE_ONLY` chỉ block method ≠ `GET`/`HEAD`.
7. Target `NON_ADMIN_USERS` block player + anonymous nhưng cho admin.
8. Target `ALL_PLAYERS` block player; admin vẫn pass nếu allowAdminBypass.
9. Mặc định block (fail-closed) khi role không xác định và không match
   bypass nào.

### Phase 15.8 — WebSocket broadcast `MAINTENANCE_STATUS`

Phase 15.8 thêm realtime broadcast khi `MaintenanceWindowService.recomputeStatus` thấy `effectiveStatus` THẬT SỰ đổi (`SCHEDULED → ACTIVE`, `ACTIVE → ENDED`, hoặc any → `DISABLED`).

- Channel: `maintenance:status`
- Event type: `MAINTENANCE_STATUS`
- Payload (public-safe, không leak admin metadata):

```ts
{
  type: 'MAINTENANCE_STATUS',
  channel: 'maintenance:status',
  payload: {
    status: 'ACTIVE' | 'ENDED' | 'DISABLED' | 'SCHEDULED' | 'NONE',
    severity: 'INFO' | 'WARNING' | 'CRITICAL' | null,
    target: 'ALL_PLAYERS' | 'NON_ADMIN_USERS' | 'API_WRITE_ONLY' | 'FULL_LOCKDOWN' | null,
    titleVi: string | null,
    titleEn: string | null,
    messageVi: string | null,
    messageEn: string | null,
    startsAt: string | null,    // ISO
    endsAt: string | null,      // ISO
    serverTime: string,         // ISO
  }
}
```

KHÔNG bao gồm: `id`, `createdByAdminId`, `disabledAt`, `allowAdminBypass`, `allowHealthcheck`, `allowMetrics`, audit trail metadata. Broadcast no-op khi recompute KHÔNG đổi status. Broadcast fail (Redis down, WS handler throw) KHÔNG rollback DB transition — fallback poll 30s + axios 503 interceptor vẫn hoạt động.

Phase 15.8 cũng grow `PATCH /admin/maintenance-windows/:id`: thêm body field `confirm?: boolean` — yêu cầu `true` khi update tạo combo nguy hiểm (admin tự khóa: `allowAdminBypass=false` + target `FULL_LOCKDOWN`/`ALL_PLAYERS`). Không có `confirm` → 400 `MAINTENANCE_UPDATE_DANGEROUS_REQUIRES_CONFIRM`. Mỗi update tạo `ConfigVersion` row (artifactKey `maintenance-window:<id>`).

### Error codes — Phase 15.5

- `MAINTENANCE_ACTIVE` (503) — middleware block; payload meta như trên.
- `MAINTENANCE_KEY_DUPLICATE` (409) — admin create trùng key.
- `MAINTENANCE_NOT_FOUND` (404) — admin update/disable id không tồn tại.
- `MAINTENANCE_INVALID_STATUS_TRANSITION` (400) — admin update khi
  status đã ACTIVE/ENDED/DISABLED.
- `MAINTENANCE_KEY_INVALID` / `MAINTENANCE_WINDOW_INVALID` /
  `MAINTENANCE_WINDOW_TOO_SHORT` / `MAINTENANCE_WINDOW_TOO_LONG` /
  `MAINTENANCE_TITLE_REQUIRED` / `MAINTENANCE_TITLE_TOO_LONG` /
  `MAINTENANCE_TITLE_UNSAFE` / `MAINTENANCE_MESSAGE_REQUIRED` /
  `MAINTENANCE_MESSAGE_TOO_LONG` / `MAINTENANCE_MESSAGE_UNSAFE` /
  `MAINTENANCE_LOCALE_PARITY` / `MAINTENANCE_SEVERITY_INVALID` /
  `MAINTENANCE_TARGET_INVALID` (400) — validator shared reject input
  không hợp lệ.

## Config Version & Rollback — `AdminConfigVersionController` (Phase 15.6)

Hệ versioning + rollback an toàn cho 4 entity vận hành: `LIVEOPS_EVENT` / `LIVEOPS_ANNOUNCEMENT` / `FEATURE_FLAG` / `MAINTENANCE_WINDOW`. Mỗi mutation admin (CREATE / UPDATE / DISABLE / ENABLE / STATUS_RECOMPUTE) ghi `ConfigVersion` snapshot. Rollback có 3 mức safety: `SAFE` (apply 1 confirm), `NEED_CONFIRM` (yêu cầu phrase do server trả), `BLOCKED` (server reject).

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET    | `/admin/config-versions?entityType=&entityId=&limit=` | ADMIN | List version newest-first. Audit `ADMIN_CONFIG_VERSION_VIEW`. |
| GET    | `/admin/config-versions/:id` | ADMIN | Get 1 version row. |
| GET    | `/admin/config-versions/diff?fromVersionId=&toVersionId=` | ADMIN | Diff JSON 2 version (`changedFields`, `diff` per-field before/after). |
| POST   | `/admin/config-versions/:id/dry-run-rollback` | ADMIN | Tính safety + warnings, không apply. Body `{ reason? }`. Audit `ADMIN_CONFIG_ROLLBACK_DRY_RUN`. |
| POST   | `/admin/config-versions/:id/rollback` | ADMIN | Apply rollback. Body `{ reason?, confirmPhrase? }`. SAFE: 200; NEED_CONFIRM: 409 nếu thiếu phrase; BLOCKED: 409 + audit `ADMIN_CONFIG_ROLLBACK_BLOCKED`. Khi success: tạo `ConfigVersion` mới (`action=ROLLBACK`) + audit `ADMIN_CONFIG_ROLLBACK`. |

### Lỗi (Phase 15.6)

- `CONFIG_VERSION_NOT_FOUND` (404), `CONFIG_VERSION_INVALID_ENTITY_TYPE` / `INVALID_INPUT` (400).
- `CONFIG_ROLLBACK_TARGET_IS_LATEST` (400) — target đã là phiên bản mới nhất, không cần rollback.
- `CONFIG_ROLLBACK_TARGET_INVALID` (400) — version target không thuộc entity.
- `CONFIG_ROLLBACK_BLOCKED` (409) — safety level BLOCKED (vd LIVEOPS_EVENT đổi reward sau khi đã có claim).
- `CONFIG_ROLLBACK_CONFIRM_REQUIRED` (409) — NEED_CONFIRM nhưng body thiếu `confirmPhrase`.
- `CONFIG_ROLLBACK_CONFIRM_MISMATCH` (409) — `confirmPhrase` không khớp server-issued phrase.
- `CONFIG_ROLLBACK_APPLY_FAILED` (409) — apply failed mid-transaction; thay đổi đã rollback nguyên tử.

## Admin Security — `AdminSecurityController` (Phase 18.1)

> Phase 18.1 Security Rate Limit + Abuse Protection. Defense-in-depth detection + temporary block (5-30 phút theo severity). **KHÔNG** auto-ban vĩnh viễn / **KHÔNG** CAPTCHA / **KHÔNG** thay WAF/CDN. Tất cả endpoint gắn `@UseGuards(AdminGuard)` (ADMIN + MOD đều pass theo convention hiện hành, nhưng `liftBlock` thêm `@RequireAdmin()` → MOD reject 403 `ADMIN_ONLY`). Audit `AdminAuditLog` với action `ADMIN_SECURITY_EVENTS_VIEW` / `ADMIN_SECURITY_BLOCKS_VIEW` / `ADMIN_SECURITY_BLOCK_LIFT` / `ADMIN_SECURITY_BLOCK_LIFT_FAILED` + meta đã sanitize.

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET    | `/admin/security/rate-limit/status?policy=&scope=&subject=` | ADMIN/MOD | Peek current rate-limit counter cho 1 subject — **KHÔNG** tăng counter. `policy` ∈ `RATE_LIMIT_POLICY_KEYS` (vượt → 400 `INVALID_POLICY`). `scope` ∈ `IP`/`USER`/`CHARACTER`/`IP_USER` (default `IP_USER`). `subject` ≤ 256 ký tự (raw IP / userId / characterId; với scope `IP` server tự hash bằng `IpHashService` trước khi peek). Response `{ ok: true, data: { policy, scope, count, remaining, resetAt } }`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| GET    | `/admin/security/events?from=&to=&severity=&type=&limit=&cursor=` | ADMIN/MOD | List `SecurityEvent` row mới nhất, paginated. `severity` ∈ `INFO`/`WARN`/`CRITICAL`. `type` ∈ `RATE_LIMIT_VIOLATION`/`LOGIN_FAILED`/`REGISTER_SPAM`/`INVALID_TOKEN`/`ADMIN_FORBIDDEN`/`IP_BLOCKED`/`USER_BLOCKED`/`BLOCK_LIFTED`. `from`/`to` ISO date (invalid → bị bỏ qua). `limit` default 50 / max 200. `cursor` = id của row cuối lần trước (Prisma cursor pagination). Response `{ ok: true, data: { events: [{ id, type, severity, ipHash, userId, characterId, policy, detailJson, createdAt }] } }`. **Raw IP KHÔNG bao giờ trả về** — chỉ `ipHash` (sha256 với salt). Audit `ADMIN_SECURITY_EVENTS_VIEW`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| GET    | `/admin/security/blocks?type=&limit=&cursor=` | ADMIN/MOD | List **active** `SecurityBlock` (chưa lift + chưa hết hạn). `type` ∈ `IP`/`USER`. `limit` default 50 / max 200. Response `{ ok: true, data: { blocks: [{ id, type, subjectHash, reason, expiresAt, createdAt }] } }`. Audit `ADMIN_SECURITY_BLOCKS_VIEW`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| POST   | `/admin/security/blocks/:id/lift` | **ADMIN-only** | Lift 1 block (admin override). Idempotent: nếu block không tồn tại / đã lift → 404 `BLOCK_NOT_FOUND` + audit `ADMIN_SECURITY_BLOCK_LIFT_FAILED`. Khi success: `liftedAt = now()` + `liftedById = req.userId` + audit `ADMIN_SECURITY_BLOCK_LIFT` với `{ blockId, type, subjectHash, reason }`. Response `{ ok: true, data: { block: { id, type, subjectHash, reason } } }`. `@RequireAdmin()` → MOD reject 403 `ADMIN_ONLY`. Rate-limit: `ADMIN_MUTATION`. |
| GET    | `/admin/security/policies` | ADMIN/MOD | Static catalog dump (no DB hit). Response `{ ok: true, data: { keys: [...RATE_LIMIT_POLICY_KEYS] } }`. Dùng để FE Admin Security Panel autocomplete policy filter. Rate-limit: `ADMIN_REPORT_VIEW`. |
| GET    | `/admin/security/sessions?userId=&status=&limit=&cursor=` | ADMIN/MOD | **Phase 18.2** — list `UserSession` row, paginate. `userId` exact match (≤128 ký tự). `status` ∈ `ACTIVE`/`REVOKED`/`EXPIRED`/`ALL` (default `ALL`, invalid → 400 `INVALID_STATUS`). `limit` default 50 / max 200. `cursor` = id row cuối lần trước. Response `{ ok: true, data: { sessions: UserSessionSummary[], nextCursor, generatedAt } }`. Audit `ADMIN_SECURITY_SESSIONS_VIEW` 1 row / call. KHÔNG bao giờ trả `hashedToken`/`jti`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| POST   | `/admin/security/sessions/:id/revoke` | **ADMIN-only** | **Phase 18.2** — revoke 1 `UserSession`. Idempotent. Reason `ADMIN_REVOKE`, `revokedById = req.userId`. Audit `ADMIN_SECURITY_SESSION_REVOKE` (success) hoặc `ADMIN_SECURITY_SESSION_REVOKE_FAILED` (404 `SESSION_NOT_FOUND`). `@RequireAdmin()` — MOD reject 403 `ADMIN_ONLY`. Cascade revoke tất cả `RefreshToken` con + emit `SecurityEvent` `SESSION_REVOKED`. Rate-limit: `ADMIN_MUTATION`. |
| GET    | `/admin/security/alerts?status=&severity=&type=&source=&from=&to=&userId=&limit=&cursor=` | ADMIN/MOD | **Phase 18.3** — list `SecurityAlert` row mới nhất (sort `createdAt desc`), Prisma cursor pagination. `status` ∈ `OPEN`/`ACKNOWLEDGED`/`RESOLVED`. `severity` ∈ `INFO`/`WARN`/`CRITICAL`. `type` ∈ `RATE_LIMIT_ABUSE`/`LOGIN_ABUSE`/`INVALID_TOKEN`/`ADMIN_FORBIDDEN`/`SUBJECT_BLOCKED`/`BLOCK_LIFTED`/`SESSION_CREATED`/`SESSION_REVOKED`/`REFRESH_TOKEN_REUSED`/`SESSION_SUSPICIOUS`/`OTHER`. `source` ∈ `RATE_LIMIT`/`AUTH`/`SESSION`/`ADMIN`/`BLOCK`/`OTHER`. `from`/`to` ISO date. `userId` exact match (≤128). `limit` default 50 / max 200. Response `{ ok: true, data: { alerts: [{ id, type, severity, status, source, eventId, relatedUserId, relatedCharacterId, relatedSessionId, detailsJson, createdAt, acknowledgedAt, acknowledgedByAdminId, resolvedAt, resolvedByAdminId, resolutionNote }], nextCursor, generatedAt } }`. Invalid filter → 400 `INVALID_STATUS`/`INVALID_SEVERITY`/`INVALID_TYPE`/`INVALID_SOURCE`/`INVALID_USER_ID`. Audit `ADMIN_SECURITY_ALERTS_VIEW`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| GET    | `/admin/security/summary` | ADMIN/MOD | **Phase 18.3** — dashboard summary cho `SecurityAlertPanel`. Response `{ ok: true, data: { openCritical, openWarn, blockedSubjects, tokenReuseLast24h, suspiciousSessionsLast24h, rateLimitHitsLast24h, latestCriticalEvents: [{ id, type, severity, createdAt }], generatedAt } }`. **Mỗi count fail-soft riêng** — 1 query lỗi → count = 0, không kéo cả summary fail. Audit `ADMIN_SECURITY_SUMMARY_VIEW`. Rate-limit: `ADMIN_REPORT_VIEW`. |
| POST   | `/admin/security/alerts/:id/ack` | **ADMIN-only** | **Phase 18.3** — acknowledge 1 alert. Idempotent: alert đã `ACKNOWLEDGED` → no-op trả row hiện tại. Reject `ALERT_NOT_FOUND` (404), `ALERT_ALREADY_RESOLVED` (409). Khi success: set `status = ACKNOWLEDGED`, `acknowledgedAt = now()`, `acknowledgedByAdminId = req.userId`. Response `{ ok: true, data: { alert } }`. Audit `ADMIN_SECURITY_ALERT_ACK` / `_FAILED`. `@RequireAdmin()` → MOD reject 403 `ADMIN_ONLY`. Rate-limit: `ADMIN_MUTATION`. |
| POST   | `/admin/security/alerts/:id/resolve` body `{ note: string }` | **ADMIN-only** | **Phase 18.3** — resolve 1 alert với note bắt buộc. Sanitize note (strip control char, max 1000 char). Reject `INVALID_NOTE` (400) nếu rỗng sau sanitize, `ALERT_NOT_FOUND` (404), `ALERT_ALREADY_RESOLVED` (409). Skip-ack path: alert `OPEN` → `RESOLVED` trực tiếp cũng set `acknowledgedAt` đồng thời cho consistency. Set `status = RESOLVED`, `resolvedAt = now()`, `resolvedByAdminId = req.userId`, `resolutionNote = sanitized`. Response `{ ok: true, data: { alert } }`. Audit `ADMIN_SECURITY_ALERT_RESOLVE` / `_FAILED`. `@RequireAdmin()` → MOD reject 403 `ADMIN_ONLY`. Rate-limit: `ADMIN_MUTATION`. |

### Rate limit response headers (Phase 18.1)

Mọi response của route có `@RateLimitPolicy(...)` đều set:

- `X-RateLimit-Limit`: `policy.maxRequests`.
- `X-RateLimit-Remaining`: `max(0, maxRequests - count)`.
- `X-RateLimit-Reset`: epoch seconds khi window hiện tại reset.
- `Retry-After` (chỉ khi 429): số giây client nên đợi (= `windowSec` nếu rate-limited, = `expiresAt - now` nếu bị abuse-block).

### 429 payload (Phase 18.1)

Response body chuẩn `{ ok: false, error: { code, message, ...meta } }`:

- `RATE_LIMITED` — vượt rate-limit policy. Meta: `{ policy, retryAfterSec, resetAt }`.
- `ABUSE_BLOCKED` — subject đang bị `SecurityBlock` active. Meta: `{ retryAfterSec, expiresAt }`. KHÔNG leak `reason` hoặc `subjectHash` ra public (chỉ admin xem qua `GET /admin/security/blocks`).

### Bypass route (Phase 18.1)

Các route gắn `@SkipRateLimit()` không bao giờ bị 429 dù spam — dành cho monitoring + system health:

- `GET /healthz`, `GET /readyz`, `GET /version`, `GET /admin/metrics` (Phase 17.5).
- `GET /liveops/events/public` (public read polled high-frequency).

### Sensitive endpoint wire (Phase 18.1)

Các route đã wire `@RateLimitPolicy(...)`:

| Endpoint | Policy key | Scope | Window / max |
|---|---|---|---|
| `POST /_auth/login` | `AUTH_LOGIN` | `IP_USER` | 10 / 15p, block 15p khi vượt threshold + login-failed 10/15p → block 30p |
| `POST /_auth/register` | `AUTH_REGISTER` | `IP` | 5 / 15p, block 30p |
| `POST /_auth/refresh` | `AUTH_REFRESH` | `IP_USER` | 30 / 60s, block 5p |
| `POST /shop/buy` | `SHOP_BUY` | `USER` | 30 / 60s, block 10p |
| `POST /sect/shop/buy` | `SECT_SHOP_BUY` | `USER` | 20 / 60s, block 10p |
| `POST /market/listings` | `MARKET_CREATE_LISTING` | `CHARACTER` | 10 / 60s, block 10p |
| `POST /market/listings/:id/buy` | `MARKET_BUY` | `CHARACTER` | 30 / 60s, block 10p |
| `POST /daily-login/claim` | `DAILY_LOGIN_CLAIM` | `USER` | 5 / 60s, block 10p |
| `POST /dungeon-run/:id/claim` | `DUNGEON_CLAIM` | `CHARACTER` | 20 / 60s, block 10p |
| `POST /liveops/events/:key/claim-gift` | `LIVEOPS_GIFT_CLAIM` | `USER` | 15 / 60s, block 10p |
| `POST /topup/orders` | `TOPUP_CREATE_ORDER` | `USER` | 10 / 60min, block 60min |
| `POST /admin/...` (mutation) | `ADMIN_MUTATION` | `USER` | 60 / 60s, block 5p |
| `GET /admin/...` (report view) | `ADMIN_REPORT_VIEW` | `USER` | 120 / 60s, **no block** |

Source-of-truth: <ref_file file="packages/shared/src/security-rate-limit.ts" />.

## Error codes (chuẩn hoá)

- **Auth**: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `ABUSE_BLOCKED`, `PASSWORD_CHANGED`, `REUSED_REFRESH_TOKEN`, `BANNED`, `INVALID_INPUT`.
- **Character**: `NO_CHARACTER`, `NAME_TAKEN`, `ALREADY_ONBOARDED`, `NOT_ENOUGH_EXP`, `NOT_AT_PEAK`, `NOT_IN_CULTIVATION`, `NOT_FOUND`.
- **Combat**: `IN_COMBAT`, `NO_ENCOUNTER`, `ENCOUNTER_NOT_ACTIVE`.
- **Market**: `ITEM_NOT_FOUND`, `NOT_OWNER`, `NOT_ENOUGH_FUNDS`, `LISTING_SOLD`.
- **Sect**: `ALREADY_IN_SECT`, `NOT_IN_SECT`, `NOT_ENOUGH_FUNDS`.
- **Sect War**: `SECT_REQUIRED`, `SECT_WAR_NOT_CLAIMABLE`, `SECT_WAR_ALREADY_CLAIMED`, `SECT_WAR_NO_REWARD`, `NO_CHARACTER`.
- **Arena (Phase 14.1.B)**: `NO_CHARACTER`, `DEFENDER_NOT_FOUND`, `CANNOT_ATTACK_SELF`, `INVALID_INPUT`, `DAILY_LIMIT_REACHED`.
- **Arena Season (Phase 14.1.C)**: `INVALID_SEASON_KEY` (admin 400), `SEASON_NOT_FOUND` (admin 404). FE fallback codes: `SEASON_FETCH_FAILED`, `STANDING_FETCH_FAILED`, `LEADERBOARD_FETCH_FAILED`, `REWARDS_FETCH_FAILED`.
- **Boss**: `NO_ACTIVE_BOSS`, `BOSS_DEAD`, `COOLDOWN`.
- **Topup/Admin**: `TOO_MANY_PENDING`, `ALREADY_PROCESSED`, `FORBIDDEN`, `NOT_FOUND`.
- **Giftcode**: `CODE_NOT_FOUND`, `CODE_EXPIRED`, `CODE_REVOKED`, `CODE_EXHAUSTED`, `ALREADY_REDEEMED`, `CODE_EXISTS` (admin create — PR #84), `NO_CHARACTER`, `INVALID_INPUT`.
- **Mail**: `MAIL_NOT_FOUND`, `MAIL_EXPIRED`, `MAIL_ALREADY_CLAIMED`, `MAIL_NO_REWARD`, `NO_CHARACTER`.
- **Mission**: `MISSION_NOT_FOUND`, `MISSION_ALREADY_CLAIMED`, `MISSION_NOT_READY`.
- **Daily login**: `NO_CHARACTER`.
- **Shop**: `ITEM_NOT_FOUND`, `NOT_ENOUGH_FUNDS`, `INVALID_INPUT`.
- **Logs (M6)**: `NO_CHARACTER`, `INVALID_CURSOR`, `INVALID_INPUT`.
- **Story Dialogue (Phase 12 Story PR-7)**: `NPC_NOT_FOUND`, `STORY_DIALOGUE_NOT_AVAILABLE`, `NODE_NOT_FOUND`, `CHOICE_NOT_FOUND`, `CHOICE_LOCKED`, `CHOICE_ALREADY_APPLIED`, `QUEST_STEP_LOCKED`, `INVALID_INPUT`, `NO_CHARACTER`.
- **Feature Flag (Phase 15.4)**: `FEATURE_DISABLED` (503 runtime gate, payload include `flag` key), `FEATURE_FLAG_KEY_INVALID` (admin update key không trong catalog).
- **Maintenance Window (Phase 15.5)**: `MAINTENANCE_ACTIVE` (503 middleware gate, payload include `severity/target/titleVi/En/messageVi/En/endsAt/serverTime`), `MAINTENANCE_KEY_DUPLICATE` (409), `MAINTENANCE_NOT_FOUND` (404), `MAINTENANCE_INVALID_STATUS_TRANSITION` (400), `MAINTENANCE_KEY_INVALID` / `MAINTENANCE_WINDOW_INVALID` / `MAINTENANCE_WINDOW_TOO_SHORT` / `MAINTENANCE_WINDOW_TOO_LONG` / `MAINTENANCE_TITLE_REQUIRED` / `MAINTENANCE_TITLE_TOO_LONG` / `MAINTENANCE_TITLE_UNSAFE` / `MAINTENANCE_MESSAGE_REQUIRED` / `MAINTENANCE_MESSAGE_TOO_LONG` / `MAINTENANCE_MESSAGE_UNSAFE` / `MAINTENANCE_LOCALE_PARITY` / `MAINTENANCE_SEVERITY_INVALID` / `MAINTENANCE_TARGET_INVALID` (400).
- **Config Version (Phase 15.6)**: `CONFIG_VERSION_NOT_FOUND` (404), `CONFIG_VERSION_INVALID_ENTITY_TYPE` (400). `CONFIG_ROLLBACK_TARGET_IS_LATEST` / `CONFIG_ROLLBACK_TARGET_INVALID` (400). `CONFIG_ROLLBACK_BLOCKED` / `CONFIG_ROLLBACK_CONFIRM_REQUIRED` / `CONFIG_ROLLBACK_CONFIRM_MISMATCH` / `CONFIG_ROLLBACK_APPLY_FAILED` (409).
- **Admin Backup (Phase 17.2)**: `ADMIN_ONLY` (403), `BACKUP_RUN_FAILED` (500, payload include `errorMessage` truncated 2048ch), `BACKUP_VERIFY_FAILED` (500, payload include `errorMessage`).

## Admin Backup — `AdminBackupController` (prefix `/admin/backup`, Phase 17.2)

Tracking + manual trigger layer trên 3 script shell `backup-db.sh`/`restore-db.sh`/`verify-restore.sh`. **KHÔNG có endpoint restore** — destructive ops vẫn manual theo `docs/RUNBOOK.md` §2.10.

Tất cả endpoint:
- Yêu cầu `@UseGuards(AdminGuard)` + `@RequireAdmin()` — PLAYER/MOD bị reject 403 `ADMIN_ONLY`.
- Rate-limit policy `ADMIN_MUTATION` (Phase 18.1).
- Mutation ghi `AdminAuditLog` (action `ADMIN_BACKUP_RUN` hoặc `ADMIN_BACKUP_VERIFY`).

| Method | Path | Mô tả |
|---|---|---|
| GET | `/admin/backup/status` | Snapshot 2 cron health + latest `BackupRun` + latest `BackupVerifyRun`. Read-only (KHÔNG audit). |
| POST | `/admin/backup/run` | Manual trigger backup. Spawn `scripts/backup-db.sh` qua `child_process.spawn` args-array. Trả `BackupRunSummary`. |
| POST | `/admin/backup/verify` | Manual trigger verify-restore. Spawn `scripts/verify-restore.sh`. Body optional `{ backupRunId? }` để link verify với BackupRun cụ thể. Trả `BackupVerifyRunSummary`. |

**Response shape** `GET /admin/backup/status`:
```jsonc
{
  "ok": true,
  "data": {
    "backup": {
      "enabled": true,
      "status": "OK",                // OK | STALE | DEGRADED | DISABLED
      "staleReason": null,            // string | null khi STALE/DEGRADED
      "lastRunAt": "2026-05-04T03:00:00Z",
      "lastSuccessAt": "2026-05-04T03:00:00Z",
      "lastErrorAt": null,
      "cronExpression": "0 3 * * 0",
      "timezone": "Asia/Ho_Chi_Minh",
      "maxSilenceMs": 691200000        // 8 ngày
    },
    "verify": { /* same shape */ },
    "latestBackup": {
      "id": "br-...",
      "status": "SUCCESS",
      "startedAt": "...",
      "finishedAt": "...",
      "fileName": "xuantoi-20260504-030000.sql.gz",
      "fileSizeBytes": 12345678,
      "checksumSha256": null,           // reserved cho phase sau
      "storage": "LOCAL",                // LOCAL | S3 | MINIO | GCS (S3/MINIO/GCS reserved Phase 17.3)
      "errorMessage": null,
      "triggeredBy": "CRON"              // CRON | ADMIN | MANUAL | CI
    },
    "latestVerify": {
      "id": "vr-...",
      "backupRunId": "br-...",          // optional FK link
      "status": "SUCCESS",
      "startedAt": "...",
      "finishedAt": "...",
      "checkedTables": 12,
      "latestMigration": "20260628000000_phase_17_2_backup_run",
      "errorMessage": null,
      "triggeredBy": "CRON"
    },
    "generatedAt": "2026-05-04T05:00:00Z"
  }
}
```

**Health mapping** (BE → FE badge):

| BE `status` | Khi nào | FE badge |
|---|---|---|
| `OK` | enabled + last success < 8 ngày + KHÔNG error fresher hơn success | `OK` (green) |
| `STALE` | enabled + last success > 8 ngày | `STALE` (amber) |
| `DEGRADED` | enabled + last error fresher hơn last success | `FAILED` (rose) |
| `DISABLED` | `BACKUP_CRON_ENABLED=false` hoặc `BACKUP_VERIFY_CRON_ENABLED=false` | `DISABLED` (grey) |

**Env toggle** (xem chi tiết ở `docs/DEPLOY.md` §9.2 + `docs/BACKUP_RESTORE.md` §Phase 17.2):
- `BACKUP_CRON_ENABLED` (default `false`)
- `BACKUP_VERIFY_CRON_ENABLED` (default `false`)
- `BACKUP_CRON_SCHEDULE` (default `0 3 * * 0`)
- `BACKUP_VERIFY_CRON_SCHEDULE` (default `0 4 * * 0`)
- `BACKUP_CRON_TIMEZONE` (default `Asia/Ho_Chi_Minh`)
- `BACKUP_DIR` (default `./backups`)
- `BACKUP_RETENTION_DAYS` (default `0`)

## Environment

Xem `.env.example`. Production khởi chạy sẽ assert `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 ký tự; nếu thiếu sẽ refuse start. Các biến quan trọng:
- `MISSION_RESET_TZ` — timezone reset mission/daily login (default `Asia/Ho_Chi_Minh`).
- `ARENA_DAILY_LIMIT_PER_DAY` (Phase 14.1.B) — số trận attack tối đa/ngày/character (default `10`, `0`=unlimited). Day bucket theo `Asia/Ho_Chi_Minh`.
- `MARKET_FEE_PCT` — phí thị trường (number 0..100).
- `ADMIN_BOOTSTRAP_*` — script `pnpm bootstrap:admin` để tạo admin đầu tiên.
