/**
 * Phase 30.0 — Market V2 API client (player + admin).
 *
 * Wrap REST endpoints `/market-v2/*` (player) + `/admin/market-v2/*`
 * (admin). Phase 30 chỉ cover Auction House + Claim Box; FIXED_PRICE
 * vẫn dùng `market.ts` cũ (legacy listing).
 */
import { apiClient } from './client';
import type { MarketCurrency } from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface MarketAuctionRow {
  id: string;
  sellerCharacterId: string;
  itemKey: string;
  quantity: number;
  currency: MarketCurrency;
  startPrice: string;
  buyoutPrice: string | null;
  minBidStep: string;
  currentBid: string | null;
  currentBidderId: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  finalizedAt: string | null;
  taxAmount: string | null;
}

export interface ClaimBoxRow {
  id: string;
  source: string;
  sourceRefId: string | null;
  itemKey: string | null;
  itemQty: number | null;
  currency: string | null;
  amount: string | null;
  status: string;
  expiresAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface PriceSnapshotRow {
  itemKey: string;
  avgPrice24h: string;
  avgPrice7d: string;
  avgPrice30d: string;
  minPrice: string;
  maxPrice: string;
  volume24h: number;
  volume7d: number;
  updatedAt: string;
}

// ── Player ─────────────────────────────────────────────────────────────

export async function listAuctions(itemKey?: string): Promise<MarketAuctionRow[]> {
  const qs = itemKey ? `?itemKey=${encodeURIComponent(itemKey)}` : '';
  const { data } = await apiClient.get<Envelope<MarketAuctionRow[]>>(
    `/market-v2/auctions${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'MARKET_LIST_FAIL');
  return data.data;
}

export async function getAuction(id: string): Promise<MarketAuctionRow | null> {
  const { data } = await apiClient.get<Envelope<MarketAuctionRow | null>>(
    `/market-v2/auctions/${id}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'MARKET_GET_FAIL');
  return data.data ?? null;
}

export async function createAuction(input: {
  itemKey: string;
  quantity: number;
  currency: MarketCurrency;
  startPrice: number;
  minBidStep: number;
  buyoutPrice?: number;
  durationMinutes: number;
}): Promise<MarketAuctionRow> {
  const { data } = await apiClient.post<Envelope<MarketAuctionRow>>(
    '/market-v2/auctions',
    input,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'MARKET_CREATE_FAIL');
  return data.data;
}

export async function placeBid(input: {
  auctionId: string;
  bidAmount: number;
}): Promise<unknown> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/market-v2/auctions/${input.auctionId}/bid`,
    { bidAmount: input.bidAmount },
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'MARKET_BID_FAIL');
  return data.data;
}

export async function cancelAuction(auctionId: string): Promise<void> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/market-v2/auctions/${auctionId}/cancel`,
    {},
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'MARKET_CANCEL_FAIL');
}

export async function listClaimBox(status?: string): Promise<ClaimBoxRow[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const { data } = await apiClient.get<Envelope<ClaimBoxRow[]>>(`/market-v2/claim-box${qs}`);
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CLAIM_BOX_LIST_FAIL');
  return data.data;
}

export async function claimEntry(id: string): Promise<ClaimBoxRow | null> {
  const { data } = await apiClient.post<Envelope<ClaimBoxRow | null>>(
    `/market-v2/claim-box/${id}/claim`,
    {},
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'CLAIM_BOX_CLAIM_FAIL');
  return data.data ?? null;
}

export async function getPriceSnapshot(itemKey: string): Promise<PriceSnapshotRow | null> {
  const { data } = await apiClient.get<Envelope<PriceSnapshotRow | null>>(
    `/market-v2/prices/${encodeURIComponent(itemKey)}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'MARKET_PRICE_FAIL');
  return data.data ?? null;
}

// ── Admin ──────────────────────────────────────────────────────────────

export async function adminListAuctions(opts: { status?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<MarketAuctionRow[]>>(
    `/admin/market-v2/auctions${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'ADMIN_MARKET_LIST_FAIL');
  return data.data;
}

export async function adminCancelAuction(id: string, reason: string): Promise<void> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/market-v2/auctions/${id}/cancel`,
    { reason },
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'ADMIN_MARKET_CANCEL_FAIL');
}

export async function adminRefundClaim(input: {
  characterId: string;
  itemKey?: string;
  itemQty?: number;
  currency?: string;
  amount?: number;
  reason: string;
}): Promise<ClaimBoxRow> {
  const { data } = await apiClient.post<Envelope<ClaimBoxRow>>(
    '/admin/market-v2/refund',
    input,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'ADMIN_REFUND_FAIL');
  return data.data;
}

export async function adminFinalizeExpired(): Promise<{ finalized: number; candidates: number }> {
  const { data } = await apiClient.post<
    Envelope<{ finalized: number; candidates: number }>
  >('/admin/market-v2/auctions/finalize-due', {});
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'ADMIN_FINALIZE_FAIL');
  return data.data;
}
