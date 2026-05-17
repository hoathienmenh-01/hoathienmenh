<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { useStoryDungeonStore } from '@/stores/storyDungeon';
import { getCharacter } from '@/api/character';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTStatTile from '@/components/xianxia/XTStatTile.vue';
import XTLuxSection from '@/components/xianxia/XTLuxSection.vue';
import XTHomeDashboard from '@/components/xianxia/XTHomeDashboard.vue';
import MButton from '@/components/ui/MButton.vue';
import NextActionPanel from '@/components/NextActionPanel.vue';
import OnboardingChecklist from '@/components/OnboardingChecklist.vue';
import DailyLoginCard from '@/components/DailyLoginCard.vue';
import LiveOpsTodayPanel from '@/components/LiveOpsTodayPanel.vue';
import LiveOpsNotice from '@/components/LiveOpsNotice.vue';
import LiveOpsActiveEventsPanel from '@/components/LiveOpsActiveEventsPanel.vue';
import LiveOpsAnnouncementMarquee from '@/components/LiveOpsAnnouncementMarquee.vue';
import { extractApiErrorCode } from '@/lib/apiError';

const auth = useAuthStore();
const router = useRouter();
const toast = useToastStore();
const game = useGameStore();
const badges = useBadgesStore();
const storyDungeonStore = useStoryDungeonStore();
const { t } = useI18n();

const submitting = ref(false);
const activeTab = ref<'overview' | 'events' | 'character'>('overview');

const expText = computed(() => {
  const c = game.character;
  if (!c) return '';
  return `${c.exp} / ${c.expNext}`;
});
const atPeak = computed(() => {
  const c = game.character;
  if (!c) return false;
  return c.realmStage === 9 && BigInt(c.exp) >= BigInt(c.expNext);
});

/**
 * Phase 12.8.C — Home story dungeon CTA. Hiển thị card khi:
 *  - có ≥1 dungeon `available` (player có thể vào ngay), HOẶC
 *  - có activeRun đang dở (resume).
 * Click → push `/story-dungeons`.
 */
const storyDungeonCtaVisible = computed(
  () =>
    storyDungeonStore.loaded &&
    (storyDungeonStore.hasAnyAvailable || storyDungeonStore.hasActiveRun),
);
const storyDungeonAvailableCount = computed(
  () => storyDungeonStore.availableCount,
);
const storyDungeonHasActive = computed(() => storyDungeonStore.hasActiveRun);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  const char = await getCharacter().catch(() => null);
  if (!char) {
    router.replace('/onboarding');
    return;
  }
  await game.fetchState();
  game.bindSocket();
  badges.refresh();
  // Phase 15.10 — hydrate mail unread + sect info để `XTHomeDashboard`
  // render mail badge thật + tên tông môn thật thay vì mock (3 / "Thanh
  // Vân Tông"). Fail-soft trong store nên không block flow chính.
  game.hydrateUnreadMail().catch(() => null);
  game.hydrateCurrentSect().catch(() => null);
  // Phase 12.8.C — fetch story dungeon catalog cho Home CTA. Fail-soft —
  // không block render trang chính nếu API fail.
  storyDungeonStore.load().catch(() => null);
});

async function toggleCultivate(): Promise<void> {
  if (!game.character) return;
  submitting.value = true;
  try {
    await game.setCultivating(!game.character.cultivating);
    toast.push({
      type: 'success',
      text: game.character.cultivating
        ? t('home.cultivate.startedToast')
        : t('home.cultivate.stoppedToast'),
    });
  } catch {
    toast.push({ type: 'error', text: t('auth.errors.UNKNOWN') });
  } finally {
    submitting.value = false;
  }
}

async function onBreakthrough(): Promise<void> {
  submitting.value = true;
  try {
    await game.breakthrough();
    toast.push({ type: 'system', text: t('home.breakthrough.successToast') });
  } catch (e) {
    const code = extractApiErrorCode(e);
    if (code === 'NOT_AT_PEAK') {
      toast.push({ type: 'warning', text: t('home.breakthrough.notAtPeakToast') });
    } else {
      toast.push({ type: 'error', text: t('auth.errors.UNKNOWN') });
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppShell>
    <header class="mb-3 ve-section-enter" data-testid="home-eyebrow">
      <XTPageEyebrow label="Tiên Du Quy Xứ" />
    </header>

    <LiveOpsAnnouncementMarquee class="mb-2 ve-section-enter ve-section-enter-delay-1" />

    <!-- Luxury home dashboard (UI-3.2): hero / stat tiles / feature grid /
         quest|inventory|sect panels. Render bên trong AppShell nên dùng
         chrome="embedded" để không double-stack sidebar / bottom-nav. -->
    <XTHomeDashboard
      v-if="game.character"
      chrome="embedded"
      class="mb-4 ve-section-enter ve-section-enter-delay-2"
      data-testid="home-dashboard"
    />

    <!-- Tab navigation -->
    <nav
      v-if="game.character"
      class="mb-4 flex gap-1 rounded-xl border border-[rgba(242,215,137,0.2)] bg-[rgba(14,19,24,0.6)] p-1 ve-section-enter ve-section-enter-delay-1"
      data-testid="home-tabs"
    >
      <button
        v-for="tab in (['overview', 'events', 'character'] as const)"
        :key="tab"
        type="button"
        class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold tracking-wide transition-all"
        :class="activeTab === tab
          ? 'bg-gradient-to-r from-[rgba(27,59,52,0.85)] to-[rgba(74,59,24,0.65)] text-[var(--xt-jade-bright)] shadow-[0_0_12px_rgba(95,227,198,0.18)] ring-1 ring-[rgba(242,215,137,0.35)]'
          : 'text-[var(--xt-text-muted)] hover:text-[var(--xt-text-primary)] hover:bg-[rgba(95,227,198,0.06)]'"
        @click="activeTab = tab"
      >
        {{
          tab === 'overview' ? t('home.tabs.overview', 'T\u1ED5ng Quan')
          : tab === 'events' ? t('home.tabs.events', 'S\u1EF1 Ki\u1EC7n')
            : t('home.tabs.character', 'Nh\u00E2n V\u1EADt')
        }}
      </button>
    </nav>

    <!-- ============= TAB: Overview ============= -->
    <div v-if="game.character && activeTab === 'overview'">
      <!-- Phase 15.12 — Overview action strip. Tên / cảnh giới / EXP / HP /
           MP / lực chiến đã được render trong `XTHomeDashboard` (hero +
           stat tiles) ở trên (PR 2 đã wire real data). Ở đây chỉ giữ 2
           hành động gameplay (cultivate toggle + breakthrough) + last-tick
           info để player thao tác trực tiếp từ Overview, KHÔNG lặp lại
           tên / cảnh giới / lực chiến. Detail summary đầy đủ thuộc về
           Character tab. -->
      <section
        class="mb-4 rounded-xl border border-[rgba(242,215,137,0.25)] bg-[rgba(14,19,24,0.55)] p-3 ve-section-enter ve-section-enter-delay-2 ve-card-interactive"
        data-testid="home-char-actions"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <XTPageEyebrow
            label="Đạo Thân Tiên Cốt"
            test-id="home-char-summary-eyebrow"
          />
          <div class="flex gap-2">
            <MButton size="sm" :loading="submitting" @click="toggleCultivate">
              {{ game.character.cultivating ? t('home.cultivate.stop') : t('home.cultivate.start') }}
            </MButton>
            <MButton size="sm" :loading="submitting" :disabled="!atPeak" @click="onBreakthrough">
              {{ t('home.breakthrough.submit') }}
            </MButton>
          </div>
        </div>
        <p v-if="game.lastTickAt" class="text-xs text-ink-300 mt-2">
          {{ t('home.lastTick', { gain: game.lastTickGain, time: new Date(game.lastTickAt).toLocaleTimeString() }) }}
        </p>
      </section>

      <DailyLoginCard class="mb-4 ve-section-enter ve-section-enter-delay-3" />
      <OnboardingChecklist class="mb-4 ve-section-enter ve-section-enter-delay-3" />
      <NextActionPanel class="mb-4 ve-section-enter ve-section-enter-delay-4" />

      <!-- Quick actions grid -->
      <div class="grid grid-cols-2 gap-3 mb-4 ve-section-enter ve-section-enter-delay-5">
        <section
          class="rounded-xl border border-amber-300/30 bg-[rgba(14,19,24,0.55)] p-3 ve-card-interactive cursor-pointer"
          data-test="home-sect-mission-cta"
          @click="router.push('/sect-war?tab=missions')"
        >
          <div class="text-sm text-amber-200 font-medium">{{ t('homeLiveOps.sectMissionTitle') }}</div>
          <div class="text-xs text-ink-300/80 truncate mt-1">{{ t('homeLiveOps.sectMissionDesc') }}</div>
        </section>
        <section
          v-if="storyDungeonCtaVisible"
          class="rounded-xl border border-violet-400/40 bg-[rgba(14,19,24,0.55)] p-3 ve-card-interactive flex items-center justify-between gap-3"
          data-testid="home-story-dungeon-cta"
        >
          <div class="min-w-0">
            <div class="text-sm text-violet-200 font-medium">{{ t('home.storyDungeon.title') }}</div>
            <div class="text-xs text-ink-300/80 truncate mt-1">
              {{ storyDungeonHasActive ? t('home.storyDungeon.descActive') : t('home.storyDungeon.descAvailable', { n: storyDungeonAvailableCount }) }}
            </div>
          </div>
          <MButton @click="router.push('/story-dungeons')">
            {{ t('home.storyDungeon.openBtn') }}
          </MButton>
        </section>
      </div>

      <!-- Stats compact - luxury tiles -->
      <XTLuxSection
        :eyebrow="t('home.stats.title')"
        tone="gold"
        surface="card"
        padding="tight"
        class="ve-section-enter ve-section-enter-delay-5"
        test-id="home-stats-section"
      >
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <XTStatTile
            :label="t('home.stats.power')"
            :value="game.character.power"
            tone="seal"
            icon="combat"
            test-id="home-stat-power"
          />
          <XTStatTile
            :label="t('home.stats.spirit')"
            :value="game.character.spirit"
            tone="jade"
            icon="cultivation"
            test-id="home-stat-spirit"
          />
          <XTStatTile
            :label="t('home.stats.speed')"
            :value="game.character.speed"
            tone="mist"
            icon="quest"
            test-id="home-stat-speed"
          />
          <XTStatTile
            :label="t('home.stats.luck')"
            :value="game.character.luck"
            tone="gold"
            icon="gift"
            test-id="home-stat-luck"
          />
        </div>
      </XTLuxSection>
    </div>

    <!-- ============= TAB: Events ============= -->
    <div v-if="game.character && activeTab === 'events'">
      <DailyLoginCard class="mb-4 ve-section-enter" />
      <LiveOpsTodayPanel class="mb-4 ve-section-enter ve-section-enter-delay-1" />
      <LiveOpsActiveEventsPanel class="mb-4 ve-section-enter ve-section-enter-delay-2" />
      <LiveOpsNotice class="ve-section-enter ve-section-enter-delay-3" />
    </div>

    <!-- ============= TAB: Character ============= -->
    <div v-if="game.character && activeTab === 'character'">
      <!-- Phase 15.12 — Character tab giữ EXP / HP / MP bars + cultivate /
           breakthrough actions; tên + cảnh giới đã hiển thị ở `XTHomeDashboard`
           hero ở trên, không lặp lại header nữa để tránh duplicate. -->
      <section
        class="mb-4 rounded-xl border border-[rgba(242,215,137,0.25)] bg-[rgba(14,19,24,0.55)] p-5 ve-section-enter ve-card-glow"
        data-testid="home-char-detail"
      >
        <XTPageEyebrow
          label="Trạng Thái Cốt Thân"
          class="mb-3"
          test-id="home-char-detail-eyebrow"
        />
        <div class="space-y-3">
          <div>
            <div class="flex justify-between text-xs text-ink-300">
              <span>{{ t('home.expLabel') }}</span>
              <span>{{ expText }}</span>
            </div>
            <div class="h-2.5 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                :class="game.character.cultivating ? 'bg-emerald-400 shadow-[0_0_10px_rgba(95,227,198,0.6)]' : 'bg-ink-300'"
                :style="{ width: Math.round(game.expProgress * 100) + '%' }"
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-ink-300 flex justify-between"><span>HP</span><span>{{ game.character.hp }} / {{ game.character.hpMax }}</span></div>
              <div class="h-2 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
                <div class="h-full rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.4)]" :style="{ width: (game.character.hp / game.character.hpMax) * 100 + '%' }" />
              </div>
            </div>
            <div>
              <div class="text-xs text-ink-300 flex justify-between"><span>MP</span><span>{{ game.character.mp }} / {{ game.character.mpMax }}</span></div>
              <div class="h-2 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
                <div class="h-full rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.4)]" :style="{ width: (game.character.mp / game.character.mpMax) * 100 + '%' }" />
              </div>
            </div>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <MButton :loading="submitting" @click="toggleCultivate">
            {{ game.character.cultivating ? t('home.cultivate.stop') : t('home.cultivate.start') }}
          </MButton>
          <MButton :loading="submitting" :disabled="!atPeak" @click="onBreakthrough">
            {{ t('home.breakthrough.submit') }}
          </MButton>
        </div>
        <p v-if="game.lastTickAt" class="text-xs text-ink-300 mt-3">
          {{ t('home.lastTick', { gain: game.lastTickGain, time: new Date(game.lastTickAt).toLocaleTimeString() }) }}
        </p>
      </section>

      <section class="rounded-xl border border-ink-300/40 bg-[rgba(14,19,24,0.55)] p-5 ve-section-enter ve-section-enter-delay-1 ve-card-interactive">
        <h3 class="text-sm tracking-widest text-ink-300 uppercase mb-3">{{ t('home.stats.title') }}</h3>
        <dl class="grid grid-cols-2 gap-y-2 text-sm">
          <dt class="text-ink-300">{{ t('home.stats.power') }}</dt>
          <dd class="text-right font-bold text-[var(--xt-jade-bright)]">{{ game.character.power }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.spirit') }}</dt>
          <dd class="text-right font-bold text-[var(--xt-gold-bright)]">{{ game.character.spirit }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.speed') }}</dt>
          <dd class="text-right font-bold text-sky-400">{{ game.character.speed }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.luck') }}</dt>
          <dd class="text-right font-bold text-amber-300">{{ game.character.luck }}</dd>
        </dl>
      </section>
    </div>

    <div v-if="!game.character" class="text-center text-ink-300">{{ t('home.loadingChar') }}</div>
  </AppShell>
</template>
