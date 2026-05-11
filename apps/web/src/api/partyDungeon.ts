/**
 * Phase 20.1 — Party Dungeon Co-op PvE Foundation REST client.
 *
 * Endpoints khớp `apps/api/src/modules/party-dungeon/party-dungeon.controller.ts`:
 *   - GET  /party/dungeon/room                       → my active room
 *   - GET  /party/dungeon/runs/:id                   → run detail (participant only)
 *   - POST /party/dungeon/rooms        { dungeonKey } → leader create room
 *   - POST /party/dungeon/join         { roomId }     → member join from party
 *   - POST /party/dungeon/ready        { roomId }     → set ready
 *   - POST /party/dungeon/unready      { roomId }     → cancel ready
 *   - POST /party/dungeon/start        { roomId }     → leader start (auto-resolve)
 *   - POST /party/dungeon/cancel       { roomId }     → leader cancel
 *   - POST /party/dungeon/runs/:id/claim-reward      → member claim
 *
 * Response server bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` để FE catch theo code (vd
 * NOT_PARTY_LEADER, REWARD_ALREADY_CLAIMED) → render i18n.
 */
import type {
  MyPartyDungeonRoomResponse,
  PartyDungeonRewardClaimDto,
  PartyDungeonRunDetailResponse,
} from '@xuantoi/shared';
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function getMyPartyDungeonRoom(): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.get<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/room',
  );
  return unwrap(data);
}

export async function getPartyDungeonRunDetail(
  runId: string,
): Promise<PartyDungeonRunDetailResponse> {
  const { data } = await apiClient.get<Envelope<PartyDungeonRunDetailResponse>>(
    `/party/dungeon/runs/${encodeURIComponent(runId)}`,
  );
  return unwrap(data);
}

export async function createPartyDungeonRoom(
  dungeonKey: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/rooms',
    { dungeonKey },
  );
  return unwrap(data);
}

export async function joinPartyDungeonRoom(
  roomId: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/join',
    { roomId },
  );
  return unwrap(data);
}

export async function setPartyDungeonReady(
  roomId: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/ready',
    { roomId },
  );
  return unwrap(data);
}

export async function cancelPartyDungeonReady(
  roomId: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/unready',
    { roomId },
  );
  return unwrap(data);
}

export async function startPartyDungeonRun(
  roomId: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/start',
    { roomId },
  );
  return unwrap(data);
}

export async function cancelPartyDungeonRoom(
  roomId: string,
): Promise<MyPartyDungeonRoomResponse> {
  const { data } = await apiClient.post<Envelope<MyPartyDungeonRoomResponse>>(
    '/party/dungeon/cancel',
    { roomId },
  );
  return unwrap(data);
}

export async function claimPartyDungeonReward(
  runId: string,
): Promise<{ claim: PartyDungeonRewardClaimDto }> {
  const { data } = await apiClient.post<
    Envelope<{ claim: PartyDungeonRewardClaimDto }>
  >(`/party/dungeon/runs/${encodeURIComponent(runId)}/claim-reward`);
  return unwrap(data);
}
