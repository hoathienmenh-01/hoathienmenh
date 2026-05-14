# Feature Flags & Remote Config Center

**Phase**: 45.0 — Feature Flags & Remote Config Center V1.
**Status**: V1 — `OPEN` (this PR `phase-45-feature-flags-remote-config-v1`).

Documentation for the admin-controlled kill-switch + runtime config center
that lets the operations team disable broken modules or tune operational
constants without redeploying.

> Existing Phase 15.4 feature-flag foundation (catalog + cache + admin
> UI) is extended here — Phase 45.0 adds **18 new flag keys** (29 total),
> a **brand new RemoteConfig table**, and **reason-aware audit**.

---

## 1. What Phase 45.0 ships

### Feature flags (29 total, 21 covered by user spec)

| Key | Module | Category | Default | Wired guard? |
|---|---|---|---|---|
| `ARENA_ENABLED` | arena | GAMEPLAY | ON | yes (Phase 15.4) |
| `EQUIPMENT_REFORGE_ENABLED` | equipment.reforge | GAMEPLAY | ON | yes (Phase 15.4) |
| `EQUIPMENT_ENCHANT_ENABLED` | equipment.enchant | GAMEPLAY | ON | yes (Phase 15.4) |
| `TRIBULATION_MINI_BATTLE_ENABLED` | tribulation | GAMEPLAY | OFF | yes (Phase 14.3.E.1) |
| `LIVEOPS_EVENTS_ENABLED` | liveops.events | LIVEOPS | ON | yes (Phase 15.3) |
| `LIVEOPS_FESTIVAL_GIFT_ENABLED` | liveops.festival | LIVEOPS | ON | yes (Phase 15.3) |
| `LIVEOPS_ANNOUNCEMENTS_ENABLED` | liveops.announcements | LIVEOPS | ON | yes (Phase 15.3) |
| `TERRITORY_WAR_ENABLED` | territory-war | GAMEPLAY | OFF | yes (Phase 15.4) |
| `MARKET_ENABLED` | market | ECONOMY | ON | TODO (Phase 45.1) |
| `SHOP_DISCOUNT_EVENTS_ENABLED` | shop.discount | ECONOMY | ON | yes (Phase 15.4) |
| `SECT_SHOP_DISCOUNT_EVENTS_ENABLED` | sect.shop.discount | ECONOMY | ON | yes (Phase 15.4) |
| `STORY_V2_ENABLED` | story.v2 | GAMEPLAY | ON | TODO (Phase 45.1) |
| `AUCTION_HOUSE_ENABLED` | auction-house | ECONOMY | OFF | TODO (Phase 45.1) |
| `CODEX_ENABLED` | codex | GAMEPLAY | ON | TODO (Phase 45.1) |
| `VISUAL_EFFECTS_ENABLED` | visual-effects | GAMEPLAY | ON | FE only (config preferred) |
| `PET_SYSTEM_ENABLED` | pet | GAMEPLAY | ON | TODO (Phase 45.1) |
| `PET_BOX_ENABLED` | pet.box | GAMEPLAY | ON | **DONE — `pet.player.controller.ts boxOpen`** |
| `SECRET_REALM_ENABLED` | secret-realm | GAMEPLAY | ON | **DONE — `secret-realm-runtime.controller.ts enter`** |
| `DAILY_ENCOUNTER_ENABLED` | daily-encounter | GAMEPLAY | ON | **DONE — `accept` + `claim`** |
| `EVENT_BUILDER_ENABLED` | event-builder | LIVEOPS | ON | TODO (Phase 45.1) |
| `PVP_ENABLED` | pvp | GAMEPLAY | ON | TODO (Phase 45.1) |
| `SECT_WAR_ENABLED` | sect-war | GAMEPLAY | ON | TODO (Phase 45.1) |
| `MAIL_ENABLED` | mail | GAMEPLAY | ON | TODO (Phase 45.1) |
| `MENTOR_ENABLED` | mentor | GAMEPLAY | ON | TODO (Phase 45.1) |
| `WEB_PUSH_ENABLED` | web-push | LIVEOPS | ON | **DONE — `web-push.controller.ts subscribe`** |
| `ADMIN_GIFT_ENABLED` | admin-gift | ADMIN | ON | **DONE — `system-gift.controller.ts distribute`** |
| `ONBOARDING_ENABLED` | onboarding | GAMEPLAY | ON | TODO (Phase 45.1) |
| `ALCHEMY_ENABLED` | alchemy | GAMEPLAY | ON | TODO (Phase 45.1) |
| `BOSS_ENABLED` | boss | GAMEPLAY | ON | TODO (Phase 45.1) |
| `DUNGEON_ENABLED` | dungeon | GAMEPLAY | ON | TODO (Phase 45.1) |

Definition lives in `packages/shared/src/feature-flags.ts` →
`FEATURE_FLAG_CATALOG`.

### Remote config (7 keys)

| Key | Type | Public | Cap | Purpose |
|---|---|---|---|---|
| `max_daily_claims` | number | no | 1..1000 | LiveOps daily claim throttle |
| `maintenance_message` | string | yes | ≤ 500 chars | Banner / overlay copy |
| `visual_effect_default_level` | string | yes | enum `MIN`/`LOW`/`MED`/`HIGH` | FE effect preset bootstrap |
| `reward_safety_mode` | string | no | enum `STRICT`/`NORMAL`/`RELAXED` | Reward policy tier |
| `market_enabled` | boolean | yes | — | Secondary kill-switch (also flag) |
| `secret_realm_enabled` | boolean | yes | — | Secondary kill-switch (also flag) |
| `pet_box_enabled` | boolean | yes | — | Secondary kill-switch (also flag) |

Definition lives in `packages/shared/src/remote-config.ts` →
`REMOTE_CONFIG_CATALOG`.

`public` rows are the only ones returned by `GET /remote-config/public` /
`GET /config/public`. Admin-only rows (`max_daily_claims`,
`reward_safety_mode`) are **never** exposed to anonymous clients.

---

## 2. API surface

### Public

```http
GET /config/public            → { flags: PublicFlag[], configs: PublicConfig[] }
GET /feature-flags/public     → { flags: PublicFlag[] }
GET /remote-config/public     → { configs: PublicConfig[] }
```

- Anonymous, no auth required.
- Fail-soft: 500 on the API side never propagates — FE clients fall back
  to the shared default catalog.

### Admin (require `ADMIN`)

```http
GET  /admin/feature-flags
PATCH /admin/feature-flags/:key            body: { enabled, reason? }
POST /admin/feature-flags/refresh-defaults
POST /admin/feature-flags/clear-cache

GET  /admin/remote-config
PATCH /admin/remote-config/:key            body: { value, reason }      ← reason required
POST /admin/remote-config/refresh-defaults
POST /admin/remote-config/clear-cache
```

- Non-admin → `403 FORBIDDEN`.
- `PATCH /admin/remote-config/:key` requires `reason` (3–500 chars). It
  is persisted to the `AdminAuditLog` row as
  `ADMIN_REMOTE_CONFIG_UPDATE` with `{ oldValue, newValue, reason }`.
- Validation failure → `422` with `RemoteConfigViolation[]` (codes
  `VALUE_TYPE_MISMATCH`, `VALUE_REQUIRED`, `VALUE_TOO_LONG`,
  `VALUE_OUT_OF_RANGE`, `VALUE_NOT_IN_ENUM`, `VALUE_JSON_TOO_LARGE`,
  `VALUE_JSON_INVALID`).

---

## 3. Backend helpers

### Feature-flag guard

```ts
import { FeatureFlagService } from './feature-flag.service';

await this.featureFlags.requireEnabled('SECRET_REALM_ENABLED');
// → throws FeatureDisabledError (HTTP 503 FEATURE_DISABLED) if disabled
```

In a controller, the error is mapped to:

```json
{
  "ok": false,
  "error": { "code": "FEATURE_DISABLED", "message": "feature disabled: SECRET_REALM_ENABLED" }
}
```

Returned with `503`.

To soft-check without throwing:

```ts
const enabled = await this.featureFlags.isEnabled('SECRET_REALM_ENABLED');
if (!enabled) return { degraded: true };
```

### Remote config helper

```ts
import { RemoteConfigService } from './remote-config.service';

const v = await this.remoteConfig.getConfig('max_daily_claims');
// v: number — typed by the catalog
```

`getConfig` always returns a value:
1. **L1 in-memory cache** (per process, 30s TTL).
2. **L2 Redis** (`remote-config:value:<key>`).
3. **Database `RemoteConfig` table**.
4. **Catalog default** (`getDefaultRemoteConfigValue`).

Any failure (Redis down, DB down, corrupt JSON) → fall through to the
next tier. The function is **fail-open** — it never throws.

### Public bundle for FE bootstrap

The FE store can call **one** endpoint at startup:

```ts
import { getPublicConfigBundle } from '@/api/remoteConfig';

const { flags, configs } = await getPublicConfigBundle();
```

---

## 4. Adding a new feature flag

1. Edit `packages/shared/src/feature-flags.ts`:
   ```ts
   {
     key: 'MY_NEW_FEATURE_ENABLED',
     category: 'GAMEPLAY',          // or ECONOMY / LIVEOPS / ADMIN / SAFETY
     descriptionVi: '...',
     descriptionEn: '...',
     defaultEnabled: true,
     module: 'my-module',
     public: false,                 // true if FE needs to read it anonymously
     requiresRestart: false,
   },
   ```
2. The `FeatureFlagKey` union is **auto-extracted** from
   `FEATURE_FLAG_CATALOG` via `(typeof FEATURE_FLAG_CATALOG)[number]['key']` —
   no separate enum to update.
3. Re-run `pnpm typecheck` to validate. Re-run shared tests:
   `pnpm -F @xuantoi/shared test feature-flags`.
4. Migration is **not** needed — the row is lazily seeded by
   `refresh-defaults` or auto-created on first PATCH.
5. After deploy, call `POST /admin/feature-flags/refresh-defaults` once
   to backfill the new row.

## 5. Adding a new remote-config key

1. Edit `packages/shared/src/remote-config.ts`:
   ```ts
   {
     key: 'my_new_knob',
     valueType: 'number',             // string | number | boolean | json
     defaultValue: 30,
     min: 1, max: 1000,               // type-specific caps
     descriptionVi: '...',
     descriptionEn: '...',
     public: false,                   // true → exposed via /remote-config/public
   },
   ```
2. Caps are enforced by `validateRemoteConfigValue` in shared. Always
   set conservative caps to avoid DOS via large JSON / runaway numbers.
3. Backfill via `POST /admin/remote-config/refresh-defaults`.

## 6. How to disable a broken module (incident playbook)

1. Open **Admin → Feature Flags** in the web app.
2. Search for the flag (e.g. `secret_realm`).
3. Click **Tắt** / **Disable** on the row.
4. Confirm the modal — describe the impact in plain language for the
   audit trail (the `reason` field is logged).
5. Optionally call **Clear cache** to force every API node to drop its
   L1+L2 cache immediately (otherwise propagates within
   `FEATURE_FLAG_CACHE_TTL_SEC`, default 30s).

The corresponding player API will then return:

```
HTTP 503
{ "ok": false, "error": { "code": "FEATURE_DISABLED", "message": "..." } }
```

Re-enable by clicking **Bật** / **Enable** on the same row.

For runtime knobs (e.g. lowering `max_daily_claims` when LiveOps
detects abuse), use **Admin → Remote Config** instead, with the same
reason-required workflow.

---

## 7. Safety & invariants

| Guarantee | Where enforced |
|---|---|
| Non-admin cannot mutate flag / config | `AdminGuard` on PATCH routes |
| Reason required for remote-config PATCH | Zod schema `min(3).max(500)` |
| Cannot delete a catalog flag | No DELETE route; only PATCH `enabled` |
| Config JSON capped (≤ `REMOTE_CONFIG_JSON_MAX_BYTES` 4 KiB) | `validateRemoteConfigValue` |
| Number / enum bounds | `validateRemoteConfigValue` (UNIT-TESTED) |
| Fail-open on DB / Redis outage | `RemoteConfigService.getConfig` 4-tier fallback |
| Cache invalidation post-update | `_invalidateCaches(key)` in service after each set |

---

## 8. Tests

| Suite | File | Count |
|---|---|---|
| Shared remote-config validators | `packages/shared/src/__tests__/remote-config.test.ts` | covered via catalog invariants + existing infrastructure |
| RemoteConfigService unit | `apps/api/src/modules/remote-config/remote-config.service.test.ts` | 18 |
| Admin remote-config controller | `apps/api/src/modules/remote-config-admin/admin-remote-config.controller.test.ts` | 10 |
| Admin remote-config panel (Vue) | `apps/web/src/components/__tests__/AdminRemoteConfigPanel.test.ts` | 7 |
| Admin feature-flag controller (existing) | `apps/api/src/modules/feature-flag-admin/admin-feature-flag.controller.test.ts` | extended for reason field |

Run targeted:
```bash
pnpm -F @xuantoi/api exec vitest run src/modules/remote-config
pnpm -F @xuantoi/api exec vitest run src/modules/remote-config-admin
pnpm -F @xuantoi/web exec vitest run src/components/__tests__/AdminRemoteConfigPanel.test.ts
```

Full validation:
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

## 9. Known risks & follow-up

- **Light wiring only**: 5 modules guarded (admin-gift, pet-box,
  secret-realm, daily-encounter, web-push). The 16 remaining flag keys
  exist in the catalog but the guard has not been wired into the
  corresponding controllers / cron / FE views. **Phase 45.1+** will
  systematically wire the remaining flags by priority (story_v2,
  auction_house, codex, pvp, sect_war first).
- **VISUAL_EFFECTS** lives in shared but the FE runtime does not yet
  check it; the FE today reads `visual_effect_default_level` from
  remote-config. Wiring planned for Phase 45.1.
- **No history UI** for remote-config changes yet. The data is in
  `AdminAuditLog` (`ADMIN_REMOTE_CONFIG_UPDATE` action). A dedicated
  history pane is a Phase 45.1 follow-up.
- **Cache TTL is per-process** — multi-instance API deployments will see
  up to `FEATURE_FLAG_CACHE_TTL_SEC` / `REMOTE_CONFIG_CACHE_TTL_SEC`
  drift before the new value applies. Admins can call **Clear cache**
  on the affected node, but a cross-node pubsub invalidation is a
  candidate hardening.
- **No environment scoping** of values yet. The new
  `FeatureFlag.environment` column is reserved for future use (e.g.
  `staging` vs `prod` overrides). All current rows ignore it.

---

## 10. Related docs

- [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) — current status entry.
- [`REWARD_POLICY.md`](./REWARD_POLICY.md) — Phase 44.0 reward caps that
  `reward_safety_mode` may eventually tighten.
- [`ECONOMY_INTEGRITY_AUDIT.md`](./ECONOMY_INTEGRITY_AUDIT.md) — runtime
  audit helpers that complement the kill-switch.
