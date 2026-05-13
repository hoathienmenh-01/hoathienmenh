/**
 * Phase 35.0 — Pet / Linh Thú API client.
 *
 * Player: catalog/collection/box-open/upgrade/sources.
 * Admin: catalog audit/character pets/box logs/grant/revoke/adjust/pity reset.
 */
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface PetCatalogEntry {
  petKey: string;
  nameVi: string;
  nameEn: string;
  type: 'PET' | 'LINH_THU';
  species: string;
  element: string;
  rarity: string;
  quality: string;
  role: string;
  isEventLimited: boolean;
  isTradeable: boolean;
  isPremiumVisualOnly: boolean;
  powerBudgetTier: number;
  pvpEffectivenessMultiplier: number;
  skillKeys: readonly string[];
  sourceTags: readonly string[];
  maxLevelByQuality: Readonly<Record<string, number>>;
  starLimit: number;
  evolutionStages: number;
}

export interface PetSkillDef {
  skillKey: string;
  nameVi: string;
  nameEn: string;
  type: string;
  description: string;
  maxLevel: number;
  cooldownTurns?: number;
}

export interface CharacterPetView {
  id: string;
  characterId: string;
  petKey: string;
  customName: string | null;
  level: number;
  exp: number;
  star: number;
  quality: string;
  rarity: string;
  element: string;
  evolutionStage: number;
  isLocked: boolean;
  isEquipped: boolean;
  equippedSlot: number | null;
  skillLevelsJson: Record<string, number>;
  sourceType: string;
  obtainedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PetBoxDef {
  boxKey: string;
  nameVi: string;
  nameEn: string;
  description: string;
  type: string;
  poolKey: string;
  rateVersion: number;
  costPerOpen: {
    costType: 'LINH_THACH' | 'TIEN_NGOC' | 'EVENT_TOKEN' | 'TICKET';
    amount: number;
    itemKey?: string;
  };
  tenPullDiscountPercent?: number;
  rarityRates: Record<string, number>;
  pityRules: Array<{
    triggerAfter: number;
    upgradeToRarity: string;
    counterKey: string;
    resetAfterTrigger: boolean;
  }>;
  isPremium: boolean;
  isEventLimited: boolean;
}

export interface OpenBoxResult {
  logId: string;
  resultType: 'PET' | 'SHARD' | 'MATERIAL' | 'TICKET_REFUND';
  resultKey: string;
  resultAmount: number;
  resultRarity: string;
  resultQuality: string;
  pityTriggered: boolean;
  characterPetId?: string;
}

export interface PetPityCounter {
  totalOpens: number;
  opensSinceRare: number;
  opensSinceEpic: number;
  opensSinceLegendary: number;
  opensSinceMythic: number;
  lastResetAt: string | null;
}

export interface PetBoxLogRow {
  id: string;
  boxKey: string;
  poolKey: string;
  costType: string;
  costAmount: string;
  resultType: string;
  resultKey: string;
  resultAmount: number;
  resultRarity: string;
  resultQuality: string;
  pityTriggered: boolean;
  rateVersion: number;
  createdAt: string;
}

export interface PetSourceEntry {
  petKey?: string;
  materialItemKey?: string;
  kind: string;
  sourceTag: string;
  refKey?: string;
  refContext?: string;
  weight: number;
  notes?: string;
}

export interface PetSnapshotOutput {
  petKey: string;
  contributionCapPercent: number;
  damageContributionCapPercent: number;
  pvpEffectivenessMultiplier: number;
  effectMultiplier: number;
  finalStats: Record<string, number>;
  skillsActive: readonly string[];
  context: string;
}

// ───── Catalog ─────
export async function listPetCatalog(filter?: {
  type?: 'PET' | 'LINH_THU';
  element?: string;
  rarity?: string;
}): Promise<PetCatalogEntry[]> {
  const params = new URLSearchParams();
  if (filter?.type) params.set('type', filter.type);
  if (filter?.element) params.set('element', filter.element);
  if (filter?.rarity) params.set('rarity', filter.rarity);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<PetCatalogEntry[]>>(
    `/pets/catalog${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_CATALOG_FAIL');
  return data.data;
}

export async function getPetCatalog(petKey: string): Promise<PetCatalogEntry | null> {
  const { data } = await apiClient.get<Envelope<PetCatalogEntry | null>>(
    `/pets/catalog/${encodeURIComponent(petKey)}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_GET_FAIL');
  return data.data ?? null;
}

export async function listPetSkills(): Promise<PetSkillDef[]> {
  const { data } = await apiClient.get<Envelope<PetSkillDef[]>>('/pets/skills');
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_SKILLS_FAIL');
  return data.data;
}

export async function getPetCaps(): Promise<{
  pvePercent: number;
  pvpDamagePercent: number;
  pvpEffectMultiplier: number;
  bossDamagePercent: number;
}> {
  const { data } = await apiClient.get<Envelope<{
    pvePercent: number;
    pvpDamagePercent: number;
    pvpEffectMultiplier: number;
    bossDamagePercent: number;
  }>>('/pets/caps');
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_CAPS_FAIL');
  return data.data;
}

// ───── Collection ─────
export async function listPetCollection(): Promise<CharacterPetView[]> {
  const { data } = await apiClient.get<Envelope<CharacterPetView[]>>(
    '/pets/collection',
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_COLLECTION_FAIL');
  return data.data;
}

export async function listPetShards(): Promise<Array<{ petKey: string; amount: number }>> {
  const { data } = await apiClient.get<Envelope<Array<{ petKey: string; amount: number }>>>(
    '/pets/shards',
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_SHARDS_FAIL');
  return data.data;
}

export async function getPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.get<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_GET_FAIL');
  return data.data;
}

export async function getEquippedSnapshot(
  context: 'PVE' | 'PVP' | 'BOSS' | 'DUNGEON' | 'SECRET_REALM',
): Promise<PetSnapshotOutput | null> {
  const { data } = await apiClient.get<Envelope<PetSnapshotOutput | null>>(
    `/pets/snapshot/${context}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_SNAPSHOT_FAIL');
  return data.data ?? null;
}

export async function equipPet(
  characterPetId: string,
  slot?: number,
): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/equip`,
    { slot },
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_EQUIP_FAIL');
  return data.data;
}

export async function unequipPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/unequip`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_UNEQUIP_FAIL');
  return data.data;
}

export async function lockPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/lock`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_LOCK_FAIL');
  return data.data;
}

export async function unlockPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/unlock`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_UNLOCK_FAIL');
  return data.data;
}

export async function renamePet(
  characterPetId: string,
  customName: string,
): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/rename`,
    { customName },
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_RENAME_FAIL');
  return data.data;
}

// ───── Box ─────
export async function listPetBoxes(): Promise<PetBoxDef[]> {
  const { data } = await apiClient.get<Envelope<PetBoxDef[]>>('/pets/boxes');
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_BOXES_FAIL');
  return data.data;
}

export async function getPetBox(boxKey: string): Promise<PetBoxDef | null> {
  const { data } = await apiClient.get<Envelope<PetBoxDef | null>>(
    `/pets/boxes/${encodeURIComponent(boxKey)}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_BOX_FAIL');
  return data.data ?? null;
}

export async function getPetBoxPity(boxKey: string): Promise<PetPityCounter | null> {
  const { data } = await apiClient.get<Envelope<PetPityCounter | null>>(
    `/pets/boxes/${encodeURIComponent(boxKey)}/pity`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_PITY_FAIL');
  return data.data ?? null;
}

export async function openPetBox(
  boxKey: string,
  requestId?: string,
): Promise<OpenBoxResult> {
  const { data } = await apiClient.post<Envelope<OpenBoxResult>>(
    `/pets/boxes/${encodeURIComponent(boxKey)}/open`,
    { requestId },
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_OPEN_FAIL');
  return data.data;
}

export async function listPetBoxLogs(opts: {
  boxKey?: string;
  limit?: number;
} = {}): Promise<PetBoxLogRow[]> {
  const params = new URLSearchParams();
  if (opts.boxKey) params.set('boxKey', opts.boxKey);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<PetBoxLogRow[]>>(
    `/pets/boxes/logs${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_LOGS_FAIL');
  return data.data;
}

// ───── Upgrade ─────
export async function feedPet(
  characterPetId: string,
  itemKey: string,
  qty: number,
): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/feed`,
    { itemKey, qty },
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_FEED_FAIL');
  return data.data;
}

export async function starUpPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/star-up`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_STAR_FAIL');
  return data.data;
}

export async function breakthroughPet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/breakthrough`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_BREAKTHROUGH_FAIL');
  return data.data;
}

export async function evolvePet(characterPetId: string): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/evolve`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_EVOLVE_FAIL');
  return data.data;
}

export async function upgradePetSkill(
  characterPetId: string,
  skillKey: string,
): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/pets/${encodeURIComponent(characterPetId)}/skills/${encodeURIComponent(skillKey)}/upgrade`,
    {},
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_SKILL_FAIL');
  return data.data;
}

// ───── Sources ─────
export async function getPetSources(petKey: string): Promise<PetSourceEntry[]> {
  const { data } = await apiClient.get<Envelope<PetSourceEntry[]>>(
    `/pets/sources/${encodeURIComponent(petKey)}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_SOURCES_FAIL');
  return data.data;
}

export async function getMaterialSources(itemKey: string): Promise<PetSourceEntry[]> {
  const { data } = await apiClient.get<Envelope<PetSourceEntry[]>>(
    `/pets/materials/sources/${encodeURIComponent(itemKey)}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_MAT_SOURCES_FAIL');
  return data.data;
}

// ───── Admin ─────
export async function adminListCatalogAudit(): Promise<Array<{ code: string; message: string; petKey?: string }>> {
  const { data } = await apiClient.get<Envelope<Array<{ code: string; message: string; petKey?: string }>>>(
    '/admin/pets/catalog',
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_AUDIT_FAIL');
  return data.data;
}

export async function adminListBoxesAudit(): Promise<Array<{ boxKey: string; code: string; message: string }>> {
  const { data } = await apiClient.get<Envelope<Array<{ boxKey: string; code: string; message: string }>>>(
    '/admin/pets/boxes',
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_BOXES_FAIL');
  return data.data;
}

export async function adminListSourcesAudit(): Promise<Array<{ code: string; message: string; petKey?: string }>> {
  const { data } = await apiClient.get<Envelope<Array<{ code: string; message: string; petKey?: string }>>>(
    '/admin/pets/sources/audit',
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_SOURCES_FAIL');
  return data.data;
}

export async function adminGetCharacterPets(characterId: string): Promise<CharacterPetView[]> {
  const { data } = await apiClient.get<Envelope<CharacterPetView[]>>(
    `/admin/pets/character/${encodeURIComponent(characterId)}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_CHAR_FAIL');
  return data.data;
}

export async function adminGetCharacterShards(
  characterId: string,
): Promise<Array<{ petKey: string; amount: number }>> {
  const { data } = await apiClient.get<Envelope<Array<{ petKey: string; amount: number }>>>(
    `/admin/pets/${encodeURIComponent(characterId)}/shards`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_SHARDS_FAIL');
  return data.data;
}

export async function adminGetBoxLogs(
  characterId: string,
  opts: { boxKey?: string; limit?: number } = {},
): Promise<PetBoxLogRow[]> {
  const params = new URLSearchParams();
  if (opts.boxKey) params.set('boxKey', opts.boxKey);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<PetBoxLogRow[]>>(
    `/admin/pets/${encodeURIComponent(characterId)}/box-logs${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_LOGS_FAIL');
  return data.data;
}

export async function adminGrantPet(input: {
  characterId: string;
  petKey: string;
  reason: string;
}): Promise<CharacterPetView> {
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    '/admin/pets/grant',
    input,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_GRANT_FAIL');
  return data.data;
}

export async function adminGrantShard(input: {
  characterId: string;
  petKey: string;
  amount: number;
  reason: string;
}): Promise<{ petKey: string; amount: number }> {
  const { data } = await apiClient.post<Envelope<{ petKey: string; amount: number }>>(
    '/admin/pets/shard/grant',
    input,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_SHARD_GRANT_FAIL');
  return data.data;
}

export async function adminRevokePet(input: {
  characterPetId: string;
  reason: string;
}): Promise<void> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/pets/${encodeURIComponent(input.characterPetId)}/revoke`,
    { reason: input.reason },
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_ADMIN_REVOKE_FAIL');
}

export async function adminAdjustPet(input: {
  characterPetId: string;
  level?: number;
  star?: number;
  evolutionStage?: number;
  reason: string;
}): Promise<CharacterPetView> {
  const { characterPetId, ...rest } = input;
  const { data } = await apiClient.post<Envelope<CharacterPetView>>(
    `/admin/pets/${encodeURIComponent(characterPetId)}/adjust`,
    rest,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PET_ADMIN_ADJUST_FAIL');
  return data.data;
}

export async function adminPityReset(input: {
  characterId: string;
  boxKey: string;
  poolKey?: string;
  reason: string;
}): Promise<void> {
  const { characterId, ...rest } = input;
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/pets/character/${encodeURIComponent(characterId)}/pity-reset`,
    rest,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PET_ADMIN_PITY_RESET_FAIL');
}
