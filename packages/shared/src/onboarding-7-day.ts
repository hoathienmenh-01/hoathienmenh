/**
 * Phase 34.0 — 7-Day Onboarding Questline Catalog.
 *
 * Mục tiêu: dạy người chơi mới các hệ thống chính trong 7 ngày, không bị
 * ngợp. Mỗi ngày có 3-5 task nhỏ, mỗi task tự-acknowledge (player click
 * `complete` sau khi đã thực hiện hành động — KHÔNG hook auto-track vào
 * combat / cultivation / story service trong PR này để tránh đụng Phase
 * 12/33 path).
 *
 * Unlock rule:
 *   - Day 1 luôn AVAILABLE từ thời điểm character được tạo.
 *   - Day N (N≥2) AVAILABLE khi tất cả task của Day N-1 đã COMPLETED
 *     (không cần CLAIMED — player có thể chậm claim mà vẫn unlock tiếp).
 *
 * Reward cap:
 *   - Linh thạch theo từng task nhỏ (50-300 LT).
 *   - Day 7 summary reward = title bind (cosmetic only, KHÔNG cộng power).
 *   - KHÔNG mint Tien Ngoc.
 *   - KHÔNG grant endgame item.
 *
 * Idempotency:
 *   - Mỗi task complete/claim CAS guard via `updateMany({status:'AVAILABLE'})`
 *     → `COMPLETED` / `CLAIMED`. Re-call sau khi đã CLAIMED trả về current
 *     state, KHÔNG cộng reward.
 */

export type OnboardingTaskStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'COMPLETED'
  | 'CLAIMED';

export type OnboardingDayStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export interface OnboardingTaskRewardDef {
  /** Linh thạch cộng khi claim. 0 = không cộng. */
  linhThach: number;
  /** Exp cộng (small). 0 = không cộng. */
  exp: number;
  /**
   * Item grant tuỳ chọn. Bind = true nếu là quest/important item.
   * KHÔNG grant endgame item — vẫn enforce qua `FORBIDDEN_REWARD_ITEM_KEYS`.
   */
  items?: Array<{ itemKey: string; qty: number; bind: boolean }>;
  /**
   * Title key tuỳ chọn — chỉ Day 7 final task có title cosmetic.
   */
  titleKey?: string;
}

export interface OnboardingTaskDef {
  /** Unique key, format `d{N}_<slug>`. */
  taskKey: string;
  /** Ngày 1-7 mà task thuộc về. */
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  /**
   * Route gợi ý FE nên redirect khi player click `actionRoute` link
   * (ví dụ `/cultivation`, `/dungeon`, `/story-v2`, `/sect`).
   * KHÔNG bắt buộc — FE có thể bỏ qua.
   */
  actionRoute: string;
  /**
   * UI hint — tag ngắn (≤ 12 ký tự) hiển thị bên cạnh task.
   */
  category: 'tutorial' | 'cultivation' | 'combat' | 'story' | 'social' | 'system';
  reward: OnboardingTaskRewardDef;
}

export interface OnboardingDayDef {
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  taskKeys: string[];
}

// =============================================================================
// CATALOG — 7 days × 3-5 tasks/day = 26 tasks total.
// =============================================================================

export const ONBOARDING_TASKS: OnboardingTaskDef[] = [
  // ---------- Day 1 — Khởi đầu (5 tasks) ----------
  {
    taskKey: 'd1_claim_daily_login',
    dayNumber: 1,
    titleVi: 'Nhận thưởng điểm danh',
    titleEn: 'Claim daily login',
    descriptionVi:
      'Mở trang điểm danh hàng ngày và nhận phần thưởng linh thạch đầu tiên.',
    descriptionEn:
      'Open the daily login page and claim your first linh thạch reward.',
    actionRoute: '/daily-login',
    category: 'tutorial',
    reward: { linhThach: 100, exp: 0 },
  },
  {
    taskKey: 'd1_open_inventory',
    dayNumber: 1,
    titleVi: 'Mở túi đồ',
    titleEn: 'Open inventory',
    descriptionVi:
      'Khám phá túi đồ — nơi quản lý trang bị, pháp bảo, và vật phẩm tu luyện.',
    descriptionEn:
      'Explore your inventory — where you manage equipment, artifacts, and cultivation materials.',
    actionRoute: '/inventory',
    category: 'tutorial',
    reward: { linhThach: 50, exp: 0 },
  },
  {
    taskKey: 'd1_first_cultivation',
    dayNumber: 1,
    titleVi: 'Bắt đầu tu luyện',
    titleEn: 'Begin cultivation',
    descriptionVi:
      'Vào trang tu luyện, kích hoạt tu luyện idle để tích lũy kinh nghiệm theo thời gian.',
    descriptionEn:
      'Go to the cultivation page and activate idle cultivation to accumulate EXP over time.',
    actionRoute: '/cultivation',
    category: 'cultivation',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd1_view_quest',
    dayNumber: 1,
    titleVi: 'Xem nhật ký nhiệm vụ',
    titleEn: 'Check quest journal',
    descriptionVi:
      'Mở nhật ký nhiệm vụ để biết tu sĩ mới nên làm gì tiếp theo.',
    descriptionEn:
      'Open the quest journal to see what a new cultivator should do next.',
    actionRoute: '/quest',
    category: 'tutorial',
    reward: { linhThach: 50, exp: 0 },
  },
  {
    taskKey: 'd1_finish_tutorial_quest',
    dayNumber: 1,
    titleVi: 'Hoàn thành nhiệm vụ giới thiệu',
    titleEn: 'Finish intro quest',
    descriptionVi:
      'Hoàn thành nhiệm vụ giới thiệu đầu tiên trong nhật ký nhiệm vụ.',
    descriptionEn: 'Finish the first intro quest in your quest journal.',
    actionRoute: '/quest',
    category: 'tutorial',
    reward: { linhThach: 200, exp: 100 },
  },

  // ---------- Day 2 — Tu luyện cơ bản (4 tasks) ----------
  {
    taskKey: 'd2_check_realm',
    dayNumber: 2,
    titleVi: 'Tìm hiểu cảnh giới',
    titleEn: 'Understand realm tiers',
    descriptionVi:
      'Mở trang nhân vật và xem cảnh giới hiện tại + cảnh giới kế tiếp.',
    descriptionEn:
      'Open your character page and view your current and next realm tier.',
    actionRoute: '/profile',
    category: 'cultivation',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd2_equip_weapon',
    dayNumber: 2,
    titleVi: 'Trang bị vũ khí',
    titleEn: 'Equip a weapon',
    descriptionVi: 'Vào túi đồ và trang bị vũ khí đầu tiên để tăng sức mạnh.',
    descriptionEn:
      'Go to your inventory and equip your first weapon to boost combat power.',
    actionRoute: '/inventory',
    category: 'combat',
    reward: { linhThach: 150, exp: 50 },
  },
  {
    taskKey: 'd2_check_spiritual_root',
    dayNumber: 2,
    titleVi: 'Xem linh căn',
    titleEn: 'Check your spiritual root',
    descriptionVi:
      'Mở trang linh căn để biết thiên phú ngũ hành của tu sĩ.',
    descriptionEn:
      'Open the spiritual root page to learn your ngũ hành elemental affinity.',
    actionRoute: '/spiritual-root',
    category: 'cultivation',
    reward: { linhThach: 100, exp: 0 },
  },
  {
    taskKey: 'd2_cultivate_30min',
    dayNumber: 2,
    titleVi: 'Tu luyện 30 phút',
    titleEn: 'Cultivate for 30 minutes',
    descriptionVi:
      'Để tu luyện idle chạy ít nhất 30 phút rồi quay lại nhận EXP.',
    descriptionEn:
      'Let idle cultivation run for at least 30 minutes, then come back for EXP.',
    actionRoute: '/cultivation',
    category: 'cultivation',
    reward: { linhThach: 200, exp: 100 },
  },

  // ---------- Day 3 — Chiến đấu & dungeon (4 tasks) ----------
  {
    taskKey: 'd3_first_combat_win',
    dayNumber: 3,
    titleVi: 'Thắng 1 trận đầu tiên',
    titleEn: 'Win your first combat',
    descriptionVi:
      'Tham gia 1 trận chiến đấu (bất kỳ) và giành chiến thắng để chứng minh khả năng.',
    descriptionEn:
      'Engage in any combat encounter and emerge victorious to prove yourself.',
    actionRoute: '/combat',
    category: 'combat',
    reward: { linhThach: 150, exp: 100 },
  },
  {
    taskKey: 'd3_enter_dungeon',
    dayNumber: 3,
    titleVi: 'Vào bí cảnh sơ cấp',
    titleEn: 'Enter a starter dungeon',
    descriptionVi:
      'Vào trang dungeon và khám phá bí cảnh sơ cấp đầu tiên.',
    descriptionEn:
      'Go to the dungeon page and explore your first beginner dungeon.',
    actionRoute: '/dungeon',
    category: 'combat',
    reward: { linhThach: 150, exp: 100 },
  },
  {
    taskKey: 'd3_clear_dungeon',
    dayNumber: 3,
    titleVi: 'Hoàn thành 1 bí cảnh',
    titleEn: 'Clear one dungeon',
    descriptionVi:
      'Hoàn thành tất cả phòng và quái vật trong 1 bí cảnh sơ cấp.',
    descriptionEn:
      'Clear all rooms and monsters in one beginner dungeon.',
    actionRoute: '/dungeon',
    category: 'combat',
    reward: { linhThach: 250, exp: 150 },
  },
  {
    taskKey: 'd3_check_drop_loot',
    dayNumber: 3,
    titleVi: 'Kiểm tra chiến lợi phẩm',
    titleEn: 'Check your loot',
    descriptionVi:
      'Quay lại túi đồ và xem chiến lợi phẩm đã nhặt sau combat/dungeon.',
    descriptionEn:
      'Return to your inventory and check the loot you picked up after combat/dungeon.',
    actionRoute: '/inventory',
    category: 'combat',
    reward: { linhThach: 100, exp: 0 },
  },

  // ---------- Day 4 — Cốt truyện (4 tasks) ----------
  {
    taskKey: 'd4_open_story_v2',
    dayNumber: 4,
    titleVi: 'Mở Tu Tiên Lộ',
    titleEn: 'Open Tu Tiên Lộ',
    descriptionVi:
      'Khám phá Tu Tiên Lộ — câu chuyện chính của thế giới tu tiên.',
    descriptionEn:
      'Explore Tu Tiên Lộ — the main story of the cultivation world.',
    actionRoute: '/story-v2',
    category: 'story',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd4_read_journal',
    dayNumber: 4,
    titleVi: 'Đọc nhật ký cốt truyện',
    titleEn: 'Read the story journal',
    descriptionVi:
      'Xem chương đang mở và đọc bối cảnh / chủ đề của chương đó.',
    descriptionEn:
      'View the current open chapter and read its theme and context.',
    actionRoute: '/story-v2',
    category: 'story',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd4_talk_npc',
    dayNumber: 4,
    titleVi: 'Đối thoại với NPC',
    titleEn: 'Talk with an NPC',
    descriptionVi:
      'Tìm và nói chuyện với 1 NPC trong thế giới hoặc trong cốt truyện.',
    descriptionEn:
      'Find and talk with one NPC in the world or in the story.',
    actionRoute: '/story-v2',
    category: 'story',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd4_complete_story_step',
    dayNumber: 4,
    titleVi: 'Hoàn thành 1 bước cốt truyện',
    titleEn: 'Complete one story step',
    descriptionVi:
      'Hoàn thành 1 bước trong cốt truyện chính (talk/explore/choice).',
    descriptionEn:
      'Complete one step (talk/explore/choice) in the main story.',
    actionRoute: '/story-v2',
    category: 'story',
    reward: { linhThach: 200, exp: 100 },
  },

  // ---------- Day 5 — Xã hội (3 tasks) ----------
  {
    taskKey: 'd5_view_sect_list',
    dayNumber: 5,
    titleVi: 'Xem danh sách tông môn',
    titleEn: 'Browse sects',
    descriptionVi:
      'Vào trang tông môn để xem các tông môn lớn của thế giới tu tiên.',
    descriptionEn:
      'Visit the sect page and view the major sects of the cultivation world.',
    actionRoute: '/sect',
    category: 'social',
    reward: { linhThach: 100, exp: 0 },
  },
  {
    taskKey: 'd5_check_chat',
    dayNumber: 5,
    titleVi: 'Mở chat thế giới',
    titleEn: 'Open world chat',
    descriptionVi:
      'Mở chat thế giới để giao lưu với các tu sĩ khác.',
    descriptionEn:
      'Open world chat to interact with other cultivators.',
    actionRoute: '/chat',
    category: 'social',
    reward: { linhThach: 100, exp: 0 },
  },
  {
    taskKey: 'd5_check_mail',
    dayNumber: 5,
    titleVi: 'Kiểm tra hộp thư',
    titleEn: 'Check your mail',
    descriptionVi:
      'Mở hộp thư để nhận quà từ hệ thống hoặc từ các tu sĩ khác.',
    descriptionEn:
      'Open your mailbox to receive gifts from the system or other cultivators.',
    actionRoute: '/mail',
    category: 'social',
    reward: { linhThach: 150, exp: 0 },
  },

  // ---------- Day 6 — Pháp bảo & ngũ hành (3 tasks) ----------
  {
    taskKey: 'd6_view_artifact',
    dayNumber: 6,
    titleVi: 'Xem pháp bảo',
    titleEn: 'View artifacts',
    descriptionVi:
      'Mở trang pháp bảo để biết các pháp bảo cao cấp giúp tu sĩ chiến đấu.',
    descriptionEn:
      'Open the artifacts page to learn about advanced artifacts that aid cultivators in combat.',
    actionRoute: '/artifact',
    category: 'system',
    reward: { linhThach: 150, exp: 50 },
  },
  {
    taskKey: 'd6_check_elemental',
    dayNumber: 6,
    titleVi: 'Tìm hiểu ngũ hành',
    titleEn: 'Understand ngũ hành',
    descriptionVi:
      'Xem chu kỳ ngũ hành (Kim - Mộc - Thủy - Hỏa - Thổ) để biết tương sinh tương khắc.',
    descriptionEn:
      'View the ngũ hành cycle (Metal - Wood - Water - Fire - Earth) to understand element interactions.',
    actionRoute: '/spiritual-root',
    category: 'cultivation',
    reward: { linhThach: 100, exp: 50 },
  },
  {
    taskKey: 'd6_collect_material',
    dayNumber: 6,
    titleVi: 'Nhận nguyên liệu nhỏ',
    titleEn: 'Receive a small material',
    descriptionVi:
      'Mở mail hoặc claim từ daily login để nhận 1 nguyên liệu sơ cấp.',
    descriptionEn:
      'Open mail or claim from daily login to receive one basic material.',
    actionRoute: '/inventory',
    category: 'system',
    reward: { linhThach: 100, exp: 50 },
  },

  // ---------- Day 7 — Tổng kết (3 tasks) ----------
  {
    taskKey: 'd7_review_dashboard',
    dayNumber: 7,
    titleVi: 'Xem tổng quan nhân vật',
    titleEn: 'Review your dashboard',
    descriptionVi:
      'Mở trang nhân vật và xem tổng quan tiến độ tu luyện sau 7 ngày.',
    descriptionEn:
      'Open your profile and review your cultivation progress after 7 days.',
    actionRoute: '/profile',
    category: 'tutorial',
    reward: { linhThach: 200, exp: 100 },
  },
  {
    taskKey: 'd7_check_next_action',
    dayNumber: 7,
    titleVi: 'Xem gợi ý kế tiếp',
    titleEn: 'Check next-action suggestion',
    descriptionVi:
      'Xem gợi ý "Nên làm gì tiếp?" để biết hướng phát triển tiếp theo.',
    descriptionEn:
      'View the "What\'s next?" suggestion to learn your next development direction.',
    actionRoute: '/home',
    category: 'tutorial',
    reward: { linhThach: 200, exp: 100 },
  },
  {
    taskKey: 'd7_complete_onboarding',
    dayNumber: 7,
    titleVi: 'Hoàn thành nhập môn',
    titleEn: 'Complete onboarding',
    descriptionVi:
      'Hoàn thành 7 ngày nhập môn và nhận danh hiệu "Tân Tu Sĩ" cùng linh thạch hỗ trợ.',
    descriptionEn:
      'Complete 7 days of onboarding and receive the "Novice Cultivator" title plus support linh thạch.',
    actionRoute: '/profile',
    category: 'tutorial',
    reward: {
      linhThach: 500,
      exp: 300,
      titleKey: 'onboarding_novice_cultivator',
    },
  },
];

export const ONBOARDING_DAYS: OnboardingDayDef[] = [
  {
    dayNumber: 1,
    titleVi: 'Ngày 1 — Khởi đầu',
    titleEn: 'Day 1 — Beginning',
    themeVi: 'Làm quen với thế giới tu tiên: điểm danh, túi đồ, tu luyện, nhiệm vụ.',
    themeEn: 'Get familiar with the cultivation world: login, inventory, cultivation, quests.',
    taskKeys: [
      'd1_claim_daily_login',
      'd1_open_inventory',
      'd1_first_cultivation',
      'd1_view_quest',
      'd1_finish_tutorial_quest',
    ],
  },
  {
    dayNumber: 2,
    titleVi: 'Ngày 2 — Tu luyện cơ bản',
    titleEn: 'Day 2 — Basic Cultivation',
    themeVi: 'Hiểu cảnh giới, trang bị, linh căn, và tu luyện idle.',
    themeEn: 'Understand realms, equipment, spiritual roots, and idle cultivation.',
    taskKeys: [
      'd2_check_realm',
      'd2_equip_weapon',
      'd2_check_spiritual_root',
      'd2_cultivate_30min',
    ],
  },
  {
    dayNumber: 3,
    titleVi: 'Ngày 3 — Chiến đấu & bí cảnh',
    titleEn: 'Day 3 — Combat & Dungeons',
    themeVi: 'Thử sức trong chiến đấu và khám phá bí cảnh sơ cấp.',
    themeEn: 'Test yourself in combat and explore beginner dungeons.',
    taskKeys: [
      'd3_first_combat_win',
      'd3_enter_dungeon',
      'd3_clear_dungeon',
      'd3_check_drop_loot',
    ],
  },
  {
    dayNumber: 4,
    titleVi: 'Ngày 4 — Cốt truyện',
    titleEn: 'Day 4 — Story',
    themeVi: 'Mở Tu Tiên Lộ, đọc nhật ký, đối thoại NPC.',
    themeEn: 'Open Tu Tiên Lộ, read the journal, talk with NPCs.',
    taskKeys: [
      'd4_open_story_v2',
      'd4_read_journal',
      'd4_talk_npc',
      'd4_complete_story_step',
    ],
  },
  {
    dayNumber: 5,
    titleVi: 'Ngày 5 — Xã hội',
    titleEn: 'Day 5 — Social',
    themeVi: 'Khám phá tông môn, chat thế giới, và hộp thư.',
    themeEn: 'Explore sects, world chat, and your mailbox.',
    taskKeys: ['d5_view_sect_list', 'd5_check_chat', 'd5_check_mail'],
  },
  {
    dayNumber: 6,
    titleVi: 'Ngày 6 — Pháp bảo & ngũ hành',
    titleEn: 'Day 6 — Artifacts & Elements',
    themeVi: 'Tìm hiểu pháp bảo cao cấp và chu kỳ ngũ hành.',
    themeEn: 'Learn about advanced artifacts and the ngũ hành element cycle.',
    taskKeys: ['d6_view_artifact', 'd6_check_elemental', 'd6_collect_material'],
  },
  {
    dayNumber: 7,
    titleVi: 'Ngày 7 — Tổng kết',
    titleEn: 'Day 7 — Summary',
    themeVi: 'Xem tổng quan tiến độ và nhận danh hiệu "Tân Tu Sĩ".',
    themeEn: 'Review your progress and earn the "Novice Cultivator" title.',
    taskKeys: [
      'd7_review_dashboard',
      'd7_check_next_action',
      'd7_complete_onboarding',
    ],
  },
];

// =============================================================================
// HELPERS (pure functions — no IO).
// =============================================================================

const TASK_BY_KEY: Record<string, OnboardingTaskDef> = (() => {
  const map: Record<string, OnboardingTaskDef> = {};
  for (const t of ONBOARDING_TASKS) {
    map[t.taskKey] = t;
  }
  return map;
})();

const DAY_BY_NUMBER: Record<number, OnboardingDayDef> = (() => {
  const map: Record<number, OnboardingDayDef> = {};
  for (const d of ONBOARDING_DAYS) {
    map[d.dayNumber] = d;
  }
  return map;
})();

export function onboardingTaskByKey(taskKey: string): OnboardingTaskDef | null {
  return TASK_BY_KEY[taskKey] ?? null;
}

export function onboardingDayByNumber(
  dayNumber: number,
): OnboardingDayDef | null {
  return DAY_BY_NUMBER[dayNumber] ?? null;
}

export function onboardingTasksForDay(dayNumber: number): OnboardingTaskDef[] {
  const day = DAY_BY_NUMBER[dayNumber];
  if (!day) return [];
  return day.taskKeys
    .map((k) => TASK_BY_KEY[k])
    .filter((t): t is OnboardingTaskDef => Boolean(t));
}

/** Tổng linh thạch tối đa player có thể nhận hết Phase 34.0 (cap audit). */
export function onboardingTotalLinhThachCap(): number {
  let sum = 0;
  for (const t of ONBOARDING_TASKS) sum += t.reward.linhThach;
  return sum;
}

/** Tổng exp tối đa player có thể nhận. */
export function onboardingTotalExpCap(): number {
  let sum = 0;
  for (const t of ONBOARDING_TASKS) sum += t.reward.exp;
  return sum;
}

export const ONBOARDING_TOTAL_DAYS = 7;
export const ONBOARDING_TASK_COUNT = ONBOARDING_TASKS.length;
