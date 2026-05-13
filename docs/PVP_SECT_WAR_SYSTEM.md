# PvP, Arena, Sect War & Spirit Vein Territory System

> Phase 29.0–29.3 — PR #560. Tài liệu này mô tả foundation layer cho mọi
> mode PvP (DUEL/FRIENDLY_SPARRING/EVENT_PVP/SECT_WAR/TERRITORY_WAR) +
> Arena (đã có sẵn từ Phase 14.1.B/C, chỉ tái sử dụng layer) + Sect War +
> Linh Mạch Territory. PR1 (Phase 29.0) ship Foundation V1 — Arena/Sect
> War/Territory tiếp tục PR sau (29.1 / 29.2 / 29.3).

---

## 1. Tổng quan

5 core design rule (spec PHẦN 1):
1. **Không cướp đồ trực tiếp** ở giai đoạn đầu — tránh làm người mới nản.
2. PvP **phải chia league/bracket** theo lực chiến, cảnh giới và cấp tông môn.
3. **Thưởng cạnh tranh thiên về danh vọng, cống hiến, tiện ích** và vật phẩm có cap — KHÔNG endgame item vô hạn.
4. Mọi trận PvP phải có **battle snapshot, replay/log, chống gian lận**.
5. Admin **vận hành được mùa giải, lịch chiến, bật/tắt, khóa thưởng,
   chốt ranking, rollback thưởng lỗi** mà KHÔNG cần sửa code.

### 1.1 Forbidden gate (spec PHẦN 20)

- KHÔNG làm cướp đồ người chơi.
- KHÔNG làm full real-time PvP phức tạp.
- KHÔNG làm liên server nếu chưa có hạ tầng.
- KHÔNG bán thắng trực tiếp bằng nạp.
- KHÔNG cho VIP bỏ PvP cap.
- KHÔNG cho reward endgame vô hạn.
- KHÔNG cho top tông môn chiếm toàn bộ map.
- KHÔNG tắt test.
- KHÔNG phá combat hiện có.
- KHÔNG bypass ledger/cap.

---

## 2. Shared layer — `packages/shared/src/pvp.ts`

### 2.1 Enums

| Enum | Values |
|---|---|
| `PvpMode` | `ARENA` (separate), `DUEL`, `FRIENDLY_SPARRING`, `EVENT_PVP`, `SECT_WAR`, `TERRITORY_WAR` |
| `PvpStatus` | `PENDING`, `RESOLVED`, `INVALIDATED` |
| `PvpResult` | `ATTACKER_WIN`, `DEFENDER_WIN`, `DRAW`, `FORFEIT` |
| `PvpSnapshotType` | `ATTACKER`, `DEFENDER` |
| `PvpAnomalyType` | 8 type — power jump, damage outlier, rating gain outlier, target farming, sect war score outlier, territory duplicate claim, season reward double claim, roster swap exploit |

### 2.2 Snapshot

```typescript
export interface PvpBattleSnapshot {
  characterId: number;
  realmOrder: number;
  totalPower: number;
  // optional rich fields
  characterKey?: string;
  displayName?: string;
  realmKey?: string;
  realmStage?: number;
  level?: number;
  stats?: Readonly<Record<string, number>>;
  // power breakdown
  basePower?: number;
  artifactPower?: number;
  // ...
  snapshotType: PvpSnapshotType;
  createdAt: string;
}
```

**Invariant**: snapshot **immutable** tại queue time. Khi player swap
equipment giữa challenge → resolve, snapshot **KHÔNG đổi** → anti-cheat.

### 2.3 Balance Policy

`PVP_DEFAULT_BALANCE_POLICY`:

| Field | Default | Mô tả |
|---|---|---|
| `maxDailyChallenge` | 12 | Free challenge / ngày |
| `maxDailyPaidChallenge` | 6 | Paid extra (Tiên Ngọc) |
| `sameTargetCooldownMinutes` | 60 | Cooldown khiêu chiến lại cùng target |
| `powerGapWarningThreshold` | 1.5 | Cảnh báo UI |
| `powerGapMatchBlockThreshold` | 3.0 | **Block matchmaking** (cả 2 chiều — top chặn farm newbie, newbie chặn challenge top) |
| `maxArenaTokenPerDay` | 100 | Cap token Arena |
| `maxSeasonRewardTierDelta` | 1 | Delta giữa player tier vs reward tier mùa |
| `forbiddenRewardItemKeys` | `FORBIDDEN_REWARD_ITEM_KEYS ∪ ADMIN_FORBIDDEN_GRANT_ITEMS` | Endgame item KHÔNG được làm reward PvP |

`validatePvpBalancePolicy()` ép invariant trên — admin upsert sai → reject.

### 2.4 Helpers

- `validatePvpSnapshot()` / `validatePvpBattleResolve()` / `validatePvpBalancePolicy()` — pure-fn validator.
- `computeFriendlyMatch(mode)` — FRIENDLY_SPARRING → `{ rewardGranted: false, ratingChange: 0 }`.
- `computePvpPowerGap(a, b)` → `max(a,b) / max(min(a,b), 1)`.
- `shouldBlockChallengeByPowerGap(gap, policy)` — bỏ qua cho SECT_WAR / TERRITORY_WAR / EVENT_PVP (assume pre-filtered).
- `classifyPvpAnomaly(type, delta)` — derive severity (1.0–5.0) + `blockRewardClaim`.
- Arena rating: re-export `computeRatingDelta` Phase 14.1.B.
- League/bracket helpers cho 29.1/29.2.

---

## 3. Prisma

Migration `20290101000000_phase_29_0_pvp_foundation` — 3 model:

### 3.1 `PvpBattle`

| Field | Type | Note |
|---|---|---|
| `id` | cuid | PK |
| `mode` | string | PvpMode (KHÔNG ARENA) |
| `status` | string | RESOLVED / PENDING / INVALIDATED |
| `result` | string? | ATTACKER_WIN / DEFENDER_WIN / DRAW / FORFEIT |
| `attackerCharacterId` | string | FK → Character.id |
| `defenderCharacterId` | string? | FK → Character.id (null cho event NPC) |
| `attackerSnapshotJson` | Json | **immutable** PvpBattleSnapshot |
| `defenderSnapshotJson` | Json | **immutable** PvpBattleSnapshot |
| `seed` | int | Deterministic resolve seed |
| `roundsJson` | Json | Summary (display-only) |
| `rewardJson` | Json? | nullable — FRIENDLY_SPARRING + INVALIDATED skip |
| `ratingChangeJson` | Json? | DUEL only |
| `sourceModuleKey` | string? | event / sect / territory key |
| `rewardGranted` | bool | invariant check |
| `idempotencyKey` | string? | UNIQUE — chống double-submit |
| `createdAt` / `resolvedAt` | DateTime | |

Index: `(mode, status)`, `(attackerCharacterId, createdAt)`, `(defenderCharacterId, createdAt)`, `(sourceModuleKey)`.

### 3.2 `PvpDefenseProfile`

| Field | Type | Note |
|---|---|---|
| `characterId` | string | PK UNIQUE 1-1 |
| `snapshotJson` | Json | PvpBattleSnapshot (DEFENDER type) |
| `label` | string? | Max 60 char (UI constraint) |
| `updatedAt` | DateTime | |

### 3.3 `PvpAnomalyLog`

| Field | Type | Note |
|---|---|---|
| `id` | cuid | PK |
| `anomalyType` | string | 8 type |
| `severity` | float | 1.0–5.0 — `classifyPvpAnomaly` |
| `characterId` | string? | FK → Character.id |
| `sectId` | string? | FK → Sect.id |
| `relatedBattleId` | string? | FK → PvpBattle.id |
| `detailJson` | Json | event detail |
| `blockedReward` | bool | classify ra `blockRewardClaim` |
| `resolvedBy` / `resolution` / `resolveReason` / `resolvedAt` | … | Admin resolve track |
| `createdAt` | DateTime | |

Index: `(anomalyType, createdAt)`, `(characterId, createdAt)`, `(resolution)`.

---

## 4. API (`apps/api/src/modules/pvp/`)

### 4.1 Services

| Service | Methods |
|---|---|
| `PvpSnapshotService` | `buildForCharacter(characterId, type)` → immutable snapshot. Throw `PVP_TARGET_NOT_FOUND` / `PVP_SNAPSHOT_INVALID`. |
| `PvpDefenseService` | `get` / `upsert(label)` / `loadOrBuild(characterId)` (fallback live rebuild khi chưa save) / `delete`. |
| `PvpBattleService` | `challenge(input)` (validate not-self → ATTACKER snapshot → DEFENDER snapshot → power gap → cooldown → idempotency → resolve seed → friendly invariant → validateResolve → persist), `listLogs(characterId, opts)`, `getById(id)`, `invalidate(id, reason)`. |
| `PvpAnomalyService` | `record(input)` (auto severity từ classify), `list(opts)`, `resolve(id, by, resolution, reason)`. |

### 4.2 Player Controller — `/pvp/*`

| Method | Path | Body | Mô tả |
|---|---|---|---|
| GET | `/pvp/policy` | — | `PVP_DEFAULT_BALANCE_POLICY` |
| GET | `/pvp/defense` | — | `PvpDefenseProfileDef \| null` |
| POST | `/pvp/defense` | `{ label?: string }` | Upsert + rebuild |
| POST | `/pvp/challenge` | `{ defenderCharacterId, mode: DUEL\|FRIENDLY_SPARRING, idempotencyKey? }` | Resolve battle |
| GET | `/pvp/battle-logs` | `?mode=&limit=&cursor=` | Lịch sử |
| GET | `/pvp/battle-logs/:id` | — | Detail |

### 4.3 Admin Controller — `/admin/pvp/*`

Tất cả wire `@RequireAdminPermission('ADMIN_MANAGE_PVP')`:

| Method | Path | Body | Audit Action |
|---|---|---|---|
| GET | `/admin/pvp/policy` | — | — |
| GET | `/admin/pvp/battle-logs` | `?mode=&characterId=&limit=` | — |
| POST | `/admin/pvp/battle-logs/:id/invalidate` | `{ reason }` | `PVP_BATTLE_INVALIDATE` |
| GET | `/admin/pvp/anomalies` | `?status=PENDING\|RESOLVED\|ALL&type=&limit=` | — |
| POST | `/admin/pvp/anomalies/:id/resolve` | `{ resolution, reason }` | `PVP_ANTICHEAT_RESOLVE` |
| GET | `/admin/pvp/defense/:characterId` | — | — |

---

## 5. Web

| Route | View | Mô tả |
|---|---|---|
| `/pvp` | `PvpView.vue` | Player — policy / defense / challenge / logs |
| `/admin/pvp` | `AdminPvpCenterView.vue` | Admin — policy / battle search+invalidate / anomaly resolve |
| `/arena` | `ArenaView.vue` | (đã có Phase 14.1.B/C) |

i18n parity ở `pvp.*` (player) + `adminPvp.*` (admin).

---

## 6. Anti-cheat / Anomaly

| Anomaly Type | Severity | Block Reward | Trigger |
|---|---|---|---|
| `PVP_POWER_JUMP_BEFORE_MATCH` | 3.0 | Y | Power tăng > 50% giữa match |
| `PVP_DAMAGE_OUTLIER` | 2.5 | N | Damage > N×median |
| `ARENA_RATING_GAIN_OUTLIER` | 2.0 | Y | Rating delta > 200/match |
| `ARENA_TARGET_FARMING` | 2.0 | Y | Cùng target ≥ X lần / windows |
| `SECT_WAR_SCORE_OUTLIER` | 2.5 | Y | Score / member > median ×5 |
| `TERRITORY_PRODUCTION_DUPLICATE_CLAIM` | 4.0 | Y | claim 2 lần cùng territory |
| `SEASON_REWARD_DOUBLE_CLAIM` | 5.0 | Y | claim mùa 2 lần |
| `ROSTER_SWAP_EXPLOIT` | 3.5 | Y | swap roster trong active battle |

Admin queue resolve qua `/admin/pvp/anomalies` — `DISMISSED` / `CONFIRMED` / `ESCALATED`.

---

## 7. Tests

| Layer | Suite | Count |
|---|---|---|
| Shared | `packages/shared/src/pvp.test.ts` | 51 |
| API | `apps/api/src/modules/pvp/pvp.service.test.ts` | 20 |
| Web | `PvpView.test.ts` + `AdminPvpCenterView.test.ts` | 7 |
| **Total Phase 29.0 new** | | **78** |

Cumulative cuối Phase 29.0:
- Shared: **3619** (3568 → 3619 = +51).
- API: **3735** (3715 → 3735 = +20).
- Web: **2064** (2057 → 2064 = +7).

---

## 8. Roadmap (PR sau)

### Phase 29.1 — Arena V2 (riêng PR)

- Season config (start/end, season key).
- Bracket (Bronze/Silver/Gold/Diamond/Immortal) — re-use existing tier.
- Leaderboard endpoint với pagination cursor.
- Matchmaking helper `shouldOfferAsArenaOpponent` (rating ±200, không cùng tông môn, không spam target).
- Settle season → mint reward qua ledger với `rewardTier` clamp.

### Phase 29.2 — Sect War (riêng PR)

- Season config + registration window.
- Roster management (5/10/20 member).
- Battlefield node (capture / hold / score).
- Action scoring (assault / defense / scout).
- Settle → distribute Sect contribution + rare item (forbiddenRewardItemKeys + per-week cap).

### Phase 29.3 — Spirit Vein Territory (riêng PR)

- Territory ownership (Sect-level).
- Challenge window (3 lần / ngày per territory).
- Production tick (12h offline production, claim qua ledger).
- Territory buff (cap 10% per type, KHÔNG stack > 25%).

---

## 9. Liên hệ & Audit

- AdminAuditLog → `meta.permissionKey: 'ADMIN_MANAGE_PVP'`, `meta.riskLevel: HIGH` cho INVALIDATE / RESOLVE_ANOMALY.
- AnomalyLog row tách bạch — `resolvedBy` lưu adminUserId.
- Battle log immutable — invalidate chỉ flip status + zero reward, KHÔNG sửa snapshot.
- Anti-rollback: nếu admin invalidate, ledger reverse qua ledger module (PR 29.2+, hiện V1 chưa ship ledger grant).
