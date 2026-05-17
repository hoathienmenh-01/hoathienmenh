<script setup lang="ts">
/**
 * Phase 15.17 (PR 627) — Daily Loop Panel.
 *
 * "Hôm nay làm gì?" aggregator — surfaces 8 key daily activities from
 * existing stores/APIs into structured cards with status + reward hint + Go.
 *
 * Data sources (all already hydrated by HomeView / XTHomeDashboard onMount):
 *   - `getDailyLoginStatus()` → daily reward
 *   - `game.character.cultivating` → cultivation status
 *   - `badges.missionClaimable` → missions ready to claim
 *   - `questStore.claimableCount` → quests ready to claim
 *   - `badges.bossActive` → boss available
 *   - `game.currentSect` → sect contribution
 *   - `game.unreadMail` → mail to check
 *   - `badges.breakthroughReady` → breakthrough gate
 *
 * Fail-soft: if any source is unavailable, that activity simply hides.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { useQuestStore } from '@/stores/quest';
import { getDailyLoginStatus, type DailyLoginStatus } from '@/api/dailyLogin';

export type ActivityStatus = 'claimable' | 'active' | 'available' | 'completed' | 'locked';

export interface DailyActivity {
  key: string;
  title: string;
  status: ActivityStatus;
  statusLabel: string;
  rewardHint?: string;
  route: string;
  glyph: string;
}

const { t } = useI18n();
const router = useRouter();
const game = useGameStore();
const badges = useBadgesStore();
const questStore = useQuestStore();

const dailyStatus = ref<DailyLoginStatus | null>(null);

onMounted(async () => {
  try {
    dailyStatus.value = await getDailyLoginStatus();
  } catch {
    dailyStatus.value = null;
  }
});

const activities = computed<DailyActivity[]>(() => {
  const list: DailyActivity[] = [];
  const c = game.character;
  if (!c) return list;

  // 1. Daily login
  if (dailyStatus.value) {
    const ds = dailyStatus.value;
    list.push({
      key: 'daily-login',
      title: t('dailyLoop.dailyLogin.title', 'Nhận thưởng đăng nhập'),
      status: ds.canClaimToday ? 'claimable' : 'completed',
      statusLabel: ds.canClaimToday
        ? t('dailyLoop.status.claimable', 'Nhận ngay')
        : t('dailyLoop.status.completed', 'Hoàn thành'),
      rewardHint: ds.canClaimToday
        ? t('dailyLoop.dailyLogin.reward', { amount: ds.nextRewardLinhThach })
        : undefined,
      route: '/home',
      glyph: '🎁',
    });
  }

  // 2. Cultivation
  list.push({
    key: 'cultivate',
    title: t('dailyLoop.cultivate.title', 'Tu luyện'),
    status: c.cultivating ? 'active' : 'available',
    statusLabel: c.cultivating
      ? t('dailyLoop.status.active', 'Đang chạy')
      : t('dailyLoop.status.available', 'Bắt đầu'),
    rewardHint: c.cultivating
      ? t('dailyLoop.cultivate.rewardActive', 'Đang tích luỹ tu vi')
      : t('dailyLoop.cultivate.rewardIdle', 'Bắt đầu để nhận tu vi'),
    route: '/cultivation',
    glyph: '✦',
  });

  // 3. Missions claimable
  if (badges.missionClaimable > 0) {
    list.push({
      key: 'missions',
      title: t('dailyLoop.missions.title', 'Nhiệm vụ có thể nhận'),
      status: 'claimable',
      statusLabel: t('dailyLoop.missions.count', { n: badges.missionClaimable }),
      rewardHint: t('dailyLoop.missions.reward', 'Linh thạch + EXP'),
      route: '/missions',
      glyph: '✎',
    });
  }

  // 4. Quests claimable
  if (questStore.claimableCount > 0) {
    list.push({
      key: 'quests',
      title: t('dailyLoop.quests.title', 'Nhiệm vụ hoàn thành'),
      status: 'claimable',
      statusLabel: t('dailyLoop.quests.count', { n: questStore.claimableCount }),
      rewardHint: t('dailyLoop.quests.reward', 'Phần thưởng chờ nhận'),
      route: '/missions',
      glyph: '📜',
    });
  }

  // 5. Boss active
  if (badges.bossActive) {
    list.push({
      key: 'boss',
      title: t('dailyLoop.boss.title', 'Boss xuất hiện'),
      status: 'available',
      statusLabel: t('dailyLoop.status.available', 'Thách đấu'),
      rewardHint: t('dailyLoop.boss.reward', 'Rơi trang bị + linh thạch'),
      route: '/boss',
      glyph: '☠',
    });
  }

  // 6. Sect contribution
  if (game.currentSect) {
    list.push({
      key: 'sect',
      title: t('dailyLoop.sect.title', 'Đóng góp tông môn'),
      status: 'available',
      statusLabel: t('dailyLoop.status.available', 'Tham gia'),
      rewardHint: t('dailyLoop.sect.reward', 'Công hiến + uy danh'),
      route: '/sect-war?tab=missions',
      glyph: '⛩',
    });
  }

  // 7. Mail unread
  if (game.unreadMail > 0) {
    list.push({
      key: 'mail',
      title: t('dailyLoop.mail.title', 'Thư chưa đọc'),
      status: 'available',
      statusLabel: t('dailyLoop.mail.count', { n: game.unreadMail }),
      rewardHint: t('dailyLoop.mail.reward', 'Có thể chứa phần thưởng'),
      route: '/mail',
      glyph: '✉',
    });
  }

  // 8. Breakthrough ready
  if (badges.breakthroughReady) {
    list.push({
      key: 'breakthrough',
      title: t('dailyLoop.breakthrough.title', 'Đột phá cảnh giới'),
      status: 'claimable',
      statusLabel: t('dailyLoop.status.claimable', 'Sẵn sàng'),
      rewardHint: t('dailyLoop.breakthrough.reward', 'Tăng cảnh giới + mở khoá'),
      route: '/breakthrough',
      glyph: '⚡',
    });
  }

  return list;
});

function statusClass(status: ActivityStatus): string {
  switch (status) {
    case 'claimable':
      return 'xt-daily-loop__item--claimable';
    case 'active':
      return 'xt-daily-loop__item--active';
    case 'completed':
      return 'xt-daily-loop__item--completed';
    default:
      return '';
  }
}

function go(route: string): void {
  router.push(route).catch(() => null);
}
</script>

<template>
  <section
    v-if="activities.length > 0"
    class="xt-daily-loop"
    data-testid="daily-loop-panel"
  >
    <header class="xt-daily-loop__header">
      <h3 class="xt-daily-loop__title">
        {{ t('dailyLoop.title', 'Hôm nay làm gì?') }}
      </h3>
      <span class="xt-daily-loop__count">{{ activities.length }}</span>
    </header>

    <ul class="xt-daily-loop__list">
      <li
        v-for="act in activities"
        :key="act.key"
        class="xt-daily-loop__item"
        :class="statusClass(act.status)"
        :data-testid="`daily-loop-item-${act.key}`"
      >
        <span class="xt-daily-loop__glyph" aria-hidden="true">{{ act.glyph }}</span>
        <div class="xt-daily-loop__body">
          <p class="xt-daily-loop__item-title">{{ act.title }}</p>
          <p v-if="act.rewardHint" class="xt-daily-loop__reward">{{ act.rewardHint }}</p>
        </div>
        <div class="xt-daily-loop__right">
          <span class="xt-daily-loop__status">{{ act.statusLabel }}</span>
          <button
            v-if="act.status !== 'completed'"
            type="button"
            class="xt-daily-loop__go"
            :data-testid="`daily-loop-go-${act.key}`"
            @click="go(act.route)"
          >
            {{ t('dailyLoop.go', 'Đi') }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.xt-daily-loop {
  border-radius: 16px;
  border: 1px solid rgba(242, 215, 137, 0.3);
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.82) 0%, rgba(8, 9, 11, 0.94) 100%);
  padding: 14px;
  color: var(--xt-text-primary, #f0e6cc);
}

.xt-daily-loop__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.xt-daily-loop__title {
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 14px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-daily-loop__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(95, 227, 198, 0.15);
  border: 1px solid rgba(95, 227, 198, 0.4);
  color: var(--xt-jade-bright, #5fe3c6);
  font-size: 11px;
  font-weight: 700;
}

.xt-daily-loop__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.xt-daily-loop__item {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(242, 215, 137, 0.2);
  background: rgba(14, 19, 24, 0.6);
  transition: border-color 220ms ease, transform 140ms ease;
}

.xt-daily-loop__item:hover {
  border-color: rgba(242, 215, 137, 0.5);
  transform: translateY(-1px);
}

.xt-daily-loop__item--claimable {
  border-color: rgba(95, 227, 198, 0.5);
  background: rgba(95, 227, 198, 0.06);
}

.xt-daily-loop__item--active {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.05);
}

.xt-daily-loop__item--completed {
  border-color: rgba(100, 116, 139, 0.3);
  opacity: 0.6;
}

.xt-daily-loop__glyph {
  font-size: 20px;
  text-align: center;
  line-height: 1;
}

.xt-daily-loop__body {
  min-width: 0;
}

.xt-daily-loop__item-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--xt-text-primary, #f0e6cc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-daily-loop__reward {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
}

.xt-daily-loop__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.xt-daily-loop__status {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
  font-weight: 600;
}

.xt-daily-loop__item--active .xt-daily-loop__status {
  color: rgb(56, 189, 248);
}

.xt-daily-loop__item--completed .xt-daily-loop__status {
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
}

.xt-daily-loop__go {
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid rgba(242, 215, 137, 0.45);
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: var(--xt-gold-bright, #f2d789);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.xt-daily-loop__go:hover {
  border-color: rgba(242, 215, 137, 0.8);
  box-shadow: 0 0 10px rgba(242, 215, 137, 0.25);
}

@media (prefers-reduced-motion: reduce) {
  .xt-daily-loop__item {
    transition: none;
  }
  .xt-daily-loop__item:hover {
    transform: none;
  }
}
</style>
