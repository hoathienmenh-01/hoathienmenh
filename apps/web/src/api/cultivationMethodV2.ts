import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 26.3 — Cultivation Method V2 (Công Pháp V2) UI API client.
 *
 * Wire 5 endpoint server `CharacterController` Phase 26.3:
 *   - `GET    /character/cultivation-methods-v2`
 *   - `POST   /character/cultivation-methods-v2/unlock`
 *   - `POST   /character/cultivation-methods-v2/equip`
 *   - `POST   /character/cultivation-methods-v2/unequip`
 *   - `POST   /character/cultivation-methods-v2/upgrade`
 *   - `POST   /character/cultivation-methods-v2/star-up`
 *
 * Server-authoritative: client chỉ gửi `methodKey` + `slot`, server validate
 * realm / sect / inventory / linhThach + ghi `MethodUpgradeLog`. Type-shape
 * khớp `CultivationMethodV2StateOut` (xem
 * `apps/api/src/modules/character/cultivation-method-v2.service.ts`).
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export type MethodEquipSlotV2 =
  | 'QI_MAIN'
  | 'BODY_MAIN'
  | 'SUPPORT'
  | 'SECT'
  | 'SPECIAL';

export interface CultivationMethodV2CatalogEntry {
  methodKey: string;
  unlocked: boolean;
  level: number;
  star: number;
  methodExp: string;
  equippedSlot: MethodEquipSlotV2 | null;
  fragmentsOwned: number;
  fragmentsRequiredToUnlock: number;
  fragmentsPerStar: number;
  unlockLinhThachCost: number;
  upgradeLinhThachCost: number;
  upgradeExpCost: string;
  canUnlock: boolean;
  canEquip: boolean;
  canEquipReason: string | null;
  canUpgrade: boolean;
  canUpgradeReason: string | null;
  canStarUp: boolean;
  canStarUpReason: string | null;
}

export interface CultivationMethodV2EquippedSlot {
  slot: MethodEquipSlotV2;
  methodKey: string;
}

export interface CultivationMethodV2AggregatedBonuses {
  qiExpPercent: number;
  bodyExpPercent: number;
  hpMaxPercent: number;
  mpMaxPercent: number;
  atkPercent: number;
  defPercent: number;
  spiritPercent: number;
  staminaMaxPercent: number;
  bossDamageReduction: number;
  elementalAtkBonus: number;
  tribulationSupport: number;
}

export interface CultivationMethodV2State {
  catalog: CultivationMethodV2CatalogEntry[];
  equippedSlots: CultivationMethodV2EquippedSlot[];
  aggregatedBonuses: CultivationMethodV2AggregatedBonuses;
  cultivationRateMul: number;
  bodyRateMul: number;
}

interface EnvelopeData {
  cultivationMethodV2: CultivationMethodV2State;
}

export async function getCultivationMethodV2State(): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.get<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2State');
  return data.data.cultivationMethodV2;
}

export async function unlockCultivationMethodV2(
  methodKey: string,
): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.post<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2/unlock',
    { methodKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2Unlock');
  return data.data.cultivationMethodV2;
}

export async function equipCultivationMethodV2(
  methodKey: string,
  slot: MethodEquipSlotV2,
): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.post<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2/equip',
    { methodKey, slot },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2Equip');
  return data.data.cultivationMethodV2;
}

export async function unequipCultivationMethodV2(
  slot: MethodEquipSlotV2,
): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.post<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2/unequip',
    { slot },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2Unequip');
  return data.data.cultivationMethodV2;
}

export async function upgradeCultivationMethodV2(
  methodKey: string,
): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.post<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2/upgrade',
    { methodKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2Upgrade');
  return data.data.cultivationMethodV2;
}

export async function starUpCultivationMethodV2(
  methodKey: string,
): Promise<CultivationMethodV2State> {
  const { data } = await apiClient.post<Envelope<EnvelopeData>>(
    '/character/cultivation-methods-v2/star-up',
    { methodKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodV2StarUp');
  return data.data.cultivationMethodV2;
}
