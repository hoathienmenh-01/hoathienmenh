# Phase 25.3 — Code-only Cosmetic Effects (Plan)

Branch: `feat/phase-25-3-code-only-cosmetics`
Base: `main` (Phase 25.2 Shop Packs merged via PR #547)

> **Strict scope guard.** Phase 25.3 ships *code-only* cosmetic effects —
> CSS / HTML / SVG class-based decoration only. **No new asset files
> (PNG/JPG/WebP/MP3/sprite atlases).** **No weapon skins.** **No pháp bảo
> skins.** **No power bonus**, **no `requiredRealmOrder` bypass**, **no
> real payment integration**. Cosmetic ownership/equip persists server-side
> but never feeds into combat, stat compute, or progression gates.

---

## 1. Why Phase 25.3?

Phase 25.1 (Battle Pass / Monthly Card / VIP Light) and Phase 25.2 (Shop
Packs) ship the monetization plumbing — currency flow, ledger reasons,
reward grant, admin grant, no-power guardrails. Phase 25.3 adds the
**cosmetic surface** so that spender / battle-pass / VIP rewards have
visible payoff without breaking the existing **fair-play guarantee**:

- Aura / hào quang around the avatar.
- Title / danh hiệu next to the player name.
- Avatar frame.
- Chat badge.
- Profile decoration (background gradient / glow).
- Element aura (Kim / Mộc / Thủy / Hỏa / Thổ).

These are 100% CSS-driven, no new graphical assets, no engine load.

---

## 2. Non-goals (deferred to a later phase)

- ❌ Weapon skin (`WEAPON_SKIN`) — needs art pipeline.
- ❌ Pháp bảo skin (`PHAP_BAO_SKIN`) — needs art pipeline.
- ❌ Particle / canvas / WebGL effects.
- ❌ New PNG / JPG / WebP / SVG asset files committed to the repo.
- ❌ Real payment provider (Stripe / IAP) — Phase 25.x light continues.
- ❌ Cross-character / account-wide cosmetics — per-character only.
- ❌ Trading / market listing of cosmetics — Phase 25.3 is owner-bound.

---

## 3. Cosmetic types

| Type                   | Surface                      | Code-only via                |
| ---------------------- | ---------------------------- | ---------------------------- |
| `AURA`                 | Avatar / character card      | CSS `box-shadow` + gradient  |
| `TITLE`                | Next to player name          | Text + rarity color class    |
| `AVATAR_FRAME`         | Border around avatar         | CSS `border` + glow          |
| `CHAT_BADGE`           | Inline badge before chat name| CSS pill + icon char         |
| `PROFILE_DECORATION`   | Profile background           | CSS gradient overlay         |
| `ELEMENT_AURA`         | Element-tinted aura          | CSS gradient per Ngũ Hành    |

`WEAPON_SKIN` and `PHAP_BAO_SKIN` are explicitly NOT in the catalog.

---

## 4. Shared catalog (`packages/shared/src/cosmetics.ts`)

Each `CosmeticDef` carries:

- `cosmeticId` (kebab-snake unique)
- `type: CosmeticType`
- `nameVi`, `nameEn`
- `descriptionVi`, `descriptionEn`
- `rarity: COMMON | RARE | EPIC | LEGENDARY | MYTHIC`
- `elementAffinity?: KIM | MOC | THUY | HOA | THO | NEUTRAL`
- `source: FREE | BATTLE_PASS | SHOP | VIP | EVENT | ADMIN`
- `price?` (premium currency, optional — Phase 25.3 ships mostly admin/free)
- `durationDays?` (optional — for time-bound rewards)
- `cssClass` (string, must be non-empty, exists in `cosmetics.css`)
- `previewClass` (UI preview hint)
- `active: boolean`

Target ≈ 20–25 entries:

- 5× element aura (Kim / Mộc / Thủy / Hỏa / Thổ).
- 5× title (tu tiên flavor: Sơ Học Đệ Tử, Luyện Khí Truyền Nhân, Kim Đan
  Chân Tu, Nguyên Anh Chân Quân, Đại La Kim Tiên).
- 5× avatar frame (one per rarity tier).
- 5× chat badge (VIP, Đạo Tu, Battle Pass, Event, Newbie).
- 3× profile decoration (Thanh Liên, Tử Khí, Thiên Mệnh).

Validators:
- Unique `cosmeticId`.
- No `WEAPON_SKIN` / `PHAP_BAO_SKIN` types.
- `cssClass` must be non-empty.
- Element auras only on `type === 'ELEMENT_AURA'` (sanity check).
- No power / stat field at all.

---

## 5. Data model (additive only)

Add two Prisma models, non-destructive — uses existing `Character.id` FK:

```prisma
model CosmeticOwnership {
  id           String   @id @default(cuid())
  characterId  String
  character    Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  cosmeticId   String
  source       String   // FREE | BATTLE_PASS | SHOP | VIP | EVENT | ADMIN
  ownedAt      DateTime @default(now())
  expiresAt    DateTime?

  @@unique([characterId, cosmeticId])
  @@index([characterId, expiresAt])
}

model CosmeticLoadout {
  id                          String   @id @default(cuid())
  characterId                 String   @unique
  character                   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  activeAuraId                String?
  activeTitleId               String?
  activeAvatarFrameId         String?
  activeChatBadgeId           String?
  activeProfileDecorationId   String?
  activeElementAuraId         String?
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
}
```

Migration file: `apps/api/prisma/migrations/<ts>_phase_25_3_cosmetic_ownership_loadout/migration.sql`.

Rules (server-enforced):

- Equip → must have ownership row, not expired, type matches the slot.
- Unequip → clear the slot.
- One active per type.
- Re-equip same id → idempotent (returns current state, no ledger row).
- Server never compute power/stat from these fields.
- Admin grant uses `AdminAuditLog` (reuse `admin/audit` pattern).

---

## 6. API surface

`apps/api/src/modules/cosmetics/`:

| Method | Path                                | Notes                            |
| ------ | ----------------------------------- | -------------------------------- |
| GET    | `/cosmetics/catalog`                | Active catalog from shared       |
| GET    | `/cosmetics/me`                     | Owned + loadout for current user |
| POST   | `/cosmetics/equip`                  | `{ cosmeticId }` → loadout       |
| POST   | `/cosmetics/unequip`                | `{ type }` → loadout             |
| POST   | `/admin/cosmetics/users/:id/grant`  | `{ cosmeticId, durationDays? }`  |
| POST   | `/admin/cosmetics/users/:id/revoke` | `{ cosmeticId }`                 |

Errors (HTTP envelope `{ ok:false, error:{code,message} }`):
`NO_CHARACTER`, `COSMETIC_NOT_FOUND`, `COSMETIC_INACTIVE`,
`NOT_OWNED`, `OWNERSHIP_EXPIRED`, `INVALID_TYPE`, `INVALID_INPUT`,
`UNAUTHENTICATED`, `FORBIDDEN`.

---

## 7. CSS (`apps/web/src/style/cosmetics.css`)

Class buckets:

- `aura-kim`, `aura-moc`, `aura-thuy`, `aura-hoa`, `aura-tho`,
  `aura-neutral` — `box-shadow` + radial-gradient halo.
- `title-common|rare|epic|legendary|mythic` — text color + subtle text-shadow.
- `avatar-frame-common|rare|epic|legendary|mythic` — border + glow.
- `chat-badge-vip`, `chat-badge-dao-tu`, `chat-badge-battle-pass`,
  `chat-badge-event`, `chat-badge-newbie` — pill background gradient.
- `profile-decoration-celestial`, `profile-decoration-thanh-lien`,
  `profile-decoration-tu-khi` — wrapper background gradient.

Rules:
- Use `box-shadow`, `background`, `border`, `transform`, `opacity`.
- Animations gated behind `@media (prefers-reduced-motion: no-preference)`.
- No `<img>`, no SVG file imports, no background-image url().
- No filter blurs that pin the CPU.

---

## 8. UI

- `apps/web/src/views/CosmeticView.vue` — wardrobe (catalog × ownership ×
  equip). Filter by type/rarity/source, preview tile, equip/unequip button,
  locked tile shows source hint.
- `ProfileView.vue` and `PublicPlayerProfileModal.vue` — render equipped
  title + aura + frame + profile decoration on the visited character card.
- `ChatPanel.vue` — render chat badge + title prefix before sender name.
- `AppShell.vue` — add nav link `飾 Y Quán` → `/cosmetics`.
- `MonetizationView.vue` reward-icon mapper — recognize the cosmetic keys
  used by Battle Pass / Monthly Card rewards (already shipped by Phase 25.1)
  so they render with their CSS class as a preview.

i18n: add `cosmetics.*` keys to both `vi.json` and `en.json` (parity).

---

## 9. Tests

Shared (`packages/shared/src/cosmetics.test.ts`):
- Unique cosmeticId.
- Catalog does not contain `WEAPON_SKIN` / `PHAP_BAO_SKIN`.
- All entries have non-empty `cssClass`.
- Each rarity tier maps to ≥ 1 entry.
- All 5 Ngũ Hành element auras exist.
- Helper `getCosmeticById` returns the def.
- Helper `validateCosmeticDefinition` rejects power-like fields, forbidden
  types, empty cssClass.

API (`apps/api/src/modules/cosmetics/cosmetics.service.test.ts`):
- Catalog returns only active cosmetics.
- Equip succeeds when ownership exists, type matches.
- Equip fails when not owned (`NOT_OWNED`).
- Equip fails when expired (`OWNERSHIP_EXPIRED`).
- Equip replaces previous active of same type.
- Unequip clears slot.
- Admin grant creates ownership row + audit log; non-admin rejected
  with `FORBIDDEN`.
- Equipping/unequipping does not touch `Character.power|spirit|speed|luck`.

Web (`apps/web/src/views/__tests__/CosmeticView.test.ts` +
`PublicPlayerProfileModal.test.ts` + `ChatPanel.test.ts`):
- Renders title / frame / aura when equipped.
- Wardrobe locked state.
- Equip button click → API call mocked.
- Chat badge renders.
- vi/en parity smoke.

---

## 10. Checkpoint commit plan

1. `docs(cosmetics): add code only cosmetics plan` (this file).
2. `feat(cosmetics): add code only cosmetic catalog`
   (`packages/shared/src/cosmetics.ts` + tests).
3. `feat(cosmetics): add cosmetic ownership and equip runtime`
   (Prisma migration + `cosmetics` module + admin grant).
4. `feat(web): add code only cosmetic effects`
   (CSS + wardrobe + profile/chat render + i18n).
5. `test(cosmetics): cover code only cosmetics` (shared + API + web).
6. `docs(cosmetics): document code only cosmetics`
   (GAME_DESIGN_BIBLE / BALANCE_MODEL / ECONOMY_MODEL / API / CHANGELOG /
   AI_HANDOFF_REPORT update).

Push after every commit.

---

## 11. Known follow-ups

- Cosmetic skins / asset pipeline (PHAP_BAO_SKIN, WEAPON_SKIN) → later phase.
- Trading / market listing of cosmetics → not now.
- Real payment provider integration → later phase.
- Story / lore expansion that surfaces cosmetic unlocks → later phase.
- Closed Beta QA pass once 25.3 lands.
