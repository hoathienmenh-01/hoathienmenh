import type { ElementKey } from './combat';
import type { SpiritualRootGrade } from './spiritual-root';

/**
 * WebSocket frame protocol — file 04 §5.
 *   { type, payload, ts }
 */
export interface WsFrame<T = unknown> {
  type: WsEventType;
  payload: T;
  ts: number;
}

export type WsEventType =
  // server → client
  | 'state:update'
  | 'cultivate:tick'
  | 'body-cultivate:tick'
  | 'logs:append'
  | 'marquee'
  | 'chat:msg'
  | 'boss:spawn'
  | 'boss:update'
  | 'boss:end'
  | 'boss:defeated'
  | 'mail:new'
  | 'mission:progress'
  /**
   * Phase 15.3.B — LiveOps announcement broadcast channel. Payload là
   * `LiveOpsAnnouncementBroadcastPayload` (xem `liveops-announcement.ts`).
   * Server emit khi announcement transition SCHEDULED→ACTIVE / ACTIVE→ENDED.
   */
  | 'liveops:announcement'
  /**
   * Phase 15.3.B — LiveOps scheduled event broadcast channel. Payload là
   * `LiveOpsEventBroadcastPayload` (public-safe, KHÔNG bao gồm `configJson`
   * raw / `createdByAdminId`). Server emit khi event transition.
   */
  | 'liveops:event'
  /**
   * Phase 15.8 — Maintenance window status broadcast channel. Payload là
   * `MaintenanceBroadcastPayload` (public-safe, KHÔNG bao gồm `createdByAdminId`
   * hoặc audit metadata). Server emit khi window transition
   * `SCHEDULED→ACTIVE`, `ACTIVE→ENDED`, hoặc `*→DISABLED`. FE store nhận
   * event này thì update overlay tức thì — không cần đợi poll 30s.
   */
  | 'maintenance:status'
  /**
   * Phase 19.1 — Social System Foundation. Server emit khi private chat
   * message mới được gửi. Payload là `PrivateChatMessageRow` (shared
   * `social.ts`). Server fanout chỉ tới 2 thành viên thread qua
   * `RealtimeService.emitToUser`. KHÔNG broadcast.
   */
  | 'private-chat:msg'
  /**
   * Phase 19.1 — Group chat foundation. Server emit khi group chat
   * message mới được gửi. Payload là `GroupChatMessageRow`. Server
   * fanout tới mọi member của group qua `emitToUser` (loop server-side).
   * KHÔNG broadcast — non-member tuyệt đối không nhận event.
   */
  | 'group-chat:msg'
  /**
   * Phase 19.3 — Social Presence & Notification Center. Server emit
   * khi có notification mới (friend request, message, group invite,
   * report resolved, security alert). Payload là
   * `NotificationCreatedBroadcastPayload` (xem `notification.ts`).
   * Chỉ emit tới `userId` chủ notification qua
   * `RealtimeService.emitToUser`. KHÔNG broadcast public.
   */
  | 'notification:new'
  /**
   * Phase 19.3 — Sync bell badge unread count sau mark read /
   * mark all read. Payload là `NotificationUnreadCountBroadcastPayload`.
   * Server emit chỉ tới user thực hiện action.
   */
  | 'notification:unread-count'
  /**
   * Phase 19.3 — Presence update event. Server emit khi 1 user
   * connect (lần đầu — `activeConnections` 0→1) hoặc disconnect
   * (về 0). Payload là `PresenceUpdateBroadcastPayload`. Server
   * fanout chỉ tới friend của user changed (Phase 19.3 scope),
   * KHÔNG broadcast public.
   */
  | 'presence:update'
  /**
   * Phase 19.4 — Group/Party System Upgrade. Server emit khi party
   * metadata thay đổi (member join/leave, leader change, name update).
   * Payload là `PartyUpdatedBroadcastPayload`. Server fanout chỉ tới
   * member online của party — KHÔNG broadcast public, KHÔNG emit cho
   * user ngoài party.
   */
  | 'party:updated'
  /**
   * Phase 19.4 — Party invite mới được tạo. Payload là
   * `PartyInviteBroadcastPayload`. Server emit chỉ tới invitee user
   * (không leak tới party member khác).
   */
  | 'party:invite'
  /**
   * Phase 19.4 — Member mới join party. Payload là
   * `PartyMemberJoinedBroadcastPayload`. Server fanout tới mọi member
   * online (kể cả user vừa join).
   */
  | 'party:member-joined'
  /**
   * Phase 19.4 — Member rời party (leave, kick, hoặc disband cascade).
   * Payload là `PartyMemberLeftBroadcastPayload`. Server emit tới
   * member còn lại + user vừa rời (để FE biết clear local state).
   */
  | 'party:member-left'
  /**
   * Phase 19.4 — Leadership chuyển sang member khác. Payload là
   * `PartyLeaderChangedBroadcastPayload`. Server fanout tới mọi member
   * online của party.
   */
  | 'party:leader-changed'
  /**
   * Phase 20.1 — Party Dungeon Co-op PvE Foundation. Server emit khi
   * trạng thái room thay đổi (member join/leave, ready change, status
   * transition). Payload là `PartyDungeonRoomUpdatedBroadcastPayload`.
   * Server fanout CHỈ tới participant của room (snapshot lúc emit).
   * KHÔNG emit cho party member chưa join room, KHÔNG broadcast public.
   */
  | 'party-dungeon:room-updated'
  /**
   * Phase 20.1 — Một participant toggle ready. Payload là
   * `PartyDungeonReadyUpdatedBroadcastPayload`. Server fanout tới
   * participant của room.
   */
  | 'party-dungeon:ready-updated'
  /**
   * Phase 20.1 — Leader trigger start → server tạo `PartyDungeonRun`.
   * Payload là `PartyDungeonStartedBroadcastPayload`. Server fanout
   * tới participant.
   */
  | 'party-dungeon:started'
  /**
   * Phase 20.1 — Run resolve (CLEAR/FAIL/CANCELED). Payload là
   * `PartyDungeonCompletedBroadcastPayload`. Server fanout tới
   * participant.
   */
  | 'party-dungeon:completed'
  /**
   * Phase 20.1 — Reward claim row sẵn sàng cho 1 participant. Payload
   * là `PartyDungeonRewardAvailableBroadcastPayload`. Server emit
   * CHỈ tới user owner của claim (không leak tới member khác).
   */
  | 'party-dungeon:reward-available'
  /**
   * Phase 20.2 — Co-op Boss Party Contribution. Server emit khi run
   * state thay đổi (member join/leave, status transition). Payload là
   * `CoopBossRunUpdatedBroadcastPayload`. Server fanout CHỈ tới
   * participant của run (snapshot lúc emit) — không broadcast public.
   */
  | 'coop-boss:run-updated'
  /**
   * Phase 20.2 — Một participant cập nhật contribution (damage /
   * support / survival). Payload là `CoopBossContributionUpdatedBroadcastPayload`.
   * Server fanout tới participant của run.
   */
  | 'coop-boss:contribution-updated'
  /**
   * Phase 20.2 — Run resolve (CLEARED/FAILED). Payload là
   * `CoopBossFinishedBroadcastPayload`. Server fanout tới participant.
   */
  | 'coop-boss:finished'
  /**
   * Phase 20.2 — Reward claim row sẵn sàng cho 1 participant. Payload
   * là `CoopBossRewardAvailableBroadcastPayload`. Server emit CHỈ tới
   * user owner của claim (không leak cross-party).
   */
  | 'coop-boss:reward-available'
  /**
   * Phase 44.1 — Daily Encounter / Kỳ Ngộ realtime banner. Server emit khi
   * rare/hidden encounter được generate trong `DailyEncounterService.ensureTodayRow`.
   * Payload: { encounterKey, rarity, dateKey, titleVi }.
   */
  | 'encounter:new'
  | 'pong'
  // client → server
  | 'ping'
  | 'chat:send';

export interface CharacterStatePayload {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  level: number;
  exp: string;
  expNext: string;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  stamina: number;
  staminaMax: number;
  power: number;
  spirit: number;
  speed: number;
  luck: number;
  linhThach: string;
  tienNgoc: number;
  tienNgocKhoa?: number;
  cultivating: boolean;
  sectId: string | null;
  sectKey: 'thanh_van' | 'huyen_thuy' | 'tu_la' | null;
  role: 'PLAYER' | 'MOD' | 'ADMIN';
  banned: boolean;
  /**
   * Phase 11.6.E — Tribulation cooldown timestamp (ISO 8601). Set khi
   * `attemptTribulation` FAIL → block retry tới khi `now >= tribulationCooldownAt`.
   * `null` khi chưa từng FAIL hoặc đã expired/cleared. Server vẫn re-validate
   * trên `POST /character/tribulation` — FE chỉ dùng để gate UI countdown.
   */
  tribulationCooldownAt: string | null;
  /**
   * Phase 11.6.E — Tâm Ma debuff active timestamp (ISO 8601). Set khi
   * `attemptTribulation` FAIL + RNG roll dưới `taoMaDebuffChance`.
   * `null` khi chưa từng kích hoạt hoặc đã expired. Phase 11.8 (Buff
   * runtime) sẽ áp modifier vào combat — MVP chỉ persist + audit.
   */
  taoMaUntil: string | null;
  /**
   * Phase 11.3.A — Linh căn / Spiritual Root state (mirror Prisma column).
   * `null` cho legacy character pre-Phase-11.3 chưa lazy-roll lần đầu —
   * `SpiritualRootService.getState()` (endpoint riêng `/api/character/spiritual-root`)
   * sẽ auto-roll khi đọc lần đầu. FE có thể dùng cờ này để render placeholder
   * trước khi gọi endpoint detail.
   *
   * Phase 11.6.C — wire vào tribulation kiếp resist multiplier (xem
   * `computeSpiritualRootTribulationResist`); FE display để player biết
   * primary/secondary element trước khi attempt tribulation.
   */
  spiritualRootGrade: SpiritualRootGrade | null;
  /** Primary element (Ngũ Hành). `null` nếu chưa onboard linh căn. */
  primaryElement: ElementKey | null;
  /**
   * Secondary elements (subset Ngũ Hành), array có thể empty cho `pham` grade
   * hoặc legacy character. Order khớp Prisma column (insertion order, không
   * canonical sort).
   */
  secondaryElements: ElementKey[];
  /**
   * Linh căn purity 0-100 — dùng cho Phase 11.3.B refine/reroll cost trong
   * tương lai. Default 100 cho legacy + freshly-rolled root.
   */
  rootPurity: number;
  /**
   * Phase 11.9.C — equipped title key (single-slot cosmetic display). `null`
   * khi character chưa equip title nào hoặc đã unequip (mặc định cho character
   * mới chưa unlock title milestone). Server nguồn duy nhất; FE chỉ render
   * — không tự set field này. Keys reference `TITLES` catalog ở
   * `packages/shared/src/titles.ts`.
   */
  title: string | null;
  bodyRealmKey: string;
  bodyRealmName: string;
  bodyStage: number;
  bodyExp: string;
  bodyExpNext: string;
  bodyRate: number;
  bodyCultivating: boolean;
  bodyInjuryUntil: string | null;
  physiqueKey: string | null;
  bodyStatBonus: {
    hpMax: number;
    power: number;
    def: number;
    staminaMax: number;
    bossDamageReduction: number;
  };
}

export interface CultivateTickPayload {
  characterId: string;
  expGained: string;
  exp: string;
  expNext: string;
  realmKey: string;
  realmStage: number;
  brokeThrough: boolean;
}

export interface BodyCultivateTickPayload {
  characterId: string;
  expGained: string;
  bodyExp: string;
  bodyExpNext: string;
  bodyRealmKey: string;
  bodyStage: number;
  stagedUp: boolean;
}

export const WS_HEARTBEAT_INTERVAL_MS = 25_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 8_000;
export const WS_RECONNECT_MAX_DELAY_MS = 30_000;
export const WS_RECONNECT_MAX_ATTEMPTS = 10;

export const CULTIVATION_TICK_MS = 30_000;
export const CULTIVATION_TICK_BASE_EXP = 5;

/**
 * Push throttle khi emit `mission:progress`. Mỗi user nhận tối đa 1 frame
 * trong cửa sổ này — frame thừa bị drop để tránh spam khi nhiều mission
 * được increment liên tiếp (vd cultivation tick + boss attack hit cùng giây).
 */
export const MISSION_PROGRESS_PUSH_THROTTLE_MS = 500;

/**
 * Payload của event `mission:progress`. Mỗi frame là một snapshot delta
 * những mission vừa được track (currentAmount tăng) cho 1 character.
 * FE merge vào store để cập nhật UI mà không cần refetch full list.
 */
export interface MissionProgressFramePayload {
  characterId: string;
  changes: MissionProgressChange[];
}

export interface MissionProgressChange {
  missionKey: string;
  /** 'DAILY' | 'WEEKLY' | 'ONCE' (giữ string để shared không phụ thuộc Prisma). */
  period: string;
  currentAmount: number;
  goalAmount: number;
  /** `currentAmount >= goalAmount && !claimed`. */
  completable: boolean;
}
