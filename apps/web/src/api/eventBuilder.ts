/**
 * Phase 28.0 — Event Builder & Tier-Balanced LiveOps client.
 *
 * Wrap REST endpoints `/admin/events/*` + `/events/*`. Tách module riêng
 * để KHÔNG phình `admin.ts` (đã 1100+ dòng). Type re-use shared catalog —
 * không định nghĩa duplicate type cho EventDef/Bracket/...
 *
 * Upsert input ở client side dùng `Record<string, unknown>` để tránh trùng
 * lặp validator zod (server-authoritative). Form editor đầy đủ ở PR sau.
 */
import { apiClient } from './client';
import type {
  EventDef,
  EventStatus,
  EventType,
  EventBracketDef,
  EventBalancePolicy,
  EventItemDef,
  EventMissionDef,
  EventShopDef,
  EventShopItemDef,
  EventBossDef,
  EventRankingDef,
  EventValidationError,
  EventTemplate,
  PublicEventSummary,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; meta?: unknown };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined || env.data === null) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), {
      code: err.code,
      meta: err.meta,
    });
  }
  return env.data;
}

// ── Admin: catalog + templates ──────────────────────────────────────

export interface EventCatalog {
  statuses: readonly EventStatus[];
  types: readonly EventType[];
  bracketModes: readonly string[];
  missionTypes: readonly string[];
  bossTypes: readonly string[];
  rankingTypes: readonly string[];
  paidRewardPolicies: readonly string[];
  personalTriggerTypes: readonly string[];
  itemKinds: readonly string[];
  typesRequireBracketRanking: readonly EventType[];
}

export async function adminEventCatalog(): Promise<EventCatalog> {
  const { data } =
    await apiClient.get<Envelope<EventCatalog>>('/admin/events/catalog');
  return unwrap(data);
}

export async function adminListEventTemplates(): Promise<
  readonly EventTemplate[]
> {
  const { data } = await apiClient.get<Envelope<readonly EventTemplate[]>>(
    '/admin/events/templates',
  );
  return unwrap(data);
}

export async function adminGetEventTemplate(
  templateKey: string,
): Promise<EventTemplate> {
  const { data } = await apiClient.get<Envelope<EventTemplate>>(
    `/admin/events/templates/${encodeURIComponent(templateKey)}`,
  );
  return unwrap(data);
}

// ── Admin: event CRUD ──────────────────────────────────────────────

export interface AdminListEventsFilters {
  status?: EventStatus;
  eventType?: EventType;
  enabled?: boolean;
}

export type EventUpsertInput = Record<string, unknown> & { reason?: string };

export async function adminListEvents(
  filters: AdminListEventsFilters = {},
): Promise<EventDef[]> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.eventType) params.eventType = filters.eventType;
  if (filters.enabled !== undefined)
    params.enabled = filters.enabled ? 'true' : 'false';
  const { data } = await apiClient.get<Envelope<EventDef[]>>(
    '/admin/events',
    { params },
  );
  return unwrap(data);
}

export async function adminGetEvent(key: string): Promise<EventDef> {
  const { data } = await apiClient.get<Envelope<EventDef>>(
    `/admin/events/${encodeURIComponent(key)}`,
  );
  return unwrap(data);
}

export async function adminCreateEvent(
  input: EventUpsertInput,
): Promise<EventDef> {
  const { data } = await apiClient.post<Envelope<EventDef>>(
    '/admin/events',
    input,
  );
  return unwrap(data);
}

export async function adminUpdateEvent(
  key: string,
  input: EventUpsertInput,
): Promise<EventDef> {
  const { data } = await apiClient.post<Envelope<EventDef>>(
    `/admin/events/${encodeURIComponent(key)}`,
    input,
  );
  return unwrap(data);
}

export async function adminDeleteEvent(
  key: string,
  reason?: string,
): Promise<{ ok: true }> {
  const { data } = await apiClient.delete<Envelope<{ ok: true }>>(
    `/admin/events/${encodeURIComponent(key)}`,
    { data: { reason } },
  );
  return unwrap(data);
}

export interface EventTransitionInput {
  nextStatus: EventStatus;
  reason?: string;
}

export async function adminTransitionEvent(
  key: string,
  input: EventTransitionInput,
): Promise<EventDef> {
  const { data } = await apiClient.post<Envelope<EventDef>>(
    `/admin/events/${encodeURIComponent(key)}/transition`,
    input,
  );
  return unwrap(data);
}

export async function adminValidateEvent(
  input: EventUpsertInput,
): Promise<{ ok: boolean; errors: readonly EventValidationError[] }> {
  const { data } = await apiClient.post<
    Envelope<{ ok: boolean; errors: readonly EventValidationError[] }>
  >('/admin/events/validate', input);
  return unwrap(data);
}

// ── Admin: brackets + balance policy ───────────────────────────────

export async function adminListBrackets(
  eventKey: string,
): Promise<EventBracketDef[]> {
  const { data } = await apiClient.get<Envelope<EventBracketDef[]>>(
    `/admin/events/${encodeURIComponent(eventKey)}/brackets`,
  );
  return unwrap(data);
}

export async function adminUpsertBracket(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventBracketDef> {
  const { data } = await apiClient.post<Envelope<EventBracketDef>>(
    `/admin/events/${encodeURIComponent(eventKey)}/brackets`,
    input,
  );
  return unwrap(data);
}

export async function adminGetPolicy(
  eventKey: string,
): Promise<EventBalancePolicy | null> {
  const { data } = await apiClient.get<Envelope<EventBalancePolicy | null>>(
    `/admin/events/${encodeURIComponent(eventKey)}/policy`,
  );
  if (!data.ok) {
    const err = data.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), {
      code: err.code,
      meta: err.meta,
    });
  }
  return (data.data ?? null) as EventBalancePolicy | null;
}

export async function adminUpsertPolicy(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventBalancePolicy> {
  const { data } = await apiClient.post<Envelope<EventBalancePolicy>>(
    `/admin/events/${encodeURIComponent(eventKey)}/policy`,
    input,
  );
  return unwrap(data);
}

// ── Admin: missions / shops / bosses / rankings / items ────────────

export async function adminListMissions(
  eventKey: string,
): Promise<EventMissionDef[]> {
  const { data } = await apiClient.get<Envelope<EventMissionDef[]>>(
    `/admin/events/${encodeURIComponent(eventKey)}/missions`,
  );
  return unwrap(data);
}

export async function adminUpsertMission(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventMissionDef> {
  const { data } = await apiClient.post<Envelope<EventMissionDef>>(
    `/admin/events/${encodeURIComponent(eventKey)}/missions`,
    input,
  );
  return unwrap(data);
}

export async function adminListShops(
  eventKey: string,
): Promise<EventShopDef[]> {
  const { data } = await apiClient.get<Envelope<EventShopDef[]>>(
    `/admin/events/${encodeURIComponent(eventKey)}/shops`,
  );
  return unwrap(data);
}

export async function adminUpsertShop(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventShopDef> {
  const { data } = await apiClient.post<Envelope<EventShopDef>>(
    `/admin/events/${encodeURIComponent(eventKey)}/shops`,
    input,
  );
  return unwrap(data);
}

export async function adminUpsertShopItem(
  input: EventUpsertInput,
): Promise<EventShopItemDef> {
  const { data } = await apiClient.post<Envelope<EventShopItemDef>>(
    '/admin/events/shop-items',
    input,
  );
  return unwrap(data);
}

export async function adminListBosses(
  eventKey: string,
): Promise<EventBossDef[]> {
  const { data } = await apiClient.get<Envelope<EventBossDef[]>>(
    `/admin/events/${encodeURIComponent(eventKey)}/bosses`,
  );
  return unwrap(data);
}

export async function adminUpsertBoss(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventBossDef> {
  const { data } = await apiClient.post<Envelope<EventBossDef>>(
    `/admin/events/${encodeURIComponent(eventKey)}/bosses`,
    input,
  );
  return unwrap(data);
}

export async function adminListRankings(
  eventKey: string,
): Promise<EventRankingDef[]> {
  const { data } = await apiClient.get<Envelope<EventRankingDef[]>>(
    `/admin/events/${encodeURIComponent(eventKey)}/rankings`,
  );
  return unwrap(data);
}

export async function adminUpsertRanking(
  eventKey: string,
  input: EventUpsertInput,
): Promise<EventRankingDef> {
  const { data } = await apiClient.post<Envelope<EventRankingDef>>(
    `/admin/events/${encodeURIComponent(eventKey)}/rankings`,
    input,
  );
  return unwrap(data);
}

export async function adminFinalizeRanking(
  rankingKey: string,
  reason?: string,
): Promise<EventRankingDef> {
  const { data } = await apiClient.post<Envelope<EventRankingDef>>(
    `/admin/events/rankings/${encodeURIComponent(rankingKey)}/finalize`,
    { reason },
  );
  return unwrap(data);
}

export async function adminListItems(
  eventKey?: string,
): Promise<EventItemDef[]> {
  const params = eventKey ? { eventKey } : {};
  const { data } = await apiClient.get<Envelope<EventItemDef[]>>(
    '/admin/events/items',
    { params },
  );
  return unwrap(data);
}

export async function adminUpsertItem(
  input: EventUpsertInput,
): Promise<EventItemDef> {
  const { data } = await apiClient.post<Envelope<EventItemDef>>(
    '/admin/events/items',
    input,
  );
  return unwrap(data);
}

// ── Player ─────────────────────────────────────────────────────────

export async function playerListEvents(): Promise<{
  events: readonly PublicEventSummary[];
  characterId: string;
}> {
  const { data } = await apiClient.get<
    Envelope<{ events: readonly PublicEventSummary[]; characterId: string }>
  >('/events');
  return unwrap(data);
}

export async function playerGetEvent(key: string): Promise<{
  event: PublicEventSummary;
  brackets: readonly EventBracketDef[];
  policy: EventBalancePolicy | null;
  playerCtx: {
    bracket: EventBracketDef | null;
    bracketTier: number | null;
    rewardTier: number;
    tokenMultiplier: number;
    rankingEligible: boolean;
  };
  characterId: string;
}> {
  const { data } = await apiClient.get<
    Envelope<{
      event: PublicEventSummary;
      brackets: readonly EventBracketDef[];
      policy: EventBalancePolicy | null;
      playerCtx: {
        bracket: EventBracketDef | null;
        bracketTier: number | null;
        rewardTier: number;
        tokenMultiplier: number;
        rankingEligible: boolean;
      };
      characterId: string;
    }>
  >(`/events/${encodeURIComponent(key)}`);
  return unwrap(data);
}

export async function playerListMissions(eventKey: string): Promise<{
  definitions: readonly EventMissionDef[];
  progress: ReadonlyArray<{
    missionKey: string;
    progressValue: number;
    targetValue: number;
    completedAt: string | null;
    claimedAt: string | null;
  }>;
}> {
  const { data } = await apiClient.get<
    Envelope<{
      definitions: readonly EventMissionDef[];
      progress: ReadonlyArray<{
        missionKey: string;
        progressValue: number;
        targetValue: number;
        completedAt: string | null;
        claimedAt: string | null;
      }>;
    }>
  >(`/events/${encodeURIComponent(eventKey)}/missions`);
  return unwrap(data);
}

export async function playerClaimMission(
  eventKey: string,
  missionKey: string,
): Promise<{ ok: true; alreadyClaimed?: boolean }> {
  const { data } = await apiClient.post<
    Envelope<{ ok: true; alreadyClaimed?: boolean }>
  >(`/events/${encodeURIComponent(eventKey)}/missions/claim`, {
    missionKey,
  });
  return unwrap(data);
}

export async function playerListShopItems(
  shopKey: string,
): Promise<{ items: readonly EventShopItemDef[] }> {
  const { data } = await apiClient.get<
    Envelope<{ items: readonly EventShopItemDef[] }>
  >(`/events/shops/${encodeURIComponent(shopKey)}/items`);
  return unwrap(data);
}

export async function playerPurchaseShopItem(
  shopItemKey: string,
  qty = 1,
): Promise<{
  purchaseId: string;
  pricePaid: number;
  rewardJson: unknown;
}> {
  const { data } = await apiClient.post<
    Envelope<{ purchaseId: string; pricePaid: number; rewardJson: unknown }>
  >('/events/shops/purchase', { shopItemKey, qty });
  return unwrap(data);
}

export async function playerLeaderboard(
  rankingKey: string,
  bracketKey?: string,
): Promise<{
  entries: ReadonlyArray<{
    characterId: string;
    bracketKey: string | null;
    score: number;
    rank: number | null;
  }>;
}> {
  const params: Record<string, string> = {};
  if (bracketKey) params.bracketKey = bracketKey;
  const { data } = await apiClient.get<
    Envelope<{
      entries: ReadonlyArray<{
        characterId: string;
        bracketKey: string | null;
        score: number;
        rank: number | null;
      }>;
    }>
  >(`/events/rankings/${encodeURIComponent(rankingKey)}/leaderboard`, {
    params,
  });
  return unwrap(data);
}

export async function playerListPersonal(): Promise<{
  entries: ReadonlyArray<{
    id: string;
    eventKey: string;
    triggerType: string;
    triggerValue: number;
    expiresAt: string;
    claimedAt: string | null;
    completedAt: string | null;
  }>;
}> {
  const { data } = await apiClient.get<
    Envelope<{
      entries: ReadonlyArray<{
        id: string;
        eventKey: string;
        triggerType: string;
        triggerValue: number;
        expiresAt: string;
        claimedAt: string | null;
        completedAt: string | null;
      }>;
    }>
  >('/events/personal/list');
  return unwrap(data);
}

export async function playerClaimPersonal(
  rowId: string,
): Promise<{ ok: true; alreadyClaimed?: boolean }> {
  const { data } = await apiClient.post<
    Envelope<{ ok: true; alreadyClaimed?: boolean }>
  >(`/events/personal/${encodeURIComponent(rowId)}/claim`);
  return unwrap(data);
}
