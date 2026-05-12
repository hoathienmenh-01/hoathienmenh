import { apiClient } from './client';
import type { ElementKey, ItemBonus, Quality } from '@xuantoi/shared';

/**
 * Phase 23.5 — Pháp Bảo Advanced Artifact System (foundation).
 *
 * API client cho FE Pháp Bảo panel. Equip vẫn dùng nguyên `/inventory/equip`;
 * refine/star-up/awaken dùng endpoint Phase 23.7 server-authoritative riêng.
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

export interface PhapBaoConsumedMaterial {
  itemKey: string;
  qty: number;
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

export interface PhapBaoUpgradeResult {
  item: PhapBaoView;
  cost: PhapBaoCostView;
  consumedMaterials: PhapBaoConsumedMaterial[];
  nextPreview: {
    refineCost: PhapBaoCostView | null;
    starCost: PhapBaoCostView | null;
    awakenCost: PhapBaoCostView | null;
  };
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

async function mutatePhapBao(
  inventoryItemId: string,
  action: 'star-up' | 'awaken' | 'refine',
): Promise<PhapBaoUpgradeResult> {
  const { data } = await apiClient.post<
    Envelope<{ phapBao: PhapBaoUpgradeResult }>
  >(`/character/phap-bao/${encodeURIComponent(inventoryItemId)}/${action}`);
  return unwrap(data).phapBao;
}

export async function starUpPhapBao(
  inventoryItemId: string,
): Promise<PhapBaoUpgradeResult> {
  return mutatePhapBao(inventoryItemId, 'star-up');
}

export async function awakenPhapBao(
  inventoryItemId: string,
): Promise<PhapBaoUpgradeResult> {
  return mutatePhapBao(inventoryItemId, 'awaken');
}

export async function refinePhapBao(
  inventoryItemId: string,
): Promise<PhapBaoUpgradeResult> {
  return mutatePhapBao(inventoryItemId, 'refine');
}
