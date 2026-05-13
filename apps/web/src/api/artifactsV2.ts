import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 26.4 — Artifact / Pháp Bảo V2 (hệ pháp bảo crafting V2) UI API client.
 *
 * Wire endpoint server (`CharacterController` Phase 26.4):
 *   - `GET    /character/artifacts-v2`
 *   - `POST   /character/artifacts-v2/craft`
 *   - `POST   /character/artifacts-v2/equip`
 *   - `POST   /character/artifacts-v2/unequip`
 *   - `POST   /character/artifacts-v2/upgrade`
 *   - `POST   /character/artifacts-v2/star-up`
 *   - `POST   /character/artifacts-v2/refine`
 *   - `POST   /character/artifacts-v2/awaken`
 *
 * Server-authoritative: client chỉ gửi `blueprintKey` / `artifactId` /
 * `slot`. Server validate realm + tier + materials + linhThach + roll
 * RNG + ghi `ArtifactCraftAttemptLog` / `ArtifactUpgradeLogV2`. Type
 * shape khớp `ArtifactV2StateOut` (xem `apps/api/src/modules/character/
 * artifact-v2.service.ts`).
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export type ArtifactEquipSlotV2 =
  | 'MAIN_ARTIFACT_V2'
  | 'DEFENSE_ARTIFACT_V2'
  | 'SUPPORT_ARTIFACT_V2'
  | 'ALCHEMY_ARTIFACT_V2'
  | 'SPECIAL_ARTIFACT_V2';

export interface ArtifactV2OwnedEntry {
  id: string;
  artifactKey: string;
  name: string;
  type: string;
  element: string;
  tier: number;
  grade: string;
  level: number;
  star: number;
  refineLevel: number;
  awakenLevel: number;
  spiritLevel: number;
  equippedSlot: ArtifactEquipSlotV2 | null;
  locked: boolean;
  stats: Record<string, unknown>;
  subStats: ReadonlyArray<{ kind: string; value: number }>;
  skills: ReadonlyArray<string>;
  powerScore: number;
}

export interface ArtifactV2MissingMaterialEntry {
  itemKey: string;
  required: number;
  owned: number;
}

export interface ArtifactV2BlueprintEntry {
  key: string;
  artifactKey: string;
  artifactName: string;
  artifactType: string;
  artifactElement: string;
  artifactTier: number;
  requiredRealmOrder: number;
  successRate: number;
  possibleGrades: Partial<Record<string, number>>;
  maxGrade: string;
  sourceHint: ReadonlyArray<string>;
  inputs: ReadonlyArray<{ itemKey: string; qty: number }>;
  linhThachCost: number;
  linhThachMissing: number;
  missingMaterials: ArtifactV2MissingMaterialEntry[];
  canCraft: boolean;
  errors: ReadonlyArray<string>;
}

export interface ArtifactV2Snapshot {
  atk: number;
  def: number;
  hpMax: number;
  mpMax: number;
  spirit: number;
  speed: number;
  crit: number;
  bossDamageReductionPct: number;
  cultivationRateBonusPct: number;
  bodyCultivationRateBonusPct: number;
  alchemySuccessRateBonusPct: number;
  dropRateBonusPct: number;
  luckBonusPct: number;
  tribulationSupportBonusPct: number;
  elementalAtkBonus: Record<string, number>;
  elementResist: Record<string, number>;
}

export interface ArtifactV2State {
  realmOrder: number;
  bodyRealmOrder: number;
  linhThachOwned: number;
  owned: ArtifactV2OwnedEntry[];
  blueprints: ArtifactV2BlueprintEntry[];
  statPreview: ArtifactV2Snapshot;
}

export interface ArtifactV2CraftResult {
  success: boolean;
  successRate: number;
  rollValue: number;
  grade: string | null;
  artifactId: string | null;
  stats: unknown;
  consumed: { items: { key: string; qty: number }[]; linhThach: number };
}

export interface ArtifactV2UpgradeResult {
  action: 'UPGRADE' | 'STAR_UP' | 'REFINE' | 'AWAKEN';
  success: boolean;
  successRate: number;
  rollValue: number;
  from: {
    level: number;
    star: number;
    refineLevel: number;
    awakenLevel: number;
  };
  to: {
    level: number;
    star: number;
    refineLevel: number;
    awakenLevel: number;
  };
  stats: unknown;
  skills: ReadonlyArray<string>;
  consumed: { items: { key: string; qty: number }[]; linhThach: number };
}

interface StateEnvelope {
  artifactsV2: ArtifactV2State;
}
interface CraftEnvelope extends StateEnvelope {
  craft: ArtifactV2CraftResult;
}
interface UpgradeEnvelope extends StateEnvelope {
  upgrade: ArtifactV2UpgradeResult;
}

export async function getArtifactV2State(): Promise<ArtifactV2State> {
  const { data } = await apiClient.get<Envelope<StateEnvelope>>(
    '/character/artifacts-v2',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('artifactV2State');
  return data.data.artifactsV2;
}

export async function craftArtifactV2(
  blueprintKey: string,
): Promise<{ craft: ArtifactV2CraftResult; state: ArtifactV2State }> {
  const { data } = await apiClient.post<Envelope<CraftEnvelope>>(
    '/character/artifacts-v2/craft',
    { blueprintKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('artifactV2Craft');
  return { craft: data.data.craft, state: data.data.artifactsV2 };
}

export async function equipArtifactV2(
  artifactId: string,
  slot: ArtifactEquipSlotV2,
): Promise<ArtifactV2State> {
  const { data } = await apiClient.post<Envelope<StateEnvelope>>(
    '/character/artifacts-v2/equip',
    { artifactId, slot },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('artifactV2Equip');
  return data.data.artifactsV2;
}

export async function unequipArtifactV2(
  artifactId: string,
): Promise<ArtifactV2State> {
  const { data } = await apiClient.post<Envelope<StateEnvelope>>(
    '/character/artifacts-v2/unequip',
    { artifactId },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('artifactV2Unequip');
  return data.data.artifactsV2;
}

async function runUpgrade(
  endpoint:
    | '/character/artifacts-v2/upgrade'
    | '/character/artifacts-v2/star-up'
    | '/character/artifacts-v2/refine'
    | '/character/artifacts-v2/awaken',
  artifactId: string,
): Promise<{ upgrade: ArtifactV2UpgradeResult; state: ArtifactV2State }> {
  const { data } = await apiClient.post<Envelope<UpgradeEnvelope>>(endpoint, {
    artifactId,
  });
  if (!data.ok || !data.data) throw data.error ?? fallbackError('artifactV2Upgrade');
  return { upgrade: data.data.upgrade, state: data.data.artifactsV2 };
}

export const upgradeArtifactV2Level = (id: string) =>
  runUpgrade('/character/artifacts-v2/upgrade', id);
export const starUpArtifactV2 = (id: string) =>
  runUpgrade('/character/artifacts-v2/star-up', id);
export const refineArtifactV2 = (id: string) =>
  runUpgrade('/character/artifacts-v2/refine', id);
export const awakenArtifactV2 = (id: string) =>
  runUpgrade('/character/artifacts-v2/awaken', id);
