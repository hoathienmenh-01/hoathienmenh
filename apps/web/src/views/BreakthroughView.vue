<script setup lang="ts">
/**
 * Phase 11 nâng cao §5 PR3 — Breakthrough RNG attempt + history view.
 *
 * Hiển thị lát đột phá nâng cao (RNG) cho character đang ở peak realm + cho
 * phép trigger `POST /character/breakthrough/attempt` (server-authoritative
 * RNG endpoint) + history list từ `GET /character/breakthrough/log`.
 *
 * Server-authoritative: client chỉ gửi POST không body, server tính chance
 * + roll RNG + ghi `BreakthroughAttemptLog` + advance realm khi success
 * hoặc apply `tam_ma_light` debuff khi fail.
 *
 * Layout:
 *   - Header: title + character realm + stage.
 *   - Pre-attempt card: atPeak gate hint, "Đột phá nâng cao (RNG)" button.
 *     Disable nếu chưa peak/inFlight. Server không expose chance preview
 *     trước attempt — UI chỉ hiển thị "Tỷ lệ tính lúc đột phá".
 *   - Last outcome banner (nếu vừa attempt phiên này):
 *       - Success: "Đột phá thành công" + chance breakdown details + advance.
 *       - Fail: "Tâm Ma quấy nhiễu" + chance breakdown + debuff expiresAt.
 *   - History list: filter all/success/fail, stat counts, load more, row chi
 *     tiết (attemptIndex, fromRealm → toRealm, chance%, rngRoll%, success
 *     badge, tâm ma indicator nếu fail, createdAt relative).
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire 2 endpoint server.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useBreakthroughStore } from '@/stores/breakthrough';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import type { BreakthroughHistoryFilter } from '@/stores/breakthrough';

const auth = useAuthStore();
const game = useGameStore();
const bt = useBreakthroughStore();
const toast = useToastStore();
const router = useRouter();
const { t, locale } = useI18n();

const submitting = ref(false);

/** atPeak detection: stage 9 + đủ EXP cost (mirror HomeView gate). */
const atPeak = computed<boolean>(() => {
  const c = game.character;
  if (!c) return false;
  if (c.realmStage !== 9) return false;
  try {
    return BigInt(c.exp) >= BigInt(c.expNext);
  } catch {
    return false;
  }
});

/** Realm name + stage (e.g. "Trúc Cơ Cửu Trọng"). */
const currentRealmFull = computed<string>(() => game.realmFullName);

const filterOptions: ReadonlyArray<{ key: BreakthroughHistoryFilter; label: string }> =
  [
    { key: 'all', label: 'breakthrough.history.filter.all' },
    { key: 'success', label: 'breakthrough.history.filter.success' },
    { key: 'fail', label: 'breakthrough.history.filter.fail' },
  ];

function formatChancePct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatRoll(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function formatRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t('breakthrough.history.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('breakthrough.history.minutesAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('breakthrough.history.hoursAgo', { n: hr });
  const days = Math.floor(hr / 24);
  return t('breakthrough.history.daysAgo', { n: days });
}

function formatExpiresIn(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return t('breakthrough.outcome.debuffExpired');
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  if (!game.character) await game.fetchState();
  await bt.fetchHistory();
});

async function onAttempt(): Promise<void> {
  if (submitting.value) return;
  if (!atPeak.value) {
    toast.push({ type: 'warning', text: t('breakthrough.errors.NOT_AT_PEAK') });
    return;
  }
  submitting.value = true;
  try {
    const code = await bt.attempt();
    if (code) {
      // Phase 14.3.B — server signal "cảnh giới này cần vượt Thiên Kiếp".
      // Backend trả 409 CONFLICT với code TRIBULATION_REQUIRED khi player ở
      // peak realm cao và transition đòi kiếp (ví dụ kim_dan → nguyen_anh).
      // Thay vì chỉ hiện toast lỗi khô khan, redirect sang /tribulation để
      // player thấy preview success chance + supports + button "Vượt kiếp".
      if (code === 'TRIBULATION_REQUIRED') {
        toast.push({
          type: 'info',
          text: t('breakthrough.errors.TRIBULATION_REQUIRED'),
        });
        await router.push('/tribulation');
        return;
      }
      const key = `breakthrough.errors.${code}`;
      const fallback = t('breakthrough.errors.UNKNOWN');
      const text = locale.value && key ? t(key) : fallback;
      toast.push({ type: 'warning', text: text === key ? fallback : text });
      return;
    }
    const o = bt.lastOutcome;
    if (o) {
      // Sync game store với character state mới (server post-attempt).
      // Backend trả về CharacterStatePayload trong outcome.character.
      try {
        if (o.character) await game.fetchState();
      } catch {
        // silent — UI banner đã hiển thị outcome.
      }
      toast.push({
        type: o.success ? 'system' : 'warning',
        text: o.success
          ? t('breakthrough.outcome.successToast')
          : t('breakthrough.outcome.failToast'),
      });
      // Refetch history để row mới xuất hiện.
      await bt.fetchHistory();
    }
  } finally {
    submitting.value = false;
  }
}

async function onLoadMore(): Promise<void> {
  const code = await bt.loadMoreHistory();
  if (code === 'MAX_REACHED') {
    toast.push({ type: 'info', text: t('breakthrough.history.maxReachedToast') });
  } else if (code && code !== 'IN_FLIGHT') {
    toast.push({ type: 'error', text: t('common.apiFallback.breakthrough') });
  }
}

function setFilter(f: BreakthroughHistoryFilter): void {
  bt.setHistoryFilter(f);
}
</script>

<template>
  <AppShell>
    <div class="space-y-4">
      <XTLuxHero
        eyebrow="ĐỘT PHÁ NÂNG CAO"
        label="Đột Phá Nâng Cao"
        :title="t('breakthrough.title')"
        :subtitle="t('breakthrough.subtitle')"
        tone="seal"
        watermark-letter="B"
        breadcrumb="Tu Vi · Đột Phá"
        test-id="breakthrough-hero"
        class="mb-4"
      >
        <XTPageEyebrow caps="ĐỘT PHÁ NÂNG CAO" label="Đột Phá Nâng Cao" class="sr-only" />
        <p class="text-xs text-ink-300 mt-1">
          {{ t('breakthrough.currentRealm', { realm: currentRealmFull }) }}
        </p>
      </XTLuxHero>

      <!-- Role hint + cross-nav -->
      <div class="space-y-2" data-testid="breakthrough-role-section">
        <p class="text-xs text-ink-300 leading-relaxed" data-testid="breakthrough-role-hint">
          {{ t('breakthrough.roleHint') }}
        </p>
        <nav class="flex flex-wrap gap-2 text-xs" data-testid="breakthrough-cross-nav">
          <span class="text-ink-400">{{ t('breakthrough.crossNav.label') }}:</span>
          <router-link
            to="/cultivation"
            class="text-amber-300 hover:text-amber-100 underline"
            data-testid="breakthrough-cross-nav-cultivation"
          >
            {{ t('breakthrough.crossNav.cultivation') }}
          </router-link>
          <span class="text-ink-500">·</span>
          <router-link
            to="/tribulation"
            class="text-amber-300 hover:text-amber-100 underline"
            data-testid="breakthrough-cross-nav-tribulation"
          >
            {{ t('breakthrough.crossNav.tribulation') }}
          </router-link>
        </nav>
      </div>

      <!-- Pre-attempt action card -->
      <section
        v-if="game.character"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4"
      >
        <h3 class="text-sm tracking-widest text-ink-300 uppercase mb-2">
          {{ t('breakthrough.action.title') }}
        </h3>
        <p class="text-xs text-ink-300 mb-3">
          {{ atPeak ? t('breakthrough.action.peakHint') : t('breakthrough.action.notPeakHint') }}
        </p>
        <p class="text-xs text-ink-300 mb-3">
          {{ t('breakthrough.action.chanceHint') }}
        </p>
        <MButton
          data-testid="breakthrough-attempt-btn"
          :loading="submitting || bt.inFlight"
          :disabled="!atPeak"
          @click="onAttempt"
        >
          {{ t('breakthrough.action.submit') }}
        </MButton>
      </section>

      <!-- Last outcome banner -->
      <section
        v-if="bt.lastOutcome"
        :data-testid="'breakthrough-outcome-' + (bt.lastOutcome.success ? 'success' : 'fail')"
        class="rounded border p-4"
        :class="bt.lastOutcome.success
          ? 'border-emerald-400/60 bg-emerald-900/20'
          : 'border-rose-400/60 bg-rose-900/20'"
      >
        <header class="flex items-center justify-between">
          <h3 class="text-sm tracking-widest uppercase">
            {{ bt.lastOutcome.success
              ? t('breakthrough.outcome.successTitle')
              : t('breakthrough.outcome.failTitle') }}
          </h3>
          <button
            class="text-xs text-ink-300 hover:text-ink-50"
            @click="bt.clearLastOutcome"
          >
            ✕
          </button>
        </header>
        <p class="text-xs mt-2">
          {{ t('breakthrough.outcome.transition', {
            from: bt.lastOutcome.fromRealmKey + '/' + bt.lastOutcome.fromRealmStage,
            to: bt.lastOutcome.toRealmKey + '/' + bt.lastOutcome.toRealmStage,
          }) }}
        </p>
        <dl class="grid grid-cols-2 gap-y-1 text-xs mt-3">
          <dt class="text-ink-300">{{ t('breakthrough.outcome.finalChance') }}</dt>
          <dd class="text-right">{{ formatChancePct(bt.lastOutcome.breakdown.finalChance) }}</dd>
          <dt class="text-ink-300">{{ t('breakthrough.outcome.rngRoll') }}</dt>
          <dd class="text-right">{{ formatRoll(bt.lastOutcome.rngRoll) }}</dd>
          <dt class="text-ink-300">{{ t('breakthrough.outcome.attemptIndex') }}</dt>
          <dd class="text-right">#{{ bt.lastOutcome.attemptIndex }}</dd>
        </dl>
        <details class="mt-3 text-xs">
          <summary class="cursor-pointer text-ink-300 hover:text-ink-50">
            {{ t('breakthrough.outcome.breakdownLabel') }}
          </summary>
          <dl class="grid grid-cols-2 gap-y-1 mt-2 pl-2">
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.baseChance') }}</dt>
            <dd class="text-right">{{ formatChancePct(bt.lastOutcome.breakdown.baseChance) }}</dd>
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.rootPurityBonus') }}</dt>
            <dd class="text-right">+{{ formatChancePct(bt.lastOutcome.breakdown.rootPurityBonus) }}</dd>
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.methodAffinityBonus') }}</dt>
            <dd class="text-right">+{{ formatChancePct(bt.lastOutcome.breakdown.methodAffinityBonus) }}</dd>
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.itemBonus') }}</dt>
            <dd class="text-right">+{{ formatChancePct(bt.lastOutcome.breakdown.itemBonus) }}</dd>
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.rawChance') }}</dt>
            <dd class="text-right">{{ formatChancePct(bt.lastOutcome.breakdown.rawChance) }}</dd>
            <dt class="text-ink-300">{{ t('breakthrough.breakdown.reason') }}</dt>
            <dd class="text-right">{{ bt.lastOutcome.breakdown.reason }}</dd>
          </dl>
        </details>
        <p
          v-if="bt.lastOutcome.debuff.applied"
          data-testid="breakthrough-debuff"
          class="text-xs mt-3 text-rose-300"
        >
          {{ t('breakthrough.outcome.debuffApplied', {
            key: bt.lastOutcome.debuff.key,
            expiresIn: formatExpiresIn(bt.lastOutcome.debuff.expiresAt),
          }) }}
        </p>
      </section>

      <!-- History -->
      <section class="rounded border border-ink-300/40 bg-ink-700/30 p-4">
        <header class="mb-3 flex items-center justify-between">
          <h3 class="text-sm tracking-widest text-ink-300 uppercase">
            {{ t('breakthrough.history.title') }}
          </h3>
          <span class="text-xs text-ink-300">
            {{ t('breakthrough.history.stats', {
              total: bt.historyTotalCount,
              success: bt.historySuccessCount,
              fail: bt.historyFailCount,
            }) }}
          </span>
        </header>

        <div class="flex gap-1 mb-3" role="tablist">
          <button
            v-for="opt in filterOptions"
            :key="opt.key"
            :data-testid="'breakthrough-filter-' + opt.key"
            class="px-2 py-1 text-xs rounded"
            :class="bt.historyFilter === opt.key
              ? 'bg-ink-300 text-ink-900'
              : 'bg-ink-900/50 text-ink-300 hover:bg-ink-700'"
            @click="setFilter(opt.key)"
          >
            {{ t(opt.label) }}
          </button>
        </div>

        <p
          v-if="bt.historyLoading && !bt.history"
          class="text-xs text-ink-300"
        >
          {{ t('common.loadingData') }}
        </p>
        <p
          v-else-if="bt.historyError"
          class="text-xs text-rose-300"
        >
          {{ t('breakthrough.errors.' + bt.historyError) }}
          <button
            class="ml-2 underline hover:text-ink-50"
            @click="bt.fetchHistory()"
          >
            {{ t('breakthrough.history.retry') }}
          </button>
        </p>
        <p
          v-else-if="bt.history && bt.history.length === 0"
          class="text-xs text-ink-300"
        >
          {{ t('breakthrough.history.empty') }}
        </p>
        <p
          v-else-if="bt.filteredHistory && bt.filteredHistory.length === 0"
          class="text-xs text-ink-300"
        >
          {{ t('breakthrough.history.noMatch') }}
        </p>
        <ul
          v-else-if="bt.filteredHistory"
          class="space-y-2"
        >
          <li
            v-for="row in bt.filteredHistory"
            :key="row.id"
            data-testid="breakthrough-history-row"
            class="rounded border p-2"
            :class="row.success
              ? 'border-emerald-400/40 bg-emerald-900/10'
              : 'border-rose-400/40 bg-rose-900/10'"
          >
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium tracking-wide">
                #{{ row.attemptIndex }} ·
                {{ row.fromRealmKey }}/{{ row.fromRealmStage }} →
                {{ row.toRealmKey }}/{{ row.toRealmStage }}
              </span>
              <span
                :class="row.success ? 'text-emerald-300' : 'text-rose-300'"
              >
                {{ row.success
                  ? t('breakthrough.history.successBadge')
                  : t('breakthrough.history.failBadge') }}
              </span>
            </div>
            <div class="grid grid-cols-3 gap-x-3 text-xs text-ink-300 mt-1">
              <span>{{ t('breakthrough.history.chanceShort', { n: formatChancePct(row.chance) }) }}</span>
              <span>{{ t('breakthrough.history.rollShort', { n: formatRoll(row.rngRoll) }) }}</span>
              <span class="text-right">{{ formatRelative(row.createdAt) }}</span>
            </div>
            <p
              v-if="row.tamMaActive"
              class="text-xs text-rose-300 mt-1"
              data-testid="breakthrough-history-tamma"
            >
              {{ t('breakthrough.history.tamMaIndicator') }}
            </p>
          </li>
        </ul>

        <div
          v-if="bt.historyHasMore"
          class="mt-3"
        >
          <MButton
            :loading="bt.historyLoading"
            data-testid="breakthrough-load-more"
            @click="onLoadMore"
          >
            {{ t('breakthrough.history.loadMore') }}
          </MButton>
        </div>
        <p
          v-else-if="bt.historyMaxReached"
          class="text-xs text-ink-300 mt-3"
        >
          {{ t('breakthrough.history.maxReached') }}
        </p>
      </section>
    </div>
  </AppShell>
</template>
