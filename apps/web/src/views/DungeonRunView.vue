<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { itemByKey, realmByKey, type DungeonDef, type RolledLoot } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useDungeonRunStore } from '@/stores/dungeonRun';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import type {
  DungeonAvailabilityView,
  DungeonClaimResult,
} from '@/api/dungeonRun';

/**
 * Phase 12.2.C — DungeonRun runtime view (multi-encounter expedition).
 *
 * Server-authoritative: list catalog với availability flags + active run
 * (`GET /dungeons/me`); start/next/claim qua server CAS guard. UI chỉ
 * render trạng thái + dispatch action; KHÔNG tự cộng EXP/tiền/item.
 *
 * UI MODULE RULE — list + filter (lockReason chip group) + counters +
 * loading/empty/error + active run card (progress + kill log + next +
 * claim) + claim modal preview reward + i18n vi/en. Pagination chưa cần
 * (catalog hiện tại 9 dungeon).
 */

const auth = useAuthStore();
const game = useGameStore();
const store = useDungeonRunStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const loading = computed(() => store.loading);
const loaded = computed(() => store.loaded);
const lastError = computed(() => store.lastError);
const available = computed(() => store.available);
const activeRun = computed(() => store.activeRun);
const submittingKey = computed(() => store.submittingKey);

type LockFilter = 'all' | 'startable' | 'locked';
const lockFilter = ref<LockFilter>('all');
const FILTERS: LockFilter[] = ['all', 'startable', 'locked'];

const filteredAvailability = computed<DungeonAvailabilityView[]>(() => {
  if (lockFilter.value === 'startable') {
    return available.value.filter((a) => a.startable);
  }
  if (lockFilter.value === 'locked') {
    return available.value.filter((a) => !a.startable);
  }
  return available.value;
});

const totalCount = computed(() => store.totalCount);
const filteredCount = computed(() => filteredAvailability.value.length);
const startableCount = computed(() => store.startableCount);

/** Modal hiển thị reward grant sau claim thành công. */
const claimModal = ref<DungeonClaimResult | null>(null);

function realmDisplay(key: string): string {
  return realmByKey(key)?.name ?? key;
}

function dungeonName(d: DungeonDef): string {
  return d.name;
}

/**
 * Phase 12.3 — format per-encounter loot drop ngắn gọn cho kill log.
 * Resolve `itemByKey` để hiển thị tên người đọc, fallback `itemKey` raw.
 * Output dạng `+itemName ×qty, +otherItem ×qty`.
 */
function formatLoot(loot: RolledLoot[]): string {
  return loot
    .map((l) => {
      const name = itemByKey(l.itemKey)?.name ?? l.itemKey;
      return t('dungeonRun.lootedItem', { name, qty: l.qty });
    })
    .join(', ');
}

function startDisabled(av: DungeonAvailabilityView): boolean {
  return (
    !av.startable ||
    submittingKey.value !== null ||
    activeRun.value?.status === 'ACTIVE' ||
    activeRun.value?.status === 'COMPLETED'
  );
}

function lockReasonLabel(av: DungeonAvailabilityView): string {
  if (!av.lockReason) return '';
  return t(`dungeonRun.lockReason.${av.lockReason}`);
}

async function onStart(av: DungeonAvailabilityView): Promise<void> {
  try {
    await store.start(av.dungeon.key);
    toast.push({
      type: 'success',
      text: t('dungeonRun.startToast', { name: av.dungeon.name }),
    });
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({
      type: 'error',
      text: t(`dungeonRun.errors.${code}`, t('dungeonRun.errors.UNKNOWN')),
    });
  }
}

async function onNext(): Promise<void> {
  try {
    const next = await store.next();
    if (next.status === 'COMPLETED') {
      toast.push({
        type: 'success',
        text: t('dungeonRun.completedToast'),
      });
    } else {
      toast.push({
        type: 'info',
        text: t('dungeonRun.advanceToast', {
          cur: next.encounterIndex,
          total: next.totalEncounters,
        }),
      });
    }
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({
      type: 'error',
      text: t(`dungeonRun.errors.${code}`, t('dungeonRun.errors.UNKNOWN')),
    });
  }
}

async function onClaim(): Promise<void> {
  try {
    const result = await store.claim();
    claimModal.value = result;
    toast.push({
      type: 'success',
      text: t('dungeonRun.claimToast', {
        linhThach: result.granted.linhThach,
        exp: result.granted.exp,
      }),
    });
    // Phase 16.5 — Daily Reward Cap toast nhẹ khi server cắt phần thưởng.
    // Optional chaining bảo đảm pre-16.5 server không crash FE.
    if (result.capped) {
      toast.push({
        type: 'info',
        text:
          t('dungeonRun.dailyCapReached', '__missing__') === '__missing__'
            ? 'Hôm nay bạn đã đạt giới hạn nhận thưởng nguồn này.'
            : t('dungeonRun.dailyCapReached'),
      });
    }
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({
      type: 'error',
      text: t(`dungeonRun.errors.${code}`, t('dungeonRun.errors.UNKNOWN')),
    });
  }
}

function closeClaimModal(): void {
  claimModal.value = null;
  store.clearLastClaimResult();
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  if (!game.character) {
    router.replace('/onboarding');
    return;
  }
  await store.load();
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4" data-testid="dungeon-run-view">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">
            {{ t('dungeonRun.title') }}
          </h1>
          <p class="text-sm text-ink-300">{{ t('dungeonRun.subtitle') }}</p>
        </div>
        <div class="text-right text-xs text-ink-300 space-y-0.5">
          <div data-testid="dungeon-run-total-count">
            {{ t('dungeonRun.totalCount', { n: totalCount }) }}
          </div>
          <div data-testid="dungeon-run-startable-count">
            {{ t('dungeonRun.startableCount', { n: startableCount }) }}
          </div>
        </div>
      </header>

      <!-- Active run card -->
      <section
        v-if="activeRun"
        class="bg-ink-700/40 border border-amber-400/40 rounded p-4 space-y-3"
        data-testid="dungeon-run-active"
      >
        <header class="flex items-baseline justify-between gap-2 flex-wrap">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span
              class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-200"
            >
              {{ t('dungeonRun.activeBadge') }}
            </span>
            <h2 class="font-bold text-amber-100" data-testid="dungeon-run-active-name">
              {{ activeRun.templateKey }}
            </h2>
          </div>
          <span
            class="text-xs px-2 py-0.5 rounded"
            :class="{
              'bg-amber-700/40 text-amber-100': activeRun.status === 'ACTIVE',
              'bg-emerald-700/40 text-emerald-100': activeRun.status === 'COMPLETED',
              'bg-ink-600/40 text-ink-200': activeRun.status === 'CLAIMED' || activeRun.status === 'ABANDONED',
            }"
            data-testid="dungeon-run-active-status"
          >
            {{ t(`dungeonRun.status.${activeRun.status}`) }}
          </span>
        </header>

        <div
          class="text-xs text-ink-300"
          data-testid="dungeon-run-active-progress"
        >
          {{ t('dungeonRun.progress', { cur: activeRun.encounterIndex, total: activeRun.totalEncounters }) }}
        </div>

        <div
          v-if="activeRun.currentMonster"
          class="bg-ink-800/60 border border-ink-300/20 rounded px-3 py-2 text-sm"
          data-testid="dungeon-run-active-monster"
        >
          <div class="text-xs text-ink-300">
            {{ t('dungeonRun.currentMonster') }}
          </div>
          <div class="font-bold text-ink-100">
            {{ activeRun.currentMonster.name }}
            <span class="text-xs text-ink-300 ml-1">
              {{ t('dungeonRun.monsterStat', {
                lv: activeRun.currentMonster.level,
                hp: activeRun.currentMonster.hp,
                atk: activeRun.currentMonster.atk,
              }) }}
            </span>
          </div>
        </div>

        <div
          v-if="activeRun.killedMonsters.length > 0"
          class="text-xs text-ink-300 space-y-0.5"
          data-testid="dungeon-run-active-killed"
        >
          <div class="text-ink-200 font-semibold">
            {{ t('dungeonRun.killedTitle', { n: activeRun.killedMonsters.length }) }}
          </div>
          <ul class="list-disc list-inside">
            <li
              v-for="(k, idx) in activeRun.killedMonsters"
              :key="`${k.monsterKey}-${idx}`"
              :data-testid="`dungeon-run-killed-${idx}`"
            >
              <span>{{ k.monsterKey }}</span>
              <span
                v-if="k.loot && k.loot.length > 0"
                class="ml-2 text-emerald-300"
                :data-testid="`dungeon-run-killed-${idx}-loot`"
              >
                {{ formatLoot(k.loot) }}
              </span>
            </li>
          </ul>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="activeRun.status === 'ACTIVE'"
            type="button"
            class="px-3 py-1.5 rounded border border-sky-400/50 bg-sky-700/40 text-sky-100 hover:bg-sky-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="submittingKey !== null"
            data-testid="dungeon-run-next"
            @click="onNext()"
          >
            {{ t('dungeonRun.next') }}
          </button>

          <button
            v-if="activeRun.status === 'COMPLETED' && activeRun.claimedAt === null"
            type="button"
            class="px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="submittingKey !== null"
            data-testid="dungeon-run-claim"
            @click="onClaim()"
          >
            {{ t('dungeonRun.claim') }}
          </button>

          <span
            v-if="activeRun.status === 'COMPLETED' && activeRun.reward"
            class="text-xs text-emerald-200"
            data-testid="dungeon-run-reward-preview"
          >
            {{ t('dungeonRun.rewardPreview', {
              linhThach: activeRun.reward.linhThach ?? 0,
              tienNgoc: activeRun.reward.tienNgoc ?? 0,
              exp: activeRun.reward.exp ?? 0,
            }) }}
          </span>
        </div>
      </section>

      <!-- Filter bar -->
      <nav
        class="flex flex-wrap gap-2 text-sm"
        data-testid="dungeon-run-filter-bar"
      >
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          class="px-3 py-1.5 rounded border transition"
          :class="
            lockFilter === f
              ? 'border-amber-400/60 bg-amber-700/40 text-amber-100'
              : 'border-ink-300/30 bg-ink-700/30 text-ink-200 hover:bg-ink-700/50'
          "
          :data-testid="`dungeon-run-filter-${f}`"
          @click="lockFilter = f"
        >
          {{ t(`dungeonRun.filter.${f}`) }}
        </button>
      </nav>

      <!-- Loading / error / empty / list -->
      <div
        v-if="loading && !loaded"
        class="text-ink-300 text-sm"
        data-testid="dungeon-run-loading"
      >
        {{ t('common.loadingData') }}
      </div>

      <div
        v-else-if="lastError"
        class="bg-rose-900/30 border border-rose-400/30 rounded p-4 text-sm text-rose-100"
        data-testid="dungeon-run-error"
      >
        {{ t(`dungeonRun.errors.${lastError}`, t('dungeonRun.errors.UNKNOWN')) }}
      </div>

      <div
        v-else-if="loaded && filteredCount === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="dungeon-run-empty"
      >
        {{
          lockFilter === 'all'
            ? t('dungeonRun.empty')
            : t('dungeonRun.emptyFiltered', { filter: t(`dungeonRun.filter.${lockFilter}`) })
        }}
      </div>

      <ul
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="dungeon-run-list"
      >
        <li
          v-for="av in filteredAvailability"
          :key="av.dungeon.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
          :class="{ 'opacity-70': !av.startable }"
          :data-testid="`dungeon-run-row-${av.dungeon.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <h3 class="font-bold text-amber-100">{{ dungeonName(av.dungeon) }}</h3>
              <p class="text-xs text-ink-300">
                {{ t('dungeonRun.realmHint', { realm: realmDisplay(av.dungeon.recommendedRealm) }) }}
              </p>
            </div>
            <span
              v-if="av.lockReason"
              class="text-xs px-2 py-0.5 rounded bg-rose-700/40 text-rose-100"
              :data-testid="`dungeon-run-lock-${av.dungeon.key}`"
            >
              {{ lockReasonLabel(av) }}
            </span>
            <span
              v-else
              class="text-xs px-2 py-0.5 rounded bg-emerald-700/40 text-emerald-100"
              :data-testid="`dungeon-run-startable-${av.dungeon.key}`"
            >
              {{ t('dungeonRun.startableBadge') }}
            </span>
          </header>

          <p class="text-xs text-ink-300 leading-relaxed">{{ av.dungeon.description }}</p>

          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-300">
            <div>
              <dt class="text-ink-400">{{ t('dungeonRun.metric.encounters') }}</dt>
              <dd class="text-ink-100">{{ av.dungeon.monsters.length }}</dd>
            </div>
            <div>
              <dt class="text-ink-400">{{ t('dungeonRun.metric.stamina') }}</dt>
              <dd class="text-ink-100">{{ av.dungeon.staminaEntry }}</dd>
            </div>
            <div v-if="av.dailyLimit !== null">
              <dt class="text-ink-400">{{ t('dungeonRun.metric.dailyUsed') }}</dt>
              <dd
                class="text-ink-100"
                :data-testid="`dungeon-run-daily-${av.dungeon.key}`"
              >
                {{ av.dailyUsed }} / {{ av.dailyLimit }}
              </dd>
            </div>
            <div v-if="av.dungeon.runReward">
              <dt class="text-ink-400">{{ t('dungeonRun.metric.bonusReward') }}</dt>
              <dd class="text-emerald-200">
                {{ t('dungeonRun.rewardPreview', {
                  linhThach: av.dungeon.runReward.linhThach ?? 0,
                  tienNgoc: av.dungeon.runReward.tienNgoc ?? 0,
                  exp: av.dungeon.runReward.exp ?? 0,
                }) }}
              </dd>
            </div>
          </dl>

          <div class="flex items-center justify-end">
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-amber-400/50 bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="startDisabled(av)"
              :data-testid="`dungeon-run-start-${av.dungeon.key}`"
              @click="onStart(av)"
            >
              {{ t('dungeonRun.start') }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Claim reward modal -->
    <div
      v-if="claimModal"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4"
      data-testid="dungeon-run-claim-modal"
      @click.self="closeClaimModal()"
    >
      <div
        class="bg-ink-800 border border-emerald-400/40 rounded p-5 max-w-md w-full space-y-3"
      >
        <h2 class="text-lg font-bold text-emerald-100">
          {{ t('dungeonRun.claimModal.title') }}
        </h2>
        <p class="text-sm text-ink-200">
          {{ t('dungeonRun.claimModal.subtitle', { templateKey: claimModal.templateKey }) }}
        </p>
        <ul class="text-sm space-y-1">
          <li v-if="claimModal.granted.linhThach > 0" data-testid="dungeon-run-claim-linh-thach">
            {{ t('dungeonRun.reward.linhThach', { n: claimModal.granted.linhThach }) }}
          </li>
          <li v-if="claimModal.granted.tienNgoc > 0" data-testid="dungeon-run-claim-tien-ngoc">
            {{ t('dungeonRun.reward.tienNgoc', { n: claimModal.granted.tienNgoc }) }}
          </li>
          <li v-if="claimModal.granted.exp > 0" data-testid="dungeon-run-claim-exp">
            {{ t('dungeonRun.reward.exp', { n: claimModal.granted.exp }) }}
          </li>
          <li
            v-for="(it, idx) in claimModal.granted.items"
            :key="`${it.itemKey}-${idx}`"
            :data-testid="`dungeon-run-claim-item-${idx}`"
          >
            {{ t('dungeonRun.reward.item', { itemKey: it.itemKey, qty: it.qty }) }}
          </li>
        </ul>
        <div class="flex justify-end">
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm"
            data-testid="dungeon-run-claim-close"
            @click="closeClaimModal()"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>
