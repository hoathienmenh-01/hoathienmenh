/**
 * Cửu Thiên Mộng — Home dashboard mock data.
 *
 * Static demo data feeding the luxury home dashboard (`XTHomeDashboard`).
 * KHÔNG đụng business logic / backend — chỉ là dữ liệu hiển thị mặc định
 * cho phép layout render đầy đủ ngay khi store còn rỗng. Khi tích hợp thật
 * với game store / API, các view có thể truyền props override để thay
 * counter / progress / character name.
 *
 * Strict no-Han: toàn bộ string đều thuần Việt, không dùng ký tự CJK ideograph.
 */

export type ResourceKey = 'linhThach' | 'tienNgoc' | 'tuTinh' | 'danhVong';

export type IconTone =
  | 'jade'
  | 'gold'
  | 'seal'
  | 'violet'
  | 'cyan'
  | 'smoke';

export interface HomeSidebarItem {
  key: string;
  label: string;
  icon: string;
  to: string;
  /** Optional badge count (red dot if > 0). */
  badge?: number;
  /** Mark item as active when route matches one of these names/paths. */
  match?: string[];
}

export interface HomeSidebarGroup {
  key: string;
  /** Optional uppercase eyebrow above the group. */
  eyebrow?: string;
  items: HomeSidebarItem[];
}

export interface HomeResource {
  key: ResourceKey;
  label: string;
  /** Long-form value (e.g. 12.568.890). Formatted Vietnamese with dots. */
  value: string;
  /** Compact value used in tight pills (e.g. 12.56M). */
  short?: string;
  /** Glyph used by XT design tokens. */
  glyph: string;
  /** Tone for chip border + glow. */
  tone: IconTone;
}

export interface HomeStatTile {
  key: string;
  label: string;
  /** Big value (e.g. tu vi, lực chiến). */
  value: string;
  /** Subtitle / delta (e.g. "Tăng 125.680" or "+3.250/giờ"). */
  hint?: string;
  /** Optional secondary line (e.g. realm name under tu vi). */
  meta?: string;
  glyph: string;
  tone: IconTone;
}

export interface HomeFeatureCard {
  key: string;
  label: string;
  description: string;
  glyph: string;
  tone: IconTone;
  to: string;
  /** Optional red badge count rendered top-right. */
  badge?: number;
}

export type QuestTag = 'main' | 'side' | 'weekly' | 'daily';

export interface HomeQuest {
  key: string;
  tag: QuestTag;
  title: string;
  subtitle: string;
  progress: { current: number; total: number };
  reward: { glyph: string; amount: string };
  /** Optional quest status for UI badge (ACCEPTED = in-progress, COMPLETED = claimable). */
  status?: 'ACCEPTED' | 'COMPLETED';
}

export interface HomeEquipmentSlot {
  key: string;
  label: string;
  glyph: string;
  plus: number;
  tone: IconTone;
  /** Slot position around the silhouette. */
  position:
    | 'topLeft'
    | 'midLeft'
    | 'bottomLeft'
    | 'topRight'
    | 'midRight'
    | 'bottomRight';
}

export interface HomeQuickAction {
  key: string;
  label: string;
  glyph: string;
  tone: IconTone;
  to?: string;
  badge?: number;
}

export interface HomeBottomNavItem {
  key: string;
  label: string;
  glyph: string;
  to: string;
  highlight?: boolean;
  badge?: number;
}

/* ───────────── SIDEBAR (desktop, ~240px) ───────────── */
export const sidebarGroups: HomeSidebarGroup[] = [
  {
    key: 'core',
    items: [
      { key: 'home', label: 'Trang chủ', icon: 'home', to: '/home' },
      { key: 'character', label: 'Nhân vật', icon: 'character', to: '/character' },
      { key: 'cultivation', label: 'Tu luyện', icon: 'cultivation', to: '/cultivation' },
      { key: 'spiritualRoot', label: 'Linh căn', icon: 'spiritualRoot', to: '/spiritual-root' },
      { key: 'body', label: 'Luyện thể', icon: 'bodyCultivation', to: '/body-cultivation' },
      { key: 'skills', label: 'Kỹ năng', icon: 'skillBook', to: '/skill-book' },
    ],
  },
  {
    key: 'gear',
    eyebrow: 'Trang bị',
    items: [
      { key: 'inventory', label: 'Túi đồ', icon: 'inventory', to: '/inventory' },
      { key: 'equipment', label: 'Trang bị', icon: 'equipment', to: '/loadouts' },
      { key: 'sect', label: 'Tông môn', icon: 'sect', to: '/sect' },
      { key: 'market', label: 'Chợ linh thạch', icon: 'market', to: '/market' },
    ],
  },
  {
    key: 'combat',
    eyebrow: 'Chiến trận',
    items: [
      { key: 'boss', label: 'Boss & Phụ bản', icon: 'boss', to: '/boss' },
      { key: 'pvp', label: 'PvP & Đấu trường', icon: 'pvp', to: '/pvp' },
      { key: 'missions', label: 'Nhiệm vụ', icon: 'quest', to: '/missions', badge: 1 },
      { key: 'activity', label: 'Hoạt động', icon: 'event', to: '/activity', badge: 1 },
      { key: 'achievements', label: 'Thành tựu', icon: 'achievement', to: '/achievements' },
      { key: 'codex', label: 'Bách khoa', icon: 'codex', to: '/codex' },
    ],
  },
  {
    key: 'social',
    eyebrow: 'Giao tế',
    items: [
      { key: 'mail', label: 'Thư', icon: 'mail', to: '/mail', badge: 3 },
      { key: 'friends', label: 'Bạn bè', icon: 'social', to: '/social' },
      { key: 'wallet', label: 'Ví', icon: 'wallet', to: '/wallet' },
      { key: 'shop', label: 'Cửa hàng', icon: 'shop', to: '/shop' },
      { key: 'topup', label: 'Nạp', icon: 'jade', to: '/topup' },
      { key: 'giftcode', label: 'Quà tặng', icon: 'gift', to: '/giftcode' },
      { key: 'seasons', label: 'Mùa giải', icon: 'achievement', to: '/seasons' },
      { key: 'settings', label: 'Cài đặt', icon: 'settings', to: '/settings' },
    ],
  },
];

/* ───────────── TOPBAR + HEADER MOBILE ───────────── */
export const playerHeader = {
  name: 'Thiên Vân',
  realm: 'Đại Thừa Kỳ',
  stage: 'Đại Thừa Bậc 9',
  stagePill: 'Bậc 9',
  level: 120,
  power: '8.256.789',
  avatarGlyph: '☯',
};

export const topbarMail = { badge: 3 };

/* ───────────── RESOURCES STRIP ───────────── */
export const resources: HomeResource[] = [
  {
    key: 'linhThach',
    label: 'Linh thạch',
    value: '12.568.890',
    short: '12.56M',
    glyph: '◈',
    tone: 'jade',
  },
  {
    key: 'tienNgoc',
    label: 'Tiên ngọc',
    value: '8.745',
    short: '8.74K',
    glyph: '◆',
    tone: 'gold',
  },
  {
    key: 'tuTinh',
    label: 'Tử tinh',
    value: '2.980',
    short: '2.98K',
    glyph: '✦',
    tone: 'violet',
  },
  {
    key: 'danhVong',
    label: 'Danh vọng',
    value: '26.540',
    short: '26.5K',
    glyph: '♛',
    tone: 'smoke',
  },
];

/* ───────────── HERO BANNER ───────────── */
export const heroBanner = {
  brand: 'Xuân Tôi',
  subtitle: 'Cửu Thiên Mộng',
  tagline: 'Tu chí vô thượng, độc tôn cửu thiên',
  watermarkLetter: 'X',
};

export const heroQuickActions: HomeQuickAction[] = [
  { key: 'fast-cultivate', label: 'Tu luyện nhanh', glyph: '✦', tone: 'jade' },
  { key: 'claim-reward', label: 'Nhận thưởng', glyph: '🎁', tone: 'gold', badge: 1 },
  { key: 'restore', label: 'Hồi phục', glyph: '✿', tone: 'seal' },
  { key: 'teleport', label: 'Truyền tống', glyph: '✧', tone: 'cyan' },
];

export const dailyReward = {
  title: 'Phúc lợi hôm nay',
  claimed: 6,
  total: 10,
  cta: 'Mở rương',
};

/* ───────────── STAT TILES (desktop ~6 ô) ───────────── */
export const statTiles: HomeStatTile[] = [
  {
    key: 'tuVi',
    label: 'Tu vi',
    value: '32.456.789',
    meta: 'Đại Thừa Kỳ Bậc 9',
    glyph: '✦',
    tone: 'jade',
  },
  {
    key: 'lucChien',
    label: 'Lực chiến',
    value: '8.256.789',
    hint: 'Tăng 125.680',
    glyph: '⚔',
    tone: 'seal',
  },
  {
    key: 'linhThach',
    label: 'Linh thạch',
    value: '12.568.890',
    hint: '+3.250/giờ',
    glyph: '◈',
    tone: 'cyan',
  },
  {
    key: 'tienNgoc',
    label: 'Tiên ngọc',
    value: '8.745',
    hint: '+120/giờ',
    glyph: '◆',
    tone: 'gold',
  },
  {
    key: 'danhVong',
    label: 'Danh vọng',
    value: '26.540',
    hint: 'Tôn kính',
    glyph: '♛',
    tone: 'violet',
  },
  {
    key: 'sect',
    label: 'Tông môn',
    value: 'Thanh Vân Tông',
    hint: 'Đóng góp 12.680',
    glyph: '⛩',
    tone: 'jade',
  },
];

/* ───────────── STAT TILES (mobile compact 4 ô) ───────────── */
export const statTilesMobile: HomeStatTile[] = [
  {
    key: 'linhThach',
    label: 'Linh thạch',
    value: '13.268.890',
    hint: 'Lv. 32',
    glyph: '◈',
    tone: 'cyan',
  },
  {
    key: 'tienNgoc',
    label: 'Tiên ngọc',
    value: '+170/giờ',
    hint: 'Lv. 45',
    glyph: '◆',
    tone: 'gold',
  },
  {
    key: 'danhVong',
    label: 'Danh vọng',
    value: '26.540',
    hint: 'Tôn kính',
    glyph: '♛',
    tone: 'violet',
  },
  {
    key: 'sect',
    label: 'Tông môn',
    value: 'Thanh Vân Tông',
    hint: 'Đóng góp 12.680',
    glyph: '⛩',
    tone: 'jade',
  },
];

/* ───────────── FEATURE GRID DESKTOP ───────────── */
export const featureCards: HomeFeatureCard[] = [
  {
    key: 'cultivation',
    label: 'Tu luyện',
    description: 'Tăng tu vi',
    glyph: '✦',
    tone: 'jade',
    to: '/cultivation',
  },
  {
    key: 'boss',
    label: 'Boss & Phụ bản',
    description: 'Thách thức mạnh mẽ',
    glyph: '☠',
    tone: 'seal',
    to: '/boss',
  },
  {
    key: 'pvp',
    label: 'PvP & Đấu trường',
    description: 'Khẳng định bản lĩnh',
    glyph: '⚔',
    tone: 'cyan',
    to: '/pvp',
  },
  {
    key: 'market',
    label: 'Chợ linh thạch',
    description: 'Mua bán tự do',
    glyph: '◈',
    tone: 'jade',
    to: '/market',
  },
  {
    key: 'sect',
    label: 'Tông môn',
    description: 'Gắn kết đạo hữu',
    glyph: '⛩',
    tone: 'cyan',
    to: '/sect',
  },
  {
    key: 'missions',
    label: 'Nhiệm vụ',
    description: 'Nhận thưởng lớn',
    glyph: '✎',
    tone: 'gold',
    to: '/missions',
  },
  {
    key: 'achievements',
    label: 'Thành tựu',
    description: 'Vinh danh hành giả',
    glyph: '♛',
    tone: 'gold',
    to: '/achievements',
  },
  {
    key: 'mail',
    label: 'Hộp thư',
    description: 'Thư hệ thống',
    glyph: '✉',
    tone: 'cyan',
    to: '/mail',
  },
  {
    key: 'events',
    label: 'Sự kiện',
    description: 'Đang diễn ra',
    glyph: '✷',
    tone: 'jade',
    to: '/events',
  },
  {
    key: 'shop',
    label: 'Cửa hàng',
    description: 'Đa dạng vật phẩm',
    glyph: '🏪',
    tone: 'gold',
    to: '/shop',
  },
  {
    key: 'seasons',
    label: 'Mùa giải',
    description: 'Mùa giải hiện tại',
    glyph: '✺',
    tone: 'violet',
    to: '/seasons',
  },
  {
    key: 'settings',
    label: 'Cài đặt',
    description: 'Tùy chỉnh hệ thống',
    glyph: '⚙',
    tone: 'smoke',
    to: '/settings',
  },
];

/* ───────────── FEATURE GRID MOBILE (icon-only 21 mục) ───────────── */
export const mobileIconGrid: HomeFeatureCard[] = [
  { key: 'cultivation', label: 'Tu luyện', description: '', glyph: '✦', tone: 'jade', to: '/cultivation' },
  { key: 'character', label: 'Nhân vật', description: '', glyph: '☯', tone: 'cyan', to: '/character' },
  { key: 'spiritualRoot', label: 'Linh căn', description: '', glyph: '❀', tone: 'gold', to: '/spiritual-root' },
  { key: 'skills', label: 'Kỹ năng', description: '', glyph: '✶', tone: 'gold', to: '/skill-book' },
  { key: 'inventory', label: 'Túi đồ', description: '', glyph: '⛃', tone: 'gold', to: '/inventory' },
  { key: 'equipment', label: 'Trang bị', description: '', glyph: '⚔', tone: 'gold', to: '/loadouts' },
  { key: 'missions', label: 'Nhiệm vụ', description: '', glyph: '✎', tone: 'gold', to: '/missions' },
  { key: 'boss', label: 'Boss', description: '', glyph: '☠', tone: 'seal', to: '/boss' },
  { key: 'dungeon', label: 'Phụ bản', description: '', glyph: '⛰', tone: 'smoke', to: '/world/dungeons' },
  { key: 'pvp', label: 'PvP', description: '', glyph: '⚔', tone: 'cyan', to: '/pvp' },
  { key: 'sect', label: 'Tông môn', description: '', glyph: '⛩', tone: 'cyan', to: '/sect' },
  { key: 'market', label: 'Chợ linh thạch', description: '', glyph: '◈', tone: 'jade', to: '/market' },
  { key: 'achievements', label: 'Thành tựu', description: '', glyph: '♛', tone: 'gold', to: '/achievements' },
  { key: 'mail', label: 'Thư', description: '', glyph: '✉', tone: 'cyan', to: '/mail' },
  { key: 'friends', label: 'Bạn bè', description: '', glyph: '☘', tone: 'jade', to: '/social' },
  { key: 'wallet', label: 'Ví', description: '', glyph: '💰', tone: 'gold', to: '/wallet' },
  { key: 'shop', label: 'Cửa hàng', description: '', glyph: '🏪', tone: 'gold', to: '/shop' },
  { key: 'topup', label: 'Nạp', description: '', glyph: '◆', tone: 'gold', to: '/topup' },
  { key: 'giftcode', label: 'Quà tặng', description: '', glyph: '🎁', tone: 'seal', to: '/giftcode' },
  { key: 'seasons', label: 'Mùa giải', description: '', glyph: '✺', tone: 'violet', to: '/seasons' },
  { key: 'settings', label: 'Cài đặt', description: '', glyph: '⚙', tone: 'smoke', to: '/settings' },
];

/* ───────────── BOTTOM PANELS ───────────── */
export const recentQuests: HomeQuest[] = [
  {
    key: 'main-1',
    tag: 'main',
    title: 'Đột Phá Đại Thừa',
    subtitle: 'Đạt Đại Thừa Kỳ Bậc 10',
    progress: { current: 9, total: 10 },
    reward: { glyph: '◈', amount: '5000' },
  },
  {
    key: 'side-1',
    tag: 'side',
    title: 'Linh Thú Xuất Thế',
    subtitle: 'Bắt linh thú bậc 7 trở lên',
    progress: { current: 0, total: 1 },
    reward: { glyph: '✦', amount: '300' },
  },
  {
    key: 'weekly-1',
    tag: 'weekly',
    title: 'Nhiệm Vụ Tông Môn',
    subtitle: 'Hoàn thành 20 lần nhiệm vụ tông môn',
    progress: { current: 14, total: 20 },
    reward: { glyph: '♛', amount: '2000' },
  },
  {
    key: 'daily-1',
    tag: 'daily',
    title: 'Tu Luyện Hằng Ngày',
    subtitle: 'Tu luyện nhận 120 phút tu vi',
    progress: { current: 85, total: 120 },
    reward: { glyph: '◈', amount: '1000' },
  },
];

export const equipmentSlots: HomeEquipmentSlot[] = [
  { key: 'helm', label: 'Mũ', glyph: '◈', plus: 12, tone: 'gold', position: 'topLeft' },
  { key: 'amulet', label: 'Phù', glyph: '◆', plus: 12, tone: 'cyan', position: 'topRight' },
  { key: 'armor', label: 'Giáp', glyph: '🛡', plus: 11, tone: 'seal', position: 'midLeft' },
  { key: 'ring', label: 'Nhẫn', glyph: '◍', plus: 11, tone: 'gold', position: 'midRight' },
  { key: 'weapon', label: 'Vũ khí', glyph: '⚔', plus: 10, tone: 'cyan', position: 'bottomLeft' },
  { key: 'boots', label: 'Giày', glyph: '✦', plus: 10, tone: 'jade', position: 'bottomRight' },
];

export const inventoryPanel = {
  title: 'Trang bị & Túi đồ',
  capacity: { current: 86, total: 120 },
  gearPower: '2.156.780',
};

export const sectPanel = {
  title: 'Tông môn & Đạo hữu',
  sectName: 'Thanh Vân Tông',
  sectLevel: 7,
  members: '128/150',
};

/* ───────────── BOTTOM NAV (mobile, 5 tab, giữa lớn) ─────────────
 * Phase 15.13 — Chỉ dùng cho preview standalone của `XTHomeDashboard`
 * (component prop `:nav-items` mặc định map vào đây). Production AppShell
 * nav source-of-truth là `apps/web/src/lib/xtNav.ts` (`XT_BOTTOM_NAV` +
 * `XT_NAV_GROUPS`). KHÔNG dùng `bottomNavItems` ở player `/home` chrome —
 * `XTHomeBottomNav` chỉ render khi `chrome === "standalone"`, mà
 * `HomeView` luôn nhúng dashboard dưới `chrome="embedded"`. */
export const bottomNavItems: HomeBottomNavItem[] = [
  { key: 'home', label: 'Trang chủ', glyph: '⌂', to: '/home' },
  { key: 'cultivation', label: 'Tu luyện', glyph: '✦', to: '/cultivation' },
  { key: 'combat', label: 'Chiến đấu', glyph: '⚔', to: '/boss', highlight: true },
  { key: 'sect', label: 'Tông môn', glyph: '⛩', to: '/sect' },
  { key: 'profile', label: 'Cá nhân', glyph: '☯', to: '/character', badge: 1 },
];
