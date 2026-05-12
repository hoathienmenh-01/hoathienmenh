import { apiClient } from './client';
import type { ElementKey, ItemBonus, Quality } from '@xuantoi/shared';

/**
 * Phase 23.5 — Pháp Bảo Advanced Artifact System (foundation).
 *
 * Read-only API client cho FE Pháp Bảo panel. KHÔNG có mutate endpoint
 * (equip dùng nguyên `/inventory/equip`, refine dùng nguyên `/character/refine`).
 * Star-up / awaken DEFER → flag `starUpEnabled` / `awakenEnabled` false.
 */

export interface PhapBaoDefView {
  artifactKey: string;
  itemKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  artifactTier: number;
  requiredRealmOrder: number;
  quality: Quality;
  elementAffinity: ElementKey | 'NEUTRAL';
  role: string;
  activeSkill: PhapBaoActiveDef | null;
  starCap: number;
  refineCap: number;
  awakenCap: number;
  source: string;
  powerBudget: number;
}

export interface PhapBaoActiveDef {
  skillKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  unlockStar: number;
  baseCooldownSec: number;
  cooldownFloorSec: number;
  baseEffect: ItemBonus;
}

export interface PhapBaoView {
  inventoryItemId: string;
  def: PhapBaoDefView;
  equippedSlot: string | null;
  refineLevel: number;
  starLevel: number;
  awakenStage: number;
  canEquip: boolean;
  requiredRealmOrder: number;
  powerScore: number;
}

export interface PhapBaoCostView {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  shardKey: string | null;
  shardQty: number | null;
  awakenStoneKey: string | null;
  awakenStoneQty: number | null;
}

export interface PhapBaoActiveSkillPreview {
  available: boolean;
  unlocked?: boolean;
  skillKey?: string;
  nameVi?: string;
  nameEn?: string;
  cooldownSec?: number;
  effect?: ItemBonus;
  unlockStar?: number;
}

export interface PhapBaoPreview {
  inventoryItemId: string;
  def: PhapBaoDefView;
  equippedSlot: string | null;
  refineLevel: number;
  starLevel: number;
  awakenStage: number;
  canEquip: boolean;
  realmOrder: number;
  requiredRealmOrder: number;
  passiveBonus: ItemBonus;
  activeSkill: PhapBaoActiveSkillPreview;
  powerScore: number;
  refineCost: PhapBaoCostView | null;
  starCost: PhapBaoCostView | null;
  awakenCost: PhapBaoCostView | null;
  starUpEnabled: boolean;
  awakenEnabled: boolean;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export interface PhapBaoListResult {
  items: PhapBaoView[];
  catalog: PhapBaoDefView[];
}

/**
 * Phase 23.5 — `GET /character/phap-bao/list`. Trả pháp bảo sở hữu + catalog
 * metadata (cho FE hiển thị các pháp bảo còn lock / chưa drop).
 */
export async function listPhapBao(): Promise<PhapBaoListResult> {
  const { data } = await apiClient.get<
    Envelope<{ items: PhapBaoView[]; catalog: PhapBaoDefView[] }>
  >('/character/phap-bao/list');
  const u = unwrap(data);
  return { items: u.items, catalog: u.catalog };
}

/**
 * Phase 23.5 — `GET /character/phap-bao/:inventoryItemId/preview`. Read-only
 * preview passive bonus / active skill / refine-star-awaken cost.
 */
export async function previewPhapBao(
  inventoryItemId: string,
): Promise<PhapBaoPreview> {
  const { data } = await apiClient.get<Envelope<{ preview: PhapBaoPreview }>>(
    `/character/phap-bao/${encodeURIComponent(inventoryItemId)}/preview`,
  );
  return unwrap(data).preview;
}
