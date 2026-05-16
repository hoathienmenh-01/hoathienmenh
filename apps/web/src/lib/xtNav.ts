/**
 * UI-2.0 — XT shared navigation data.
 *
 * Single source of truth for:
 *   - Mobile bottom navigation (5 main items).
 *   - Mobile menu drawer (full grouped catalog).
 *   - Desktop sidebar (compact grouped sidebar 220–240px).
 *
 * Each entry exposes:
 *   - `key`: i18n key under `shell.nav.<key>` for VI/EN labels.
 *   - `icon`: name passed to XTIcon / GameIcon.
 *   - `to`: router path. Every route here must either be a registered
 *     route or a registered placeholder so menus never have dead taps
 *     (Phần 3 of task).
 *   - Optional `staffOnly` flag (admin links).
 *   - Optional `badge` key to surface store badges.
 *   - Optional `accent` for per-group tint (Phần 7 theme nhóm).
 *   - Optional `featureFlag` to hide entry when feature flag store reports OFF.
 */
import type { FeatureFlagKey } from '@xuantoi/shared';

export type XTNavBadgeKind =
  | 'breakthrough'
  | 'boss'
  | 'mission'
  | 'mail'
  | 'topup'
  | 'notification';

export type XTNavAccent =
  | 'jade'
  | 'cultivation'
  | 'combat'
  | 'secret'
  | 'inventory'
  | 'alchemy'
  | 'pet'
  | 'sect'
  | 'market'
  | 'admin';

export interface XTNavItem {
  /** i18n key under `shell.nav.<key>` */
  key: string;
  /** Icon name passed to <XTIcon>/<GameIcon>. */
  icon: string;
  /** Router path. Must resolve to a registered route or placeholder. */
  to: string;
  /** When true, only render for ADMIN/MOD users. */
  staffOnly?: boolean;
  /** Optional badge key to attach store-driven badges. */
  badge?: XTNavBadgeKind;
  /** Optional per-item testid (used by AppShell tests + Playwright). */
  testId?: string;
  /**
   * Beta safe integration sweep — optional feature-flag gate.
   * Khi `featureFlag` set và `featureFlagsStore.isDisabled(key) === true`,
   * shell ẩn entry (menu drawer + sidebar). Server vẫn gate cuối qua
   * `FEATURE_DISABLED` — FE chỉ giảm friction UX.
   */
  featureFlag?: FeatureFlagKey;
}

export interface XTNavGroup {
  /** i18n key under `shell.group.<key>`. */
  key: string;
  /** Per-group accent — only affects the active state tint. */
  accent: XTNavAccent;
  items: XTNavItem[];
}

export interface XTBottomNavEntry {
  key: string;
  icon: string;
  /** Null for the menu pseudo-item; non-null routes navigate. */
  to: string | null;
  /** When set, the bottom nav triggers an action instead of router.push. */
  action?: 'menu';
  testId?: string;
}

/** Mobile bottom navigation — exactly 5 items per task spec. The fifth is
 *  always the `menu` pseudo-item which opens the menu drawer. The actual
 *  drawer toggle is implemented by the shell; the entry exists in the list
 *  so the layout/tests can treat it uniformly. */
export const XT_BOTTOM_NAV: XTBottomNavEntry[] = [
  { key: 'home', icon: 'home', to: '/home', testId: 'xt-bottomnav-home' },
  {
    key: 'cultivation',
    icon: 'cultivation',
    to: '/cultivation',
    testId: 'xt-bottomnav-cultivation',
  },
  {
    key: 'inventory',
    icon: 'inventory',
    to: '/inventory',
    testId: 'xt-bottomnav-inventory',
  },
  {
    key: 'activity',
    icon: 'activity',
    to: '/world',
    testId: 'xt-bottomnav-activity',
  },
  {
    key: 'menu',
    icon: 'menu',
    to: null,
    action: 'menu',
    testId: 'xt-bottomnav-menu',
  },
];

/** Desktop sidebar groups. */
export const XT_NAV_GROUPS: XTNavGroup[] = [
  {
    key: 'core',
    accent: 'jade',
    items: [
      { key: 'home', icon: 'home', to: '/home', badge: 'breakthrough' },
      {
        key: 'dashboard',
        icon: 'dashboard',
        to: '/dashboard',
        testId: 'shell-nav-dashboard',
      },
    ],
  },
  {
    key: 'cultivation',
    accent: 'cultivation',
    items: [
      { key: 'character', icon: 'character', to: '/character' },
      { key: 'cultivation', icon: 'cultivation', to: '/cultivation' },
      { key: 'breakthrough', icon: 'breakthrough', to: '/breakthrough' },
      {
        key: 'bodyCultivation',
        icon: 'bodyCultivation',
        to: '/body-cultivation',
      },
      {
        key: 'cultivationMethod',
        icon: 'method',
        to: '/cultivation-method',
      },
      { key: 'spiritualRoot', icon: 'spiritualRoot', to: '/spiritual-root' },
      { key: 'skillBook', icon: 'skill', to: '/skill-book' },
      { key: 'alchemy', icon: 'alchemy', to: '/alchemy' },
    ],
  },
  {
    key: 'activity',
    accent: 'secret',
    items: [
      { key: 'world', icon: 'farm', to: '/world' },
      { key: 'farm', icon: 'farm', to: '/world/farm-maps' },
      { key: 'boss', icon: 'boss', to: '/boss', badge: 'boss' },
      { key: 'secretRealms', icon: 'secretRealm', to: '/secret-realm' },
      { key: 'tower', icon: 'tower', to: '/tower' },
      { key: 'roguelike', icon: 'roguelike', to: '/roguelike' },
      { key: 'missions', icon: 'event', to: '/missions', badge: 'mission' },
      { key: 'events', icon: 'event', to: '/events' },
    ],
  },
  {
    key: 'inventory',
    accent: 'inventory',
    items: [
      {
        key: 'inventory',
        icon: 'inventory',
        to: '/inventory',
      },
      {
        key: 'equipment',
        icon: 'equipment',
        to: '/equipment',
        testId: 'shell-nav-equipment',
      },
      { key: 'pets', icon: 'pet', to: '/pets' },
      { key: 'artifact', icon: 'artifact', to: '/artifact-v2' },
    ],
  },
  {
    key: 'social',
    accent: 'sect',
    items: [
      { key: 'sect', icon: 'sect', to: '/sect' },
      {
        key: 'social',
        icon: 'social',
        to: '/social',
        testId: 'shell-nav-social',
      },
      { key: 'mentor', icon: 'character', to: '/mentor' },
      { key: 'mail', icon: 'mail', to: '/mail', badge: 'mail' },
      { key: 'notifications', icon: 'notification', to: '/notifications' },
    ],
  },
  {
    key: 'market',
    accent: 'market',
    items: [
      { key: 'market', icon: 'market', to: '/market' },
      {
        key: 'auction',
        icon: 'auction',
        to: '/auction',
        featureFlag: 'AUCTION_HOUSE_ENABLED',
      },
      { key: 'shop', icon: 'market', to: '/shop' },
      { key: 'topup', icon: 'jade', to: '/topup', badge: 'topup' },
    ],
  },
  {
    key: 'longTerm',
    accent: 'jade',
    items: [
      { key: 'achievements', icon: 'achievement', to: '/achievements' },
      { key: 'titles', icon: 'title', to: '/titles' },
      { key: 'reputation', icon: 'reputation', to: '/reputation' },
      { key: 'seasons', icon: 'event', to: '/seasons' },
      { key: 'leaderboard', icon: 'leaderboard', to: '/leaderboard' },
    ],
  },
  {
    key: 'system',
    accent: 'admin',
    items: [
      { key: 'settings', icon: 'settings', to: '/settings' },
      {
        key: 'notificationSettings',
        icon: 'notification',
        to: '/notification-settings',
        testId: 'shell-nav-notification-settings',
      },
      {
        key: 'feedback',
        icon: 'support',
        to: '/support/feedback',
        testId: 'shell-nav-feedback',
      },
      {
        key: 'reportPlayer',
        icon: 'support',
        to: '/support/report-player',
        testId: 'shell-nav-report-player',
      },
      { key: 'giftcode', icon: 'event', to: '/giftcode' },
      { key: 'activity', icon: 'stone', to: '/activity' },
      { key: 'admin', icon: 'admin', to: '/admin', staffOnly: true },
    ],
  },
];

/** Returns a flat list of nav items (excluding bottom nav pseudo items). */
export function flattenNav(): XTNavItem[] {
  return XT_NAV_GROUPS.flatMap((g) => g.items);
}
