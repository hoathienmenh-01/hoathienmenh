/**
 * Phase 19.1.C — Public Player Profile / Inspect Player
 *
 * Shared types cho hệ thống xem hồ sơ công khai của người chơi khác.
 * Cùng pattern với `social.ts` (server-authoritative, deterministic,
 * no runtime dependency, FE chỉ dùng constant + DTO để render).
 *
 * Privacy invariants (server enforce, KHÔNG bao giờ trả về client):
 *   - email
 *   - raw role admin/mod (chỉ flag boolean `isAdmin`)
 *   - currency balance (linhThach / tienNgoc / tienTe / nguyenThach)
 *   - inventory chi tiết
 *   - topup / payment / ledger
 *   - session / refresh token / ipHash
 *   - security flag nội bộ (banned status, anti-cheat flag)
 *   - private messages
 *
 * Visibility matrix (server enforce theo `RelationshipStatus`):
 *   - SELF                       → full public fields.
 *   - FRIEND                     → full public fields + online flag (nếu hệ thống có realtime).
 *   - PENDING_INCOMING/OUTGOING  → full public fields.
 *   - BLOCKED_BY_ME              → minimal (id + displayName + relationship)
 *                                 để FE render unblock UI; KHÔNG leak realm/sect/power.
 *   - BLOCKED_ME                 → 404 mask (server pretend user không tồn tại để chống
 *                                 enumeration probe "ai đã block tôi").
 *   - STRANGER                   → full public fields.
 */

/**
 * Trạng thái quan hệ giữa `viewer` và `target`.
 *
 * - `SELF`: viewer xem chính mình.
 * - `FRIEND`: 2 chiều đã là bạn (có row `Friendship`).
 * - `PENDING_INCOMING`: target đã gửi friend request → viewer (viewer chưa accept).
 * - `PENDING_OUTGOING`: viewer đã gửi friend request → target (target chưa accept).
 * - `BLOCKED_BY_ME`: viewer đã block target.
 * - `BLOCKED_ME`: target đã block viewer. Endpoint mask 404 thay vì trả status này
 *                  để chống enumeration. Status này KHÔNG bao giờ xuất hiện trong
 *                  response thực tế — chỉ dùng nội bộ ở service trước khi mask.
 * - `STRANGER`: không có quan hệ nào.
 */
export const RELATIONSHIP_STATUSES = [
  'SELF',
  'FRIEND',
  'PENDING_INCOMING',
  'PENDING_OUTGOING',
  'BLOCKED_BY_ME',
  'BLOCKED_ME',
  'STRANGER',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

/** Type guard cho RelationshipStatus. */
export function isRelationshipStatus(v: unknown): v is RelationshipStatus {
  return (
    typeof v === 'string' &&
    (RELATIONSHIP_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Hành động khả dụng cho viewer trên profile target. Server tính
 * dựa trên `RelationshipStatus` + invariants nghiệp vụ; FE KHÔNG
 * tự suy luận để tránh đụng race condition (vd. block sau ack).
 *
 * Ma trận:
 *
 * | Status            | canSendFriendRequest | canMessage | canBlock | canReport |
 * |-------------------|----------------------|------------|----------|-----------|
 * | SELF              | false                | false      | false    | false     |
 * | FRIEND            | false                | true       | true     | true      |
 * | PENDING_INCOMING  | false                | false      | true     | true      |
 * | PENDING_OUTGOING  | false                | false      | true     | true      |
 * | BLOCKED_BY_ME     | false                | false      | false    | false     |
 * | STRANGER          | true                 | true       | true     | true      |
 *
 * Note: `BLOCKED_ME` không xuất hiện trong response (404 mask).
 */
export interface ProfileActionAvailability {
  /** Có thể gửi friend request mới (tức là chưa friend, chưa pending, chưa block 2 chiều). */
  canSendFriendRequest: boolean;
  /** Có thể nhắn tin riêng (chưa block 2 chiều). */
  canMessage: boolean;
  /** Có thể block target (chưa block target + không phải self). */
  canBlock: boolean;
  /** Có thể report target (không phải self + không đã block 2 chiều). */
  canReport: boolean;
}

/**
 * Snapshot công khai của Character — server populate. Số liệu
 * derived (power score, fullRealmName) tính ở server-side ngay khi
 * trả về, KHÔNG để FE tự tính.
 *
 * Các field cấm tuyệt đối: currency balance, inventory, ledger,
 * payment, security flag, role admin raw, IP, session.
 */
export interface PublicCharacterSummaryDto {
  /** `Character.name` — unique handle hiển thị. */
  characterName: string;
  /** Realm key (key technical, vd. `pham_nhan`, `luyen_khi`). FE map ra display. */
  realmKey: string;
  /** Stage trong realm (1..N). */
  realmStage: number;
  /** Full realm name + stage (vd. "Phàm Nhân — Tầng 3"). Server compute từ
   *  `fullRealmName(realm, stage)` ở shared catalog. */
  realmFullName: string;
  /** Level numeric (Phase 19.1.C dùng `Character.level` raw). */
  level: number;
  /** Title hiện hành (vd. "Lò Luyện Đan Tôn"). Null nếu chưa có. */
  title: string | null;
  /**
   * Power score derived: `power + spirit + speed` (Phase 19.1.C).
   * Phase sau có battlePower riêng thì sẽ thay; hiện tại đây là
   * snapshot lực chiến đơn giản đủ cho compare-and-judge.
   */
  powerScore: number;
  /** Sect id (null nếu vô môn vô phái). */
  sectId: string | null;
  /** Sect name resolved (null nếu vô môn). */
  sectName: string | null;
}

/**
 * Public profile của 1 player. KHÔNG bao giờ chứa email / role /
 * currency / inventory / payment / session / IP.
 *
 * Khi `relationshipStatus = 'BLOCKED_BY_ME'`, `character` = null
 * (chỉ giữ id + displayName để FE render UI unblock). Khi
 * `BLOCKED_ME`, endpoint mask 404 thay vì trả profile này.
 */
export interface PublicPlayerProfileDto {
  /** User id của target. KHÔNG phải secret — đã hiển thị trong friend list. */
  userId: string;
  /** Display name = `Character.name` (KHÔNG dùng email). Null nếu user chưa
   *  tạo character (case hiếm — user mới đăng ký xong chưa hoàn tất setup). */
  displayName: string | null;
  /** Trạng thái quan hệ với viewer. Server tính atomic. */
  relationshipStatus: RelationshipStatus;
  /** Hành động khả dụng. Server compute từ `relationshipStatus`. */
  actions: ProfileActionAvailability;
  /**
   * Character public snapshot. NULL khi:
   *   - target chưa tạo character;
   *   - viewer đã block target (`BLOCKED_BY_ME`) — minimal profile.
   */
  character: PublicCharacterSummaryDto | null;
  /**
   * Online flag. Server-derived. Phase 19.1.C giữ `false` mặc định
   * cho mọi case (giống `listFriends`); follow-up phase sẽ wire
   * realtime presence. Optional để cho phép extend.
   */
  online: boolean;
  /**
   * Joined timestamp (createdAt của User). Format `YYYY-MM` (chỉ
   * tháng/năm — chống fingerprint timing). Null khi BLOCKED_BY_ME.
   */
  joinedYearMonth: string | null;
  /**
   * Mutual friend count với viewer. Phase 19.1.C optional — chỉ
   * tính khi target là STRANGER hoặc PENDING (giúp UX "bạn chung").
   * Null khi SELF / BLOCKED_BY_ME.
   */
  mutualFriendCount: number | null;
  /**
   * Same-sect flag — true nếu viewer và target cùng sect. Null khi
   * SELF / BLOCKED_BY_ME / target chưa có character. Tính rẻ (1
   * compare).
   */
  sameSect: boolean | null;
}

/** Public envelope cho `GET /social/profile/:userId`. */
export interface PublicPlayerProfileResponse {
  profile: PublicPlayerProfileDto;
}

/**
 * Build `ProfileActionAvailability` từ `RelationshipStatus`. Pure
 * function — test-friendly, deterministic. KHÔNG dùng cho
 * `BLOCKED_ME` (endpoint mask 404 trước khi gọi tới đây).
 */
export function computeProfileActions(
  status: RelationshipStatus,
): ProfileActionAvailability {
  switch (status) {
    case 'SELF':
      return {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      };
    case 'FRIEND':
      return {
        canSendFriendRequest: false,
        canMessage: true,
        canBlock: true,
        canReport: true,
      };
    case 'PENDING_INCOMING':
    case 'PENDING_OUTGOING':
      return {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: true,
        canReport: true,
      };
    case 'BLOCKED_BY_ME':
      // Viewer đã block target — KHÔNG action gì ngoài unblock. Unblock
      // dùng `DELETE /social/block/:userId` (Phase 19.1). FE đọc
      // `canBlock=false` + `relationshipStatus=BLOCKED_BY_ME` để render
      // nút "Bỏ chặn".
      return {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      };
    case 'BLOCKED_ME':
      // Defensive — endpoint không nên trả status này (404 mask).
      return {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      };
    case 'STRANGER':
      return {
        canSendFriendRequest: true,
        canMessage: true,
        canBlock: true,
        canReport: true,
      };
    default: {
      // Exhaustive check.
      const _exhaustive: never = status;
      void _exhaustive;
      return {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      };
    }
  }
}

/**
 * Format `Date` → `YYYY-MM` chuỗi cho `joinedYearMonth`. Pure
 * function — test deterministic.
 */
export function formatJoinedYearMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 0-based
  return `${y}-${m.toString().padStart(2, '0')}`;
}

/**
 * Tính power score từ stats Character. Phase 19.1.C dùng simple
 * sum `power + spirit + speed` — không cần điểm gì equip-aware
 * vì chỉ là snapshot để player so sánh nhanh. Phase sau có
 * battlePower riêng sẽ thay.
 */
export function computePowerScore(stats: {
  power: number;
  spirit: number;
  speed: number;
}): number {
  return stats.power + stats.spirit + stats.speed;
}
