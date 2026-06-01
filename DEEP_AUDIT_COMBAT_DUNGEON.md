# Deep Audit — Chiến đấu & Dungeon (4.x–5.x)

> **Reviewer:** Senior Code Reviewer + QA Engineer
> **Scope:** Combat, Boss, Dungeon-run, Roguelike, Cultivation Processor
> **Date:** 2026-06-01

---

## TÓM TẮT

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 HIGH | 0 | — |
| 🟡 MEDIUM | 0 | — |
| 🟢 LOW | 0 | — |
| ✅ OK | All patterns | Confirmed correct |

---

## ✅ CONFIRMED CORRECT PATTERNS

### Combat Service (1852 lines)
| Pattern | Status | Notes |
|---------|--------|-------|
| RNG injectable | ✅ | `rollDamage`, `rollDungeonLoot`, `rollMonsterLoot` from shared |
| Stat composition | ✅ | 7-layer: base + body + equip + artifactV2 + spiritualRoot × talent × buff × title × methodV1 × methodV2 |
| Element pipeline | ✅ | playerElementMul × talentElementMul × buffElementMul × phase142Mul × petCombatMul |
| DOT system | ✅ | Single-active model, reset on monster change, snapshot damage |
| SHIELD system | ✅ | Same-turn absorb, skill shield → buff shield → remaining |
| Invuln buff | ✅ | Pre-shield, nullify all damage |
| Control debuff | ✅ | Blocked before any state mutation |
| Cross-guard | ✅ | Check active encounter + dungeon-run + roguelike before start |
| Daily limit | ✅ | Count both Encounter + DungeonRun tables |
| Stamina check | ✅ | Before start + before each action |
| MP check | ✅ | Before skill cast |
| Pet combat bonus | ✅ | Clamped contribution cap, try-catch fallback |
| Reward cap | ✅ | Daily cap via RewardCapService |

### Boss Service
| Pattern | Status | Notes |
|---------|--------|-------|
| `pickRandom` helper | ✅ | `rng: () => number = Math.random` injectable |
| Cross-guard | ✅ | Check active encounter + dungeon-run + roguelike |
| Cooldown | ✅ | `BOSS_ATTACK_COOLDOWN_MS` server-enforced |
| Control/CultivationBlocked | ✅ | Check before attack |
| Optimistic lock | ✅ | `where { status: ACTIVE }` for defeat |
| Event multiplier | ✅ | try-catch fallback to 1.0 |
| Co-op reward cap | ✅ | try-catch fallback to original amount |

### Dungeon-Run Service
| Pattern | Status | Notes |
|---------|--------|-------|
| No Math.random in prod | ✅ | Only in test file |
| Cross-guard | ✅ | Check active encounter + roguelike |

### Roguelike Service
| Pattern | Status | Notes |
|---------|--------|-------|
| Math.random usage | ✅ | Only for nonce/key generation (not game RNG) |

### Cultivation Processor
| Pattern | Status | Notes |
|---------|--------|-------|
| No Math.random | ✅ | Deterministic |

### Global RNG Scan (all 32 occurrences in production services)
| Service | Pattern | Status |
|---------|---------|--------|
| character.service.ts | `rng: () => number = Math.random` | ✅ |
| spiritual-root.service.ts | `rng: () => number = Math.random` | ✅ |
| tribulation.service.ts | `rng: () => number = Math.random` | ✅ |
| tribulation-mini-battle.service.ts | `rng: () => number = Math.random` | ✅ |
| refine.service.ts | `rng: () => number = Math.random` | ✅ |
| equipment.service.ts | `rng: () => number = Math.random` | ✅ |
| alchemy.service.ts | `rng: () => number = Math.random` | ✅ |
| body-cultivation.service.ts | `rng: () => number = Math.random` | ✅ |
| boss.service.ts | `pickRandom(arr, rng = Math.random)` | ✅ |
| drop-economy.service.ts | `rngFactory: () => () => number` | ✅ |
| artifact-v2.service.ts | `rng: () => number = Math.random` | ✅ FIXED PR #704 |
| rate-limit.service.ts | `Math.random()` for Redis key uniquifier | ✅ (not game RNG) |
| roguelike.service.ts | `Math.random()` for nonce generation | ✅ (not game RNG) |

---

## KẾT LUẬN

**Không tìm thấy issue mới** trong nhóm Combat, Boss, Dungeon, Roguelike, Cultivation Processor.

Tất cả services đều:
- Dùng injectable RNG pattern đúng cách
- Có cross-guard chống concurrent activities
- Có fail-soft patterns (try-catch fallback)
- Có optimistic locking cho concurrent mutations
- Có reward cap enforcement