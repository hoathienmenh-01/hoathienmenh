# Phase QOL-2 — Loadout Preset PvE / PvP / Boss Plan

> PR thứ 4 trong loạt **5 parallel features** từ `xuantoi_parallel_features_prompt.docx`.
> KHÔNG đụng Story Runtime / Reward / Currency / Quest / combat formula.

## Mục tiêu

Cho phép người chơi:

- Lưu nhiều bộ trang bị + skill + pháp bảo cho từng **mode**: `PVE` / `PVP` / `BOSS` / `CUSTOM`.
- Chuyển nhanh giữa các loadout hợp lệ qua `POST /loadouts/:id/apply`.
- Set **default preset** mỗi mode → UI client tự apply khi vào dungeon / PvP / boss room.

## Scope

### Backend

- **Model:** `CharacterLoadoutPreset` (Prisma, additive migration).
  - `name` 1–40 ký tự, unique per character (`@@unique([characterId, name])`).
  - `mode` ∈ {`PVE`, `PVP`, `BOSS`, `CUSTOM`}.
  - `equipmentSlotJson: Record<EquipSlot, inventoryItemId>` (default `{}`).
  - `skillSlotJson: string[] | null` skillKey active. Null = không thay đổi skill khi apply.
  - `artifactSlotJson: Record<ArtifactEquipSlot, characterArtifactId> | null`. Null = không thay đổi artifact khi apply.
  - `isDefaultForPve | isDefaultForPvp | isDefaultForBoss` flags.
  - Cascade khi character bị xoá.
- **Shared module** `packages/shared/src/loadout-presets.ts`:
  - Pure-function: parser + validator + type guards. Reuse FE + BE + tests. KHÔNG import Nest / Prisma.
  - Cap `MAX_ACTIVE_SKILLS = 4` (đồng bộ với `CharacterSkill.isEquipped` rule).
  - Cap `LOADOUT_PRESET_PER_CHARACTER_MAX = 20`.
- **REST endpoints** (`/loadouts`):
  - `GET /loadouts` — list (sort default flag → updatedAt desc).
  - `POST /loadouts` — create.
  - `PATCH /loadouts/:id` — update partial (name / mode / 3 slot maps).
  - `DELETE /loadouts/:id` — delete.
  - `POST /loadouts/:id/apply` — apply atomic.
  - `POST /loadouts/:id/set-default` — body `{ mode: 'PVE' | 'PVP' | 'BOSS' }`.
- **Apply transaction logic** (`$transaction`):
  1. Validate ownership (inventoryItemId thuộc character, skillKey đã `learn`, artifactId thuộc character).
  2. Nếu thiếu reference → trả `warnings: LoadoutApplyWarning[]` + **KHÔNG apply** một phần.
  3. Nếu pass → reset `equippedSlot=null` cho TẤT CẢ gear / artifact; reset `isEquipped=false` cho TẤT CẢ skill; rồi set theo preset.
  4. Item `locked` (QOL-1) vẫn equip được — chỉ chặn `use()`.

### Frontend

- **API client** `apps/web/src/api/loadout.ts`: `listLoadoutPresets / createLoadoutPreset / updateLoadoutPreset / deleteLoadoutPreset / applyLoadoutPreset / setLoadoutDefault`.
- **View** `apps/web/src/views/LoadoutView.vue`:
  - Tab CHARACTER → Loadout. List preset; nút apply, edit, delete, set-default.
  - Form thêm preset (name + mode + chọn slot từ inventory hiện có).
  - Hiển thị warning nếu apply trả warnings.
- **i18n vi/en** parity cho mọi label + error.

### Tests

- **Shared** (`loadout-presets.test.ts`) — 27 vitest cases:
  - Type guards, validator name/mode, parser equipmentSlots / skillSlots / artifactSlots, duplicate dedupe, cap 4 skill, default-flag mapping.
- **API service** (`loadout-preset.service.test.ts`) — 23 vitest cases (cần Postgres):
  - create: minimal, with equipment, reject empty name / unknown mode / dup name / dup item / cap.
  - list / get / update / delete: cross-character access denied.
  - setDefault: chỉ 1 default per mode, CUSTOM reject.
  - apply: cross-character reject, equipment rewrite, skill rewrite, artifact rewrite, null skillSlots giữ nguyên, warning rollback (không apply).

## Rủi ro / Rollback

🟢 **low** — Module hoàn toàn additive:

- Migration chỉ thêm `CharacterLoadoutPreset` table. KHÔNG thay schema cũ.
- Service KHÔNG sửa Inventory / CharacterSkill / CharacterArtifactV2 service core — chỉ update field qua Prisma trực tiếp với validation ownership.
- Apply transaction-safe; nếu sai trả warning + rollback.
- KHÔNG đụng combat formula / Story V2 / Reward.

**Rollback path:** Revert PR — orphan `characterLoadoutPreset` table (không có FK ngược); có thể drop sau bằng migration phụ.

## Follow-ups (out of scope PR này)

- **QOL-2.B:** auto-apply default preset khi user vào dungeon / PvP queue (trigger client-side trước; server-side check là follow-up).
- **QOL-2.C:** copy-from-current-loadout shortcut (UI button).
- **QOL-2.D:** import/export preset qua share code (cross-account).
- **QOL-2.E:** mobile-friendly slot picker từ inventory paginated.

## Liên kết 5 parallel PRs

| Mã | Mô tả | Trạng thái |
|----|-------|-----------|
| OPS-1 | Backup/Restore weekly verify + S3 offsite | merged #574 |
| OPS-2 | CSP env-driven CDN/API/WS | merged #575 |
| QOL-1 | Inventory item lock + auto-sort | merged #578 |
| **QOL-2 (this)** | **Loadout Preset PvE/PvP/Boss** | **draft** |
| PWA-1 | PWA Web Push notifications | pending |
