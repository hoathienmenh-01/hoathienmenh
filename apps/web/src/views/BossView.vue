<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import {
  ELEMENTS,
  SKILL_BASIC_ATTACK,
  activeSkillsForSect,
  getMapRegionByKey,
  type ElementKey,
  type SectKey,
  type SkillDef,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import { useSpiritualRootStore } from '@/stores/spiritualRoot';
import {
  attackBoss,
  getActiveBosses,
  type BossView,
  type DefeatedRewardSlice,
} from '@/api/boss';
import { on } from '@/ws/client';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import BossSchedulePanel from '@/components/BossSchedulePanel.vue';
import BossElementTooltip from '@/components/BossElementTooltip.vue';
import MButton from '@/components/ui/MButton.vue';
import { itemName } from '@/lib/itemName';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const spiritualRoot = useSpiritualRootStore();
const router = useRouter();
const { t, locale } = useI18n();

/**
 * Phase 14.2.D — primary element của player từ Spiritual Root state.
 * Dùng cho BossElementTooltip warning. `null` nếu chưa hydrate /
 * chưa có linh căn.
 */
const playerPrimaryElement = computed<ElementKey | null>(() => {
  const raw = spiritualRoot.state?.primaryElement;
  if (!raw) return null;
  return (ELEMENTS as readonly string[]).includes(raw)
    ? (raw as ElementKey)
    : null;
});

// Phase 12.6 — multi-region boss state. Active list across regions sorted
// theo regionKey ascending; selectedRegionKey track active tab; `boss`
// computed = activeBosses[regionKey === selectedRegionKey] (giữ template
// API ổn định cho subsequent code).
const activeBosses = ref<BossView[]>([]);
const selectedRegionKey = ref<string | null>(null);
const submitting = ref(false);
const cooldownLeft = ref(0); // ms còn lại
const lastDefeatedRewards = ref<DefeatedRewardSlice[] | null>(null);
let tickTimer: ReturnType<typeof setInterval> | null = null;
const offHandlers: Array<() => void> = [];

const boss = computed<BossView | null>(() => {
  if (!selectedRegionKey.value) return activeBosses.value[0] ?? null;
  return (
    activeBosses.value.find((b) => b.regionKey === selectedRegionKey.value) ??
    null
  );
});

/**
 * Phase 12.6 — region tab tự derive từ activeBosses. Mỗi tab hiển thị
 * tên region (Vi/En theo locale) từ `MAP_REGIONS` catalog. Region key
 * `'world'` (legacy world boss) không có row trong catalog; fallback
 * dùng `boss.region.world` i18n key.
 */
function regionLabel(regionKey: string): string {
  if (regionKey === 'world') {
    return t('boss.region.world');
  }
  const def = getMapRegionByKey(regionKey);
  if (!def) return regionKey;
  return locale.value === 'en' ? def.nameEn : def.nameVi;
}

const sectKey = computed<SectKey | null>(() => game.character?.sectKey ?? null);
const usableSkills = computed<SkillDef[]>(() => activeSkillsForSect(sectKey.value));
const selectedSkill = ref<string>(SKILL_BASIC_ATTACK.key);

const hpPct = computed(() => {
  if (!boss.value) return 0;
  const cur = Number(BigInt(boss.value.currentHp));
  const max = Number(BigInt(boss.value.maxHp));
  if (max === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
});

const myStash = computed(() => game.character?.linhThach ?? '0');

/**
 * Cửu Thiên Mộng — boss phase change visual cue ("mực rơi" shutter).
 *
 * Boss HP buckets: >=75 → 1, >=50 → 2, >=25 → 3, <25 → 4. Khi bucket
 * giảm (boss vào phase mới — phẫn nộ / yếu / sắp chết) thì kích hoạt
 * overlay full-screen `ve-anim-muc-roi-curtain` + `ve-anim-muc-roi-splash`
 * trong ~1500ms. Toàn bộ CSS-only, tôn trọng `prefers-reduced-motion`
 * (xem `apps/web/src/style/visual-effects.css`).
 */
const showMucRoi = ref(false);
let mucRoiTimer: ReturnType<typeof setTimeout> | null = null;
let mucRoiPrevBossId: string | null = null;
let mucRoiPrevBucket = 0;

function hpBucket(pct: number): number {
  if (pct >= 75) return 1;
  if (pct >= 50) return 2;
  if (pct >= 25) return 3;
  return 4;
}

watch(
  () => ({
    bossId: boss.value?.id ?? null,
    status: boss.value?.status ?? null,
    pct: hpPct.value,
  }),
  (next) => {
    if (!next.bossId || next.status !== 'ACTIVE') {
      mucRoiPrevBossId = next.bossId;
      mucRoiPrevBucket = 0;
      return;
    }
    const bucket = hpBucket(next.pct);
    // Boss mới (region switch hoặc spawn) — reset baseline, không trigger.
    if (next.bossId !== mucRoiPrevBossId) {
      mucRoiPrevBossId = next.bossId;
      mucRoiPrevBucket = bucket;
      return;
    }
    // Bucket tăng = bullet timer baseline (vd boss được heal); chỉ trigger
    // khi bucket giảm (HP cross threshold xuống). Skip 0 baseline.
    if (mucRoiPrevBucket > 0 && bucket > mucRoiPrevBucket) {
      showMucRoi.value = true;
      if (mucRoiTimer) clearTimeout(mucRoiTimer);
      mucRoiTimer = setTimeout(() => {
        showMucRoi.value = false;
        mucRoiTimer = null;
      }, 1500);
    }
    mucRoiPrevBucket = bucket;
  },
  { immediate: true },
);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  // Phase 14.2.D — hydrate spiritualRoot store cho BossElementTooltip
  // warning. Fire-and-forget: warning hidden cho đến khi store hydrate
  // (UI re-render reactive). KHÔNG block boss list load.
  spiritualRoot.fetchState().catch(() => null);
  game.bindSocket();
  await refresh();

  // Realtime: cập nhật HP boss + leaderboard khi có ai đó đánh.
  offHandlers.push(
    on<{
      id: string;
      currentHp: string;
      maxHp: string;
      status: 'ACTIVE' | 'DEFEATED' | 'EXPIRED';
      leaderboardTop5: BossView['leaderboard'];
    }>('boss:update', (frame) => {
      const p = frame.payload;
      // Phase 12.6 — find row trong activeBosses by id (multi-region —
      // boss:update có thể từ region khác đang mở tab khác). Update
      // in-place để Vue reactive theo array index.
      const idx = activeBosses.value.findIndex((b) => b.id === p.id);
      if (idx === -1) return;
      const cur = activeBosses.value[idx];
      const next: BossView = {
        ...cur,
        currentHp: p.currentHp,
        status: p.status,
      };
      // Cập nhật top5 nhưng giữ phần dưới của bảng cũ.
      if (p.leaderboardTop5.length > 0) {
        const existing = cur.leaderboard;
        const merged = [
          ...p.leaderboardTop5,
          ...existing.filter(
            (e) => !p.leaderboardTop5.some((t) => t.characterId === e.characterId),
          ),
        ];
        next.leaderboard = merged.slice(0, 20);
      }
      activeBosses.value = [
        ...activeBosses.value.slice(0, idx),
        next,
        ...activeBosses.value.slice(idx + 1),
      ];
    }),
  );
  offHandlers.push(
    on<{
      id: string;
      bossKey: string;
      name: string;
      level: number;
      maxHp: string;
      currentHp: string;
      spawnedAt: string;
      expiresAt: string;
      regionKey?: string;
    }>('boss:spawn', () => {
      // Có boss mới — refetch để lấy đầy đủ thông tin (multi-region:
      // boss có thể spawn ở region khác → list active mới).
      void refresh();
      toast.push({ type: 'system', text: t('boss.spawnToast') });
    }),
  );
  offHandlers.push(
    on<{
      id: string;
      name: string;
      rewards: DefeatedRewardSlice[];
    }>('boss:defeated', (frame) => {
      const p = frame.payload;
      // Flip status trong list (region của boss đó).
      const idx = activeBosses.value.findIndex((b) => b.id === p.id);
      if (idx !== -1) {
        const cur = activeBosses.value[idx];
        activeBosses.value = [
          ...activeBosses.value.slice(0, idx),
          { ...cur, status: 'DEFEATED', currentHp: '0' },
          ...activeBosses.value.slice(idx + 1),
        ];
      }
      lastDefeatedRewards.value = p.rewards;
      toast.push({ type: 'success', text: t('boss.defeatedToast', { name: p.name }) });
      void game.fetchState().catch(() => null);
      // Refresh boss sau ít giây để load boss mới (khi cron spawn).
      setTimeout(() => void refresh(), 3000);
    }),
  );
  offHandlers.push(
    on<{
      id: string;
      status: string;
      rewards: DefeatedRewardSlice[];
    }>('boss:end', (frame) => {
      const p = frame.payload;
      const idx = activeBosses.value.findIndex((b) => b.id === p.id);
      if (idx !== -1) {
        const cur = activeBosses.value[idx];
        activeBosses.value = [
          ...activeBosses.value.slice(0, idx),
          { ...cur, status: 'EXPIRED' },
          ...activeBosses.value.slice(idx + 1),
        ];
      }
      lastDefeatedRewards.value = p.rewards;
      toast.push({ type: 'system', text: t('boss.endedToast') });
      void game.fetchState().catch(() => null);
      setTimeout(() => void refresh(), 3000);
    }),
  );

  // Tick local cho cooldown bar.
  tickTimer = setInterval(() => {
    const cur = boss.value;
    if (cur?.cooldownUntil) {
      const ms = new Date(cur.cooldownUntil).getTime() - Date.now();
      cooldownLeft.value = Math.max(0, ms);
      if (cooldownLeft.value === 0) {
        // Clear cooldown via activeBosses (boss.value là computed).
        const idx = activeBosses.value.findIndex((b) => b.id === cur.id);
        if (idx !== -1) {
          activeBosses.value = [
            ...activeBosses.value.slice(0, idx),
            { ...activeBosses.value[idx], cooldownUntil: null },
            ...activeBosses.value.slice(idx + 1),
          ];
        }
      }
    } else {
      cooldownLeft.value = 0;
    }
  }, 250);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (mucRoiTimer) {
    clearTimeout(mucRoiTimer);
    mucRoiTimer = null;
  }
  for (const off of offHandlers) off();
  offHandlers.length = 0;
});

async function refresh(): Promise<void> {
  try {
    const list = await getActiveBosses();
    activeBosses.value = list;
    // Phase 12.6 — preserve selected region nếu vẫn còn ACTIVE; ngược lại
    // chọn region đầu tiên (auto-select first tab cho UX). Null nếu không
    // có ACTIVE boss nào (rare — heartbeat đảm bảo spawn theo region trong
    // catalog).
    if (
      selectedRegionKey.value &&
      list.some((b) => b.regionKey === selectedRegionKey.value)
    ) {
      // keep
    } else {
      selectedRegionKey.value = list[0]?.regionKey ?? null;
    }
  } catch {
    activeBosses.value = [];
    selectedRegionKey.value = null;
  }
}

function selectRegion(regionKey: string): void {
  selectedRegionKey.value = regionKey;
}

async function onAttack(): Promise<void> {
  if (submitting.value || !boss.value) return;
  if (cooldownLeft.value > 0) return;
  submitting.value = true;
  const targetBoss = boss.value;
  try {
    // Phase 12.6 — pass bossId explicit cho multi-region disambiguation.
    // Server fallback "primary" nếu không truyền, nhưng UI multi-region
    // phải bám đúng region tab đang mở.
    const r = await attackBoss(selectedSkill.value, targetBoss.id);
    // Cập nhật ngay từ response để feedback tức thời (WS có thể chậm hơn).
    const idx = activeBosses.value.findIndex((b) => b.id === targetBoss.id);
    if (idx !== -1) {
      const cur = activeBosses.value[idx];
      activeBosses.value = [
        ...activeBosses.value.slice(0, idx),
        {
          ...cur,
          currentHp: r.result.bossHp,
          myDamage: r.result.myDamageTotal,
          myRank: r.result.myRank,
          cooldownUntil: new Date(Date.now() + 1500).toISOString(),
        },
        ...activeBosses.value.slice(idx + 1),
      ];
    }
    if (r.defeated) {
      lastDefeatedRewards.value = r.defeated;
    }
    toast.push({
      type: 'success',
      text: t('boss.damageToast', {
        dmg: r.result.damageDealt,
        rank: r.result.myRank,
      }),
    });
    await game.fetchState().catch(() => null);
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`boss.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('boss.errors.UNKNOWN') : text,
  });
}



function timeLeftText(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('boss.almostGone');
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}p${s.toString().padStart(2, '0')}`;
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      :eyebrow="t('luxHero.boss.eyebrow')"
      :label="t('luxHero.boss.label')"
      :title="t('boss.title')"
      :subtitle="t('luxHero.boss.subtitle')"
      tone="seal"
      watermark-letter="C"
      :breadcrumb="t('luxHero.boss.breadcrumb')"
      test-id="boss-view-hero"
      class="mb-4"
    >
      <XTPageEyebrow
        caps="TRUY SÁT MA VƯƠNG"
        label="Truy Sát Ma Vương"
        class="sr-only"
      />
      <template #meta>
        <XTGlyphBadge tone="seal" size="sm" glyph="☠">Boss sống</XTGlyphBadge>
      </template>
    </XTLuxHero>

    <!-- Role hint + cross-nav -->
    <div class="space-y-2 mb-4" data-testid="boss-role-section">
      <p class="text-xs text-ink-300 leading-relaxed" data-testid="boss-role-hint">
        {{ t('boss.roleHint') }}
      </p>
      <nav class="flex flex-wrap gap-2 text-xs" data-testid="boss-cross-nav">
        <span class="text-ink-400">{{ t('boss.crossNav.label') }}:</span>
        <router-link
          to="/combat"
          class="text-amber-300 hover:text-amber-100 underline"
          data-testid="boss-cross-nav-combat"
        >
          {{ t('boss.crossNav.combat') }}
        </router-link>
        <span class="text-ink-500">·</span>
        <router-link
          to="/world/bosses"
          class="text-amber-300 hover:text-amber-100 underline"
          data-testid="boss-cross-nav-boss-hub"
        >
          {{ t('boss.crossNav.bossHub') }}
        </router-link>
      </nav>
    </div>

    <!-- Phase 13.0 §E — Lịch Boss hôm nay (LiveOps schedule). -->
    <BossSchedulePanel />

    <!-- Phase 12.6 — region tabs cho multi-region boss spawn. Mỗi tab
         label = MAP_REGIONS catalog (Vi/En theo locale); fallback i18n
         `boss.region.world` cho legacy world boss. Tab active highlight
         amber; HP indicator nhỏ hiển thị %. -->
    <nav
      v-if="activeBosses.length > 1"
      class="flex flex-wrap gap-2 mb-4"
      role="tablist"
      :aria-label="t('boss.regionTabsLabel')"
    >
      <button
        v-for="ab in activeBosses"
        :key="ab.id"
        type="button"
        role="tab"
        :aria-selected="ab.regionKey === selectedRegionKey"
        :class="[
          'px-3 py-1 rounded border text-xs tracking-wider transition-colors',
          ab.regionKey === selectedRegionKey
            ? 'border-amber-400 bg-amber-400/20 text-amber-200'
            : 'border-ink-300/40 bg-ink-700/30 text-ink-300 hover:bg-ink-700/50',
        ]"
        @click="selectRegion(ab.regionKey)"
      >
        {{ regionLabel(ab.regionKey) }}
        <span class="ml-1 text-ink-300/60">·</span>
        <span class="ml-1">Lv.{{ ab.level }}</span>
      </button>
    </nav>

    <div v-if="!boss" class="border border-ink-300/40 rounded p-6 bg-ink-700/30 text-center">
      <p class="text-ink-300">{{ t('boss.noneTitle') }}</p>
      <p class="text-xs text-ink-300/70 mt-2">
        {{ t('boss.noneHint') }}
      </p>
      <MButton class="mt-4" @click="refresh">{{ t('common.reload') }}</MButton>
    </div>

    <section v-else class="space-y-4">
      <!-- Boss header -->
      <div class="border border-ink-300/40 rounded p-4 bg-ink-700/30">
        <div class="flex items-start gap-4 flex-wrap">
          <div class="flex-1">
            <div class="text-2xl tracking-widest text-amber-200">
              {{ boss.name }}
              <span class="text-xs text-ink-300 ml-2">Lv.{{ boss.level }}</span>
            </div>
            <div class="text-xs text-ink-300 mt-1">{{ boss.description }}</div>
            <!-- Phase 12.6 — region badge dưới description. -->
            <div class="text-[10px] text-ink-300/70 mt-1 tracking-wider uppercase">
              {{ t('boss.regionBadge') }}: {{ regionLabel(boss.regionKey) }}
            </div>
            <!-- Phase 14.2.D — element identity (weakness, resist, reward hint, warning). -->
            <BossElementTooltip
              class="mt-2"
              :element="boss.elementProfile.element"
              :weakness-element="boss.elementProfile.weaknessElement"
              :resist-elements="boss.elementProfile.resistElements"
              :reward-element-hint="boss.elementProfile.rewardElementHint"
              :player-primary-element="playerPrimaryElement"
              :test-id-prefix="`boss-${boss.bossKey}`"
            />
          </div>
          <div class="text-right">
            <div class="text-xs text-ink-300">{{ t('boss.timeLeft') }}</div>
            <div class="text-amber-300">{{ timeLeftText(boss.expiresAt) }}</div>
            <div class="text-xs text-ink-300 mt-1">
              {{ t('boss.participants', { n: boss.participants }) }}
            </div>
          </div>
        </div>

        <!-- HP bar -->
        <div class="mt-4">
          <div class="flex justify-between text-xs text-ink-300">
            <span>{{ t('boss.hp') }}</span>
            <span>{{ boss.currentHp }} / {{ boss.maxHp }} ({{ hpPct }}%)</span>
          </div>
          <div class="h-3 mt-1 rounded bg-ink-900/60 overflow-hidden">
            <div
              class="h-full bg-red-500 transition-all"
              :style="{ width: hpPct + '%' }"
            />
          </div>
        </div>
      </div>

      <!-- Attack panel -->
      <div
        v-if="boss.status === 'ACTIVE'"
        class="border border-ink-300/40 rounded p-4 bg-ink-700/30"
      >
        <div class="flex flex-wrap gap-2 items-center mb-3">
          <span class="text-xs text-ink-300">{{ t('boss.skill') }}</span>
          <select
            v-model="selectedSkill"
            class="bg-ink-900/70 border border-ink-300/30 rounded px-2 py-1 text-sm"
          >
            <option v-for="s in usableSkills" :key="s.key" :value="s.key">
              {{ s.name }}
              <span v-if="s.mpCost > 0">({{ s.mpCost }} MP)</span>
            </option>
          </select>
          <span class="text-xs text-ink-300 ml-2">
            ⛁ {{ game.character?.mp }}/{{ game.character?.mpMax }}
            · ⚔ {{ game.character?.stamina }}/{{ game.character?.staminaMax }}
            · ❤ {{ game.character?.hp }}/{{ game.character?.hpMax }}
          </span>
          <span class="ml-auto text-xs text-ink-300">⛀ {{ myStash }}</span>
        </div>
        <div class="flex items-center gap-3">
          <MButton
            :loading="submitting"
            :disabled="cooldownLeft > 0"
            @click="onAttack"
          >
            {{ t('boss.attack') }}
            <span v-if="cooldownLeft > 0" class="text-xs ml-1">
              ({{ Math.ceil(cooldownLeft / 100) / 10 }}s)
            </span>
          </MButton>
          <span v-if="boss.myRank && boss.myDamage" class="text-xs text-ink-300">
            {{ t('boss.myDamage', { dmg: boss.myDamage, rank: boss.myRank }) }}
          </span>
        </div>
      </div>

      <!-- Reward pool hint -->
      <div class="border border-ink-300/40 rounded p-4 bg-ink-700/30">
        <div class="text-xs text-ink-300 mb-2">{{ t('boss.rewardsTitle') }}</div>
        <div class="text-xs space-y-1 text-ink-100">
          <div>{{ t('boss.rewardTop1') }}
            <span class="text-violet-300">
              {{ boss.topDropPool.map((k) => itemName(k, t)).join(' / ') }}
            </span>
          </div>
          <div>{{ t('boss.rewardTop23') }}
            <span class="text-emerald-300">
              {{ boss.midDropPool.map((k) => itemName(k, t)).join(' / ') }}
            </span>
          </div>
          <div>{{ t('boss.rewardTop410') }}</div>
          <div>{{ t('boss.rewardTop11') }}</div>
          <div class="text-ink-300">
            {{ t('boss.rewardExpire') }}
          </div>
        </div>
      </div>

      <!-- Leaderboard -->
      <div class="border border-ink-300/40 rounded p-4 bg-ink-700/30">
        <div class="text-sm tracking-widest mb-2">{{ t('boss.leaderboard') }}</div>
        <table class="w-full text-sm">
          <thead class="text-xs text-ink-300">
            <tr>
              <th class="text-left">{{ t('boss.col.rank') }}</th>
              <th class="text-left">{{ t('boss.col.name') }}</th>
              <th class="text-right">{{ t('boss.col.damage') }}</th>
              <th class="text-right">{{ t('boss.col.hits') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in boss.leaderboard"
              :key="row.characterId"
              :class="row.characterId === game.character?.id ? 'text-amber-300' : ''"
            >
              <td>#{{ row.rank }}</td>
              <td>
                <RouterLink
                  :to="`/profile/${row.characterId}`"
                  class="hover:text-amber-200 hover:underline"
                >
                  {{ row.characterName }}
                </RouterLink>
              </td>
              <td class="text-right">{{ row.damage }}</td>
              <td class="text-right">{{ row.hits }}</td>
            </tr>
            <tr v-if="boss.leaderboard.length === 0">
              <td colspan="4" class="text-center text-ink-300/70 py-3">
                {{ t('boss.noAttackers') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Defeated reward summary -->
      <div
        v-if="lastDefeatedRewards"
        class="border border-amber-400/40 rounded p-4 bg-amber-900/10"
      >
        <div class="text-sm tracking-widest mb-2 text-amber-300">
          {{ t('boss.lastRewards') }}
        </div>
        <ul class="text-xs space-y-1">
          <li v-for="r in lastDefeatedRewards.slice(0, 10)" :key="r.characterId">
            #{{ r.rank }} · {{ r.characterName }} ·
            <span class="text-amber-300">⛀ {{ r.linhThach }}</span>
            <span v-if="r.items.length > 0" class="text-violet-300 ml-2">
              + {{ r.items.map((i) => itemName(i.itemKey, t) + (i.qty > 1 ? ` x${i.qty}` : '')).join(', ') }}
            </span>
          </li>
        </ul>
      </div>
    </section>

    <!--
      Mực rơi (ink curtain) shutter overlay — kích hoạt khi boss vượt
      ngưỡng HP (75/50/25%). Teleport sang body để phủ toàn màn hình;
      CSS-only animation tự dừng sau 1.5s và component unmount sau timer.
    -->
    <Teleport to="body">
      <div
        v-if="showMucRoi"
        class="fixed inset-0 z-[9998] pointer-events-none overflow-hidden"
        data-testid="boss-view-muc-roi"
        aria-hidden="true"
      >
        <div
          class="absolute inset-x-0 -top-1/3 h-[160%] ve-anim-muc-roi-curtain"
          style="
            background:
              linear-gradient(180deg, rgba(7, 9, 14, 0.96) 0%, rgba(11, 16, 24, 0.85) 50%, transparent 100%),
              radial-gradient(ellipse at 50% 30%, rgba(208, 79, 79, 0.42) 0%, transparent 60%);
          "
        />
        <div
          class="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-72 w-72 rounded-full ve-anim-muc-roi-splash"
          style="background: radial-gradient(circle, rgba(208, 79, 79, 0.78) 0%, rgba(208, 79, 79, 0) 65%)"
        />
      </div>
    </Teleport>
  </AppShell>
</template>
