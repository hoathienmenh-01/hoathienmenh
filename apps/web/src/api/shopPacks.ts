import { apiClient } from './client';

export interface ShopPackReward {
  kind: 'currency' | 'item' | 'cosmetic';
  key: string;
  qty: number;
}

export interface ShopPackView {
  packId: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: string;
  priceCurrency: string;
  priceAmount: number;
  purchaseLimit: number;
  purchaseLimitWindow: string;
  requiredRealmOrder?: number;
  maxRealmOrder?: number;
  vipRequired?: number;
  rewards: ShopPackReward[];
  startsAt?: string;
  endsAt?: string;
  active: boolean;
  tags: string[];
  remainingPurchases: number;
}

export interface ShopPackPurchaseResult {
  purchaseId: string;
  packId: string;
  rewards: ShopPackReward[];
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function getShopPacks(): Promise<ShopPackView[]> {
  const { data } = await apiClient.get<Envelope<ShopPackView[]>>('/shop-packs');
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to load shop packs');
  return data.data;
}

export async function purchaseShopPack(
  packId: string,
  idempotencyKey?: string,
): Promise<ShopPackPurchaseResult> {
  const { data } = await apiClient.post<Envelope<ShopPackPurchaseResult>>(
    '/shop-packs/purchase',
    { packId, idempotencyKey },
  );
  if (!data.ok || !data.data) throw data.error ?? new Error('Purchase failed');
  return data.data;
}
