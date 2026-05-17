<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeDashboard` (UI-3.2 main composer).
 *
 * Responsive luxury home/dashboard. Compose tất cả sub-component:
 *
 *   • Desktop (>= lg, 1024px):
 *       [Sidebar*] [Topbar*] [Hero banner] [Stat tiles 6 ô]
 *       [Feature grid 12 card] [Quest | Inventory | Sect chat]
 *
 *   • Mobile (< lg):
 *       [Mobile header*] [Hero mobile card] [Stat mini 4 ô]
 *       [Icon grid 21 ô] [Compact panels] [Bottom nav*]
 *
 * Các phần đánh dấu (*) chỉ render khi `chrome === 'standalone'`. Khi nhúng
 * vào `AppShell` (`chrome === 'embedded'`, mặc định) thì AppShell đã có
 * sidebar / topbar / bottom-nav riêng nên dashboard chỉ render phần
 * **nội dung**, tránh trùng lặp navigation.
 *
 * Phase 15.10 — Live player data wiring. Trước đây toàn bộ panel đọc từ
 * `@/data/homeDashboardMock` (mock VIP: "Thiên Vân — Đại Thừa Kỳ Bậc 9 /
 * 12.568.890 Linh Thạch / Thanh Vân Tông …"). Bây giờ các trường người
 * chơi thấy ngay (tên / cảnh giới / lực chiến / linh thạch / tiên ngọc /
 * tông môn / mail badge) đọc từ `useGameStore` (character, currentSect,
 * unreadMail). Khi `game.character` rỗng → empty state an toàn ("—" / 0 /
 * "Chưa gia nhập tông môn"), **không** fallback về mock VIP.
 *
 * Phase 15.16 (PR 626) — Home Data Correctness Pack. Hoàn thiện wire 4
 * surface gameplay sâu còn lại + sửa Tử tinh/Danh vọng:
 *   - `recentQuests`: từ `useQuestStore` (status ACCEPTED + COMPLETED, cap 4).
 *   - `equipmentSlots` + `inventoryPanel`: từ `listInventory()` (lazy fetch).
 *   - `dailyReward`: từ `getDailyLoginStatus()` (`currentStreak % 7` / 7).
 *   - `tuTinh`: backend KHÔNG có field này → ẩn hẳn khỏi resources strip
 *     và stat tiles (không giả 0).
 *   - `danhVong`: từ `useReputationGoalsStore.totalReputation`. Nếu store
 *     chưa load → ẩn tile (không giả 0).
 *   - Feature card / mobile icon-grid badge: tiếp tục dùng `useBadgesStore`
 *     + `game.unreadMail`; key chưa có store source → ẩn hẳn.
 *
 * Player-facing /home không bao giờ fallback về `homeDashboardMock`.
 * `homeDashboardMock` chỉ giữ cho dev preview standalone (storybook /
 * route `/effects-preview` nếu có) và default props cho component test.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useIsLgUp } from '@/composables/useMediaQuery';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { useQuestStore } from '@/stores/quest';
import { useReputationGoalsStore } from '@/stores/reputationGoals';
import { listInventory, type InventoryView } from '@/api/inventory';
import { getDailyLoginStatus, type DailyLoginStatus } from '@/api/dailyLogin';
import type { QuestKind, QuestProgressView } from '@/api/quest';
import type { EquipSlot } from '@xuantoi/shared';
import XTHomeSidebar from './XTHomeSidebar.vue';
import XTHomeTopBar from './XTHomeTopBar.vue';
import XTHomeHeroBanner from './XTHomeHeroBanner.vue';
import XTHomeStatTiles from './XTHomeStatTiles.vue';
import XTHomeFeatureGrid from './XTHomeFeatureGrid.vue';
import XTHomeQuestPanel from './XTHomeQuestPanel.vue';
import XTHomeInventoryPanel from './XTHomeInventoryPanel.vue';
import XTHomeSectChatPanel from './XTHomeSectChatPanel.vue';
import XTHomeMobileHeader from './XTHomeMobileHeader.vue';
import XTHomeMobileHero from './XTHomeMobileHero.vue';
import XTHomeBottomNav from './XTHomeBottomNav.vue';
import {
  bottomNavItems,
  featureCards,
  heroBanner,
  heroQuickActions,
  mobileIconGrid,
  sidebarGroups,
  sectPanel as sectPanelMock,
  type HomeBottomNavItem,
  type HomeEquipmentSlot,
  type HomeFeatureCard,
  type HomeQuest,
  type HomeResource,
  type HomeStatTile,
  type QuestTag,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    /**
     * `standalone`: render full chrome (sidebar / topbar / mobile header /
     * bottom nav). Dùng khi cần preview riêng dashboard ngoài shell.
     * `embedded` (default): chỉ render content (hero / tiles / grid /
     * panels). Dùng khi nhúng trong `AppShell` để tránh duplicate chrome.
     */
    chrome?: 'embedded' | 'standalone';
    /** Override bottom nav items (e.g. để test highlight active tab). */
    navItems?: HomeBottomNavItem[];
    testId?: string;
  }>(),
  {
    chrome: 'embedded',
    navItems: () => bottomNavItems,
    testId: 'home-dashboard',
  },
);

const isLgUp = useIsLgUp();
const router = useRouter();
const game = useGameStore();
const badges = useBadgesStore();
const questStore = useQuestStore();
const reputation = useReputationGoalsStore();

const showDesktopChrome = computed(
  () => isLgUp.value,
);
const showMobileChrome = computed(
  () => !isLgUp.value,
);

const EMPTY_VALUE = '—';
const NO_SECT = 'Chưa gia nhập tông môn';

function formatVN(n: number | bigint | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0';
  try {
    if (typeof n === 'string') return new Intl.NumberFormat('vi-VN').format(BigInt(n));
    return new Intl.NumberFormat('vi-VN').format(n);
  } catch {
    return '0';
  }
}

/**
 * Phase 15.10 — Live player header derived từ `game.character`. Khi store
 * chưa có character (chưa hydrate hoặc fail) → empty placeholders, KHÔNG
 * lộ mock VIP "Thiên Vân / Đại Thừa Kỳ Bậc 9 / 8.256.789".
 */
const livePlayerHeader = computed(() => {
  const c = game.character;
  if (!c) {
    return {
      name: EMPTY_VALUE,
      realm: EMPTY_VALUE,
      stage: EMPTY_VALUE,
      stagePill: EMPTY_VALUE,
      level: 0,
      power: '0',
      avatarGlyph: '☯',
    };
  }
  const realm = game.realmFullName || c.realmKey || EMPTY_VALUE;
  return {
    name: c.name,
    realm,
    stage: realm,
    stagePill: `Bậc ${c.realmStage}`,
    level: c.level,
    power: formatVN(c.power),
    avatarGlyph: '☯',
  };
});

/**
 * Phase 15.16 (PR 626) — Resources strip (topbar + mobile header).
 *   - Linh thạch / tiên ngọc đọc từ `game.character`.
 *   - Tử tinh: backend chưa có field — **ẩn hẳn**, không fake 0.
 *   - Danh vọng: lấy từ `reputation.totalReputation`; nếu store chưa load
 *     (`!reputation.loaded`) → **ẩn hẳn**, không fake 0.
 */
const liveResources = computed<HomeResource[]>(() => {
  const c = game.character;
  const list: HomeResource[] = [
    {
      key: 'linhThach',
      label: 'Linh thạch',
      value: c ? formatVN(c.linhThach) : '0',
      glyph: '◈',
      tone: 'jade',
    },
    {
      key: 'tienNgoc',
      label: 'Tiên ngọc',
      value: c ? formatVN(c.tienNgoc) : '0',
      glyph: '◆',
      tone: 'gold',
    },
  ];
  if (reputation.loaded) {
    list.push({
      key: 'danhVong',
      label: 'Danh vọng',
      value: formatVN(reputation.totalReputation),
      glyph: '♛',
      tone: 'smoke',
    });
  }
  return list;
});

/**
 * Phase 15.16 (PR 626) — Desktop stat tiles row.
 *   - Tu vi / lực chiến / linh thạch / tiên ngọc / sect đọc thật từ store.
 *   - Tử tinh: ẩn (BE không có field).
 *   - Danh vọng: chỉ render khi `reputation.loaded`; giá trị từ
 *     `totalReputation`. Tránh hiển thị 0 cứng gây hiểu nhầm.
 */
const liveStatTiles = computed<HomeStatTile[]>(() => {
  const c = game.character;
  const sect = game.currentSect;
  const list: HomeStatTile[] = [];
  if (!c) {
    list.push(
      { key: 'tuVi', label: 'Tu vi', value: '0', meta: EMPTY_VALUE, glyph: '✦', tone: 'jade' },
      { key: 'lucChien', label: 'Lực chiến', value: '0', glyph: '⚔', tone: 'seal' },
      { key: 'linhThach', label: 'Linh thạch', value: '0', glyph: '◈', tone: 'cyan' },
      { key: 'tienNgoc', label: 'Tiên ngọc', value: '0', glyph: '◆', tone: 'gold' },
    );
  } else {
    list.push(
      {
        key: 'tuVi',
        label: 'Tu vi',
        value: formatVN(c.exp),
        meta: game.realmFullName || c.realmKey || EMPTY_VALUE,
        glyph: '✦',
        tone: 'jade',
      },
      { key: 'lucChien', label: 'Lực chiến', value: formatVN(c.power), glyph: '⚔', tone: 'seal' },
      { key: 'linhThach', label: 'Linh thạch', value: formatVN(c.linhThach), glyph: '◈', tone: 'cyan' },
      { key: 'tienNgoc', label: 'Tiên ngọc', value: formatVN(c.tienNgoc), glyph: '◆', tone: 'gold' },
    );
  }
  if (reputation.loaded) {
    list.push({
      key: 'danhVong',
      label: 'Danh vọng',
      value: formatVN(reputation.totalReputation),
      glyph: '♛',
      tone: 'violet',
    });
  }
  list.push({
    key: 'sect',
    label: 'Tông môn',
    value: sect?.name ?? NO_SECT,
    glyph: '⛩',
    tone: 'jade',
  });
  return list;
});

/**
 * Phase 15.16 (PR 626) — Mobile compact stat tiles. Cùng nguồn store, rút
 * gọn còn 3-4 mục; danh vọng ẩn nếu chưa load.
 */
const liveStatTilesMobile = computed<HomeStatTile[]>(() => {
  const c = game.character;
  const sect = game.currentSect;
  const list: HomeStatTile[] = [
    {
      key: 'linhThach',
      label: 'Linh thạch',
      value: c ? formatVN(c.linhThach) : '0',
      glyph: '◈',
      tone: 'cyan',
    },
    {
      key: 'tienNgoc',
      label: 'Tiên ngọc',
      value: c ? formatVN(c.tienNgoc) : '0',
      glyph: '◆',
      tone: 'gold',
    },
  ];
  if (reputation.loaded) {
    list.push({
      key: 'danhVong',
      label: 'Danh vọng',
      value: formatVN(reputation.totalReputation),
      glyph: '♛',
      tone: 'violet',
    });
  }
  list.push({
    key: 'sect',
    label: 'Tông môn',
    value: sect?.name ?? NO_SECT,
    glyph: '⛩',
    tone: 'jade',
  });
  return list;
});

/** Phase 15.10 — Mail badge số thư chưa đọc, từ `game.unreadMail`. */
const liveMailBadge = computed(() => game.unreadMail);

/**
 * Phase 15.10 — Sect & chat panel info. Tên / cấp / số thành viên lấy từ
 * `game.currentSect`; nếu chưa có (chưa hydrate hoặc player chưa vào tông)
 * → empty state "Chưa gia nhập tông môn" + cấp 0.
 */
const liveSectPanel = computed(() => {
  const sect = game.currentSect;
  if (!sect) {
    return {
      title: sectPanelMock.title,
      sectName: NO_SECT,
      sectLevel: 0,
      members: '0 / 0',
    };
  }
  return {
    title: sectPanelMock.title,
    sectName: sect.name,
    sectLevel: sect.level,
    members: `${sect.memberCount}`,
  };
});

/**
 * PR-A1 (Phase 15.14) — Live wiring cho feature grid + mobile icon grid
 * badge counters (audit deep feature 2026-05-17 §10 P0). Trước đây các
 * card có badge cứng "mail 3 / missions 1 / boss 1 / friends 1" trong
 * `homeDashboardMock` — gây hiểu nhầm cho player thật. Giờ override
 * `badge` field qua live count từ `useBadgesStore` + `useGameStore.unreadMail`.
 *
 * Trả `undefined` cho key chưa có store source → feature card hide badge
 * (panel skip render khi `badge === undefined || badge === 0`).
 */
function liveBadgeFor(cardKey: string): number | undefined {
  if (cardKey === 'mail') {
    return game.unreadMail > 0 ? game.unreadMail : undefined;
  }
  if (cardKey === 'missions') {
    return badges.missionClaimable > 0 ? badges.missionClaimable : undefined;
  }
  if (cardKey === 'boss') {
    return badges.bossActive ? 1 : undefined;
  }
  if (cardKey === 'topup') {
    return badges.topupPending ? 1 : undefined;
  }
  // friends/equipment/cultivation/... chưa có store badge → ẩn.
  return undefined;
}

const liveFeatureCards = computed<HomeFeatureCard[]>(() =>
  featureCards.map((c) => ({ ...c, badge: liveBadgeFor(c.key) })),
);

const liveMobileIconGrid = computed<HomeFeatureCard[]>(() =>
  mobileIconGrid.map((c) => ({ ...c, badge: liveBadgeFor(c.key) })),
);

/* ────────────────────────────────────────────────────────────────────
 * Phase 15.16 (PR 626) — Recent quest panel wire từ `useQuestStore`.
 *
 * Lọc quest đang theo đuổi (ACCEPTED) + đã hoàn thành chưa nhận thưởng
 * (COMPLETED), bỏ LOCKED / AVAILABLE / CLAIMED. Cap 4 entry để khớp UI.
 * Nếu store chưa load hoặc rỗng → panel hiển thị empty state, KHÔNG fallback
 * về `recentQuests` mock ("Đột Phá Đại Thừa", v.v.).
 * ──────────────────────────────────────────────────────────────────── */
const QUEST_KIND_TAG: Record<QuestKind, QuestTag> = {
  main: 'main',
  realm: 'main',
  sect: 'weekly',
  npc: 'side',
  grind: 'daily',
  side: 'side',
  branch: 'side',
  hidden: 'side',
};

function progressOf(q: QuestProgressView): { current: number; total: number } {
  const total = q.steps.reduce((s, st) => s + Math.max(st.count, 1), 0);
  const current = q.steps.reduce(
    (s, st) => s + Math.min(st.currentCount, Math.max(st.count, 1)),
    0,
  );
  return { current, total: Math.max(total, 1) };
}

function rewardOf(q: QuestProgressView): { glyph: string; amount: string } {
  const r = q.rewards;
  if (r.linhThach && r.linhThach > 0) {
    return { glyph: '◈', amount: formatVN(r.linhThach) };
  }
  if (r.tienNgoc && r.tienNgoc > 0) {
    return { glyph: '◆', amount: formatVN(r.tienNgoc) };
  }
  if (r.exp && r.exp > 0) {
    return { glyph: '✦', amount: formatVN(r.exp) };
  }
  if (r.items && r.items.length > 0) {
    const total = r.items.reduce((s, it) => s + it.qty, 0);
    return { glyph: '✿', amount: `× ${total}` };
  }
  return { glyph: '✧', amount: '—' };
}

const liveRecentQuests = computed<HomeQuest[]>(() => {
  const list = questStore.quests
    .filter((q) => q.status === 'ACCEPTED' || q.status === 'COMPLETED')
    .slice(0, 4);
  return list.map((q) => ({
    key: q.key,
    tag: QUEST_KIND_TAG[q.kind] ?? 'side',
    title: q.name,
    subtitle: q.objective ?? q.description ?? '',
    progress: progressOf(q),
    reward: rewardOf(q),
    status: q.status as 'ACCEPTED' | 'COMPLETED',
  }));
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 15.16 (PR 626) — Inventory panel + equipment slots wire từ
 * `listInventory()` API.
 *
 * `equipmentSlots`: 6 ô trên silhouette tương ứng 6 slot trong
 * `EQUIP_SLOTS` chính (HAT/TRAM/ARMOR/BELT/WEAPON/BOOTS). Chỉ map slot
 * có item đang equip (`equippedSlot != null`). Plus = `refineLevel`
 * (luyện khí). Glyph theo slot (vũ khí ⚔, giáp ●, …).
 *
 * `inventoryPanel.capacity`: server hiện không trả tổng cap → chỉ hiển
 * thị `current` (số dòng inventory) trong empty-friendly form. Component
 * tự ẩn capacity bar khi `total === 0`.
 *
 * `inventoryPanel.gearPower`: chưa có endpoint; để rỗng → component ẩn.
 * ──────────────────────────────────────────────────────────────────── */
interface SlotMeta {
  position: HomeEquipmentSlot['position'];
  glyph: string;
  tone: HomeEquipmentSlot['tone'];
  label: string;
}
const SLOT_META: Partial<Record<EquipSlot, SlotMeta>> = {
  HAT: { position: 'topLeft', glyph: '◈', tone: 'gold', label: 'Mũ' },
  TRAM: { position: 'topRight', glyph: '◆', tone: 'cyan', label: 'Phù' },
  ARMOR: { position: 'midLeft', glyph: '●', tone: 'seal', label: 'Giáp' },
  BELT: { position: 'midRight', glyph: '◍', tone: 'gold', label: 'Đai' },
  WEAPON: { position: 'bottomLeft', glyph: '⚔', tone: 'cyan', label: 'Vũ khí' },
  BOOTS: { position: 'bottomRight', glyph: '✦', tone: 'jade', label: 'Giày' },
};

const inventoryItems = ref<InventoryView[]>([]);
const inventoryLoaded = ref(false);

const liveEquipmentSlots = computed<HomeEquipmentSlot[]>(() => {
  if (!inventoryLoaded.value) return [];
  const out: HomeEquipmentSlot[] = [];
  for (const it of inventoryItems.value) {
    if (!it.equippedSlot) continue;
    const meta = SLOT_META[it.equippedSlot as EquipSlot];
    if (!meta) continue;
    out.push({
      key: it.id,
      label: meta.label,
      glyph: meta.glyph,
      plus: Math.max(0, it.refineLevel ?? 0),
      tone: meta.tone,
      position: meta.position,
    });
  }
  return out;
});

const liveInventoryInfo = computed(() => {
  const total = inventoryLoaded.value ? inventoryItems.value.length : 0;
  return {
    title: 'Trang bị & Túi đồ',
    capacity: { current: total, total: 0 },
    // Không có endpoint gear power realtime → để rỗng, component ẩn block.
    gearPower: '',
  };
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 15.16 (PR 626) — Daily reward card wire từ `getDailyLoginStatus`.
 *
 * Server không expose tổng số ngày trong cycle, nhưng phía FE đã quy ước
 * cycle 7 ngày (xem `DailyLoginCard` reward grid). Hiển thị progress
 * `currentStreak % 7` / 7. Khi chưa có status (chưa login hoặc API fail)
 * → reward = null → `XTHomeHeroBanner` ẩn block, KHÔNG render "6/10" mock.
 * ──────────────────────────────────────────────────────────────────── */
const dailyStatus = ref<DailyLoginStatus | null>(null);
const DAILY_CYCLE = 7;

const liveDailyReward = computed(() => {
  const s = dailyStatus.value;
  if (!s) return null;
  const claimed = s.canClaimToday
    ? s.currentStreak % DAILY_CYCLE
    : ((s.currentStreak - 1) % DAILY_CYCLE + DAILY_CYCLE) % DAILY_CYCLE + 1;
  return {
    title: 'Phúc lợi hôm nay',
    claimed: Math.min(claimed, DAILY_CYCLE),
    total: DAILY_CYCLE,
    cta: s.canClaimToday ? 'Mở rương' : 'Đã nhận',
  };
});

/* ─────────────── lazy hydration ─────────────── */
async function hydrateRecentQuests(): Promise<void> {
  if (questStore.loaded) return;
  await questStore.load().catch(() => undefined);
}
async function hydrateReputation(): Promise<void> {
  if (reputation.loaded) return;
  await reputation.fetchState().catch(() => undefined);
}
async function hydrateInventory(): Promise<void> {
  try {
    inventoryItems.value = await listInventory();
    inventoryLoaded.value = true;
  } catch {
    // silent — panel hiển thị empty state
  }
}
async function hydrateDailyLogin(): Promise<void> {
  try {
    dailyStatus.value = await getDailyLoginStatus();
  } catch {
    dailyStatus.value = null;
  }
}

onMounted(() => {
  // Fail-soft: parallel kick, không block render. Dữ liệu null/empty đã có
  // safe state ở các computed phía trên.
  void hydrateRecentQuests();
  void hydrateReputation();
  void hydrateInventory();
  void hydrateDailyLogin();
});

function onQuickAction(key: string): void {
  switch (key) {
    case 'fast-cultivate':
      router.push('/cultivation').catch(() => null);
      break;
    case 'claim-reward':
      router.push('/missions').catch(() => null);
      break;
    case 'restore':
      router.push('/inventory').catch(() => null);
      break;
    case 'teleport':
      router.push('/world').catch(() => null);
      break;
    default:
      break;
  }
}

function onClaimReward(): void {
  router.push('/missions').catch(() => null);
}

function onResource(): void {
  router.push('/wallet').catch(() => null);
}

function onMail(): void {
  router.push('/mail').catch(() => null);
}

function onMenu(): void {
  router.push('/settings').catch(() => null);
}
</script>

<template>
  <div
    class="xt-home-dash"
    :class="[
      `xt-home-dash--${chrome}`,
      isLgUp ? 'xt-home-dash--lg' : 'xt-home-dash--sm',
    ]"
    :data-testid="testId"
  >
    <!-- ============== Standalone DESKTOP shell (sidebar + topbar) ============== -->
    <template v-if="chrome === 'standalone' && showDesktopChrome">
      <XTHomeSidebar
        :groups="sidebarGroups"
        data-testid="home-sidebar"
      />
    </template>

    <div class="xt-home-dash__main" :class="{ 'xt-home-dash__main--with-sidebar': chrome === 'standalone' && showDesktopChrome }">
      <!-- Standalone mobile header (Phase 15.10 — wired live player + resources). -->
      <XTHomeMobileHeader
        v-if="chrome === 'standalone' && showMobileChrome"
        :player="livePlayerHeader"
        :resources="liveResources"
        :mail-badge="liveMailBadge"
        :brand="heroBanner"
        @open-mail="onMail"
        @open-menu="onMenu"
        @claim-resource="onResource"
      />

      <!-- Standalone desktop topbar (Phase 15.10 — wired live). -->
      <XTHomeTopBar
        v-if="chrome === 'standalone' && showDesktopChrome"
        :player="livePlayerHeader"
        :resources="liveResources"
        :mail-badge="liveMailBadge"
        @claim-resource="onResource"
        @open-mail="onMail"
        @open-menu="onMenu"
      />

      <!-- ====== CONTENT ====== -->
      <div class="xt-home-dash__content">
        <!-- Mobile hero (compact) -->
        <XTHomeMobileHero
          v-if="showMobileChrome"
          :actions="heroQuickActions"
          data-testid="home-hero-mobile"
          @quick-action="onQuickAction"
        />

        <!-- Desktop hero banner -->
        <XTHomeHeroBanner
          v-else
          :brand="heroBanner"
          :quick-actions="heroQuickActions"
          :reward="liveDailyReward"
          test-id="home-hero"
          @quick-action="onQuickAction"
          @claim-reward="onClaimReward"
        />

        <!-- Stat tiles (Phase 15.10 — wired live tu vi / lực chiến / linh thạch /
             tiên ngọc / tông môn từ `useGameStore`, fallback 0 + "Chưa gia
             nhập tông môn" khi store rỗng). -->
        <XTHomeStatTiles
          :tiles="showMobileChrome ? liveStatTilesMobile : liveStatTiles"
          :columns="showMobileChrome ? 'four' : 'six'"
          test-id="home-stat-tiles"
        />

        <!-- Feature grid:
             Desktop: 12 card với mô tả + badge.
             Mobile: 21 mục icon-only (icon grid). -->
        <XTHomeFeatureGrid
          v-if="showDesktopChrome"
          :cards="liveFeatureCards"
          layout="auto"
          test-id="home-feature-grid"
        />
        <XTHomeFeatureGrid
          v-else
          :cards="liveMobileIconGrid"
          layout="iconGrid"
          test-id="home-feature-grid"
        />

        <!-- Bottom panels:
             Desktop: 3 cột Quest | Inventory | Sect.
             Mobile: stacked, compact variants. -->
        <div
          class="xt-home-dash__panels"
          :class="{ 'xt-home-dash__panels--mobile': showMobileChrome }"
        >
          <XTHomeQuestPanel
            :quests="liveRecentQuests"
            :compact="showMobileChrome"
            test-id="home-quest-panel"
          />
          <XTHomeInventoryPanel
            :slots="liveEquipmentSlots"
            :info="liveInventoryInfo"
            :compact="showMobileChrome"
            test-id="home-inventory-panel"
          />
          <!-- Phase 15.11 — sect panel + chat đều wire real data: header lấy
               từ `game.currentSect`; chat messages load `chatHistory('SECT')`
               + subscribe WS `chat:msg`, send qua `chatSendSect`. Player chưa
               vào tông → input disabled + empty state, KHÔNG dùng mock. -->
          <XTHomeSectChatPanel
            :info="liveSectPanel"
            :compact="showMobileChrome"
            test-id="home-sect-chat-panel"
          />
        </div>
      </div>

      <!-- Standalone bottom nav -->
      <XTHomeBottomNav
        v-if="chrome === 'standalone' && showMobileChrome"
        :items="navItems"
        data-testid="home-bottom-nav"
      />
    </div>
  </div>
</template>

<style scoped>
.xt-home-dash {
  position: relative;
  width: 100%;
  min-width: 0;
  color: var(--xt-text-primary, #f0e6cc);
  font-family: var(--xt-font-body);
}

.xt-home-dash--standalone.xt-home-dash--lg {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  align-items: start;
  min-height: 100vh;
}

.xt-home-dash--standalone.xt-home-dash--sm {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(95, 227, 198, 0.08) 0%, transparent 60%),
    linear-gradient(180deg, rgba(8, 9, 11, 0.98) 0%, rgba(4, 5, 7, 1) 100%);
}

.xt-home-dash__main {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.xt-home-dash__main--with-sidebar {
  padding: 0;
}

.xt-home-dash__content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  min-width: 0;
}

@media (min-width: 768px) {
  .xt-home-dash__content {
    gap: 16px;
    padding: 16px;
  }
}

@media (min-width: 1024px) {
  .xt-home-dash__content {
    gap: 18px;
    padding: 18px 22px;
  }
}

.xt-home-dash__panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

@media (min-width: 1024px) {
  .xt-home-dash__panels {
    grid-template-columns: 1.05fr 1.15fr 1.05fr;
    gap: 16px;
  }
}

.xt-home-dash__panels--mobile {
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

/* When embedded inside AppShell — let AppShell handle background + scroll. */
.xt-home-dash--embedded .xt-home-dash__content {
  padding: 0;
}

.xt-home-dash--embedded .xt-home-dash__main {
  background: transparent;
}
</style>
