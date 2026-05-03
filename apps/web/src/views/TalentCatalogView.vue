<script setup lang="ts">
/**
 * Phase 11.X.AR — Talent Catalog read-only view.
 * Phase 11.X.AT — Wire `Học` button + Pinia talent store + filter status
 * (đã học / có thể học / chưa đủ điều kiện) + budget bar + i18n error toast.
 *
 * Hiển thị 54 talent từ shared catalog (`@xuantoi/shared` `TALENTS`) cho người
 * chơi xem + học. Server-authoritative learn flow qua `useTalentsStore`
 * (Phase 11.X.AS endpoint `POST /character/talents/learn`).
 *
 * Filters:
 * - Type: all | passive | active
 * - Element: all | kim | moc | thuy | hoa | tho | neutral
 * - Status: all | learned | available | locked
 *
 * Mỗi talent card hiển thị:
 * - Tên + element badge + type badge + (đã học) badge nếu learned
 * - Realm requirement + talent point cost
 * - Description (lore)
 * - Effect summary format theo passiveEffect.kind / activeEffect.kind
 * - Nút Học (disable nếu đã học / realm thấp / hết điểm / in-flight)
 *
 * Budget bar trên cùng: spent/budget + remaining count.
 *
 * KHÔNG đụng combat runtime/schema/seed — pure FE wire of existing server
 * endpoint với optimistic-free state.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  TALENTS,
  ELEMENTS,
  REALMS,
  realmByKey,
  type ElementKey,
  type TalentDef,
  type TalentType,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTalentsStore } from '@/stores/talents';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';

type ElementFilter = ElementKey | 'neutral' | 'all';
type TypeFilter = TalentType | 'all';
type StatusFilter = 'all' | 'learned' | 'available' | 'locked';

const auth = useAuthStore();
const game = useGameStore();
const talentsStore = useTalentsStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const typeFilter = ref<TypeFilter>('all');
const elementFilter = ref<ElementFilter>('all');
const statusFilter = ref<StatusFilter>('all');

/**
 * Map realmKey → realmOrder (deterministic từ shared `REALMS`). Dùng client-side
 * để tính realm gating khi server chưa fetch xong (server vẫn là source of
 * truth khi POST /learn).
 */
const realmKeyToOrder = computed(() => {
  const m = new Map<string, number>();
  REALMS.forEach((r, idx) => m.set(r.key, idx));
  return m;
});

const currentRealmOrder = computed<number>(() => {
  const k = game.character?.realmKey;
  if (!k) return 0;
  return realmKeyToOrder.value.get(k) ?? 0;
});

function isRealmGate(talent: TalentDef): boolean {
  const reqOrder = realmKeyToOrder.value.get(talent.realmRequirement);
  if (reqOrder === undefined) return true;
  return currentRealmOrder.value < reqOrder;
}

function isPointsGate(talent: TalentDef): boolean {
  return talentsStore.remaining < talent.talentPointCost;
}

function statusOf(talent: TalentDef): 'learned' | 'available' | 'locked' {
  if (talentsStore.isLearned(talent.key)) return 'learned';
  if (isRealmGate(talent) || isPointsGate(talent)) return 'locked';
  return 'available';
}

const filtered = computed<readonly TalentDef[]>(() => {
  return TALENTS.filter((talent) => {
    if (typeFilter.value !== 'all' && talent.type !== typeFilter.value) {
      return false;
    }
    if (elementFilter.value !== 'all') {
      if (elementFilter.value === 'neutral') {
        if (talent.element !== null) return false;
      } else if (talent.element !== elementFilter.value) {
        return false;
      }
    }
    if (statusFilter.value !== 'all') {
      if (statusOf(talent) !== statusFilter.value) return false;
    }
    return true;
  });
});

const counts = computed(() => ({
  total: TALENTS.length,
  filtered: filtered.value.length,
  passive: TALENTS.filter((t) => t.type === 'passive').length,
  active: TALENTS.filter((t) => t.type === 'active').length,
}));

function realmText(key: string): string {
  const r = realmByKey(key);
  return r ? r.name : key;
}

function elementClass(element: ElementKey | null): string {
  switch (element) {
    case 'kim':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'moc':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'thuy':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'hoa':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    case 'tho':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function elementLabel(element: ElementKey | null): string {
  if (element === null) return t('talents.element.neutral');
  return t(`talents.element.${element}`);
}

function typeClass(type: TalentType): string {
  return type === 'passive'
    ? 'bg-violet-700/40 text-violet-200 border-violet-500/40'
    : 'bg-amber-700/40 text-amber-200 border-amber-500/40';
}

/**
 * Format effect summary cho 1 talent — multi-key i18n string built deterministic
 * từ `passiveEffect` / `activeEffect` định dạng catalog. Dùng tham số ICU để
 * vi/en khớp placeholders parity test.
 */
function effectSummary(talent: TalentDef): string {
  if (talent.passiveEffect) {
    const eff = talent.passiveEffect;
    switch (eff.kind) {
      case 'stat_mod': {
        const pct = Math.round((eff.value - 1) * 100);
        const stat = eff.statTarget ?? 'atk';
        return t('talents.effect.statMod', {
          pct,
          stat: t(`talents.stat.${stat}`),
        });
      }
      case 'regen': {
        const stat = eff.statTarget ?? 'hpMax';
        return t('talents.effect.regen', {
          flat: eff.value,
          stat: t(`talents.stat.${stat}`),
        });
      }
      case 'drop_bonus': {
        const pct = Math.round((eff.value - 1) * 100);
        return t('talents.effect.dropBonus', { pct });
      }
      case 'exp_bonus': {
        const pct = Math.round((eff.value - 1) * 100);
        return t('talents.effect.expBonus', { pct });
      }
      case 'damage_bonus': {
        const pct = Math.round((eff.value - 1) * 100);
        const target = eff.elementTarget ?? 'kim';
        return t('talents.effect.damageBonus', {
          pct,
          element: t(`talents.element.${target}`),
        });
      }
      default:
        return talent.description;
    }
  }
  if (talent.activeEffect) {
    const eff = talent.activeEffect;
    const aoe = eff.aoe
      ? t('talents.effect.aoe')
      : t('talents.effect.single');
    switch (eff.kind) {
      case 'damage':
        return t('talents.effect.activeDamage', {
          mul: eff.value,
          aoe,
          mp: eff.mpCost,
          cd: eff.cooldownTurns,
        });
      case 'cc':
        return t('talents.effect.activeCc', {
          turns: eff.value,
          aoe,
          mp: eff.mpCost,
          cd: eff.cooldownTurns,
        });
      case 'heal':
        return t('talents.effect.activeHeal', {
          mul: eff.value,
          mp: eff.mpCost,
          cd: eff.cooldownTurns,
        });
      case 'dot':
        return t('talents.effect.activeDot', {
          turns: eff.value,
          aoe,
          mp: eff.mpCost,
          cd: eff.cooldownTurns,
        });
      case 'utility':
        return t('talents.effect.activeUtility', {
          mp: eff.mpCost,
          cd: eff.cooldownTurns,
        });
      default:
        return talent.description;
    }
  }
  return talent.description;
}

/**
 * Button label: ưu tiên trạng thái cụ thể nhất.
 *  1. learning (in-flight) → "Đang học…"
 *  2. learned → "Đã học"
 *  3. realm too low → "Cảnh giới chưa đủ"
 *  4. insufficient points → "Hết điểm ngộ đạo"
 *  5. default → "Học"
 */
function learnButtonLabel(talent: TalentDef): string {
  if (talentsStore.isLearning(talent.key)) return t('talents.button.learning');
  if (talentsStore.isLearned(talent.key)) return t('talents.button.learned');
  if (isRealmGate(talent)) return t('talents.button.realmTooLow');
  if (isPointsGate(talent)) return t('talents.button.insufficientPoints');
  return t('talents.button.learn');
}

function learnButtonDisabled(talent: TalentDef): boolean {
  if (talentsStore.isLearning(talent.key)) return true;
  if (talentsStore.isLearned(talent.key)) return true;
  if (isRealmGate(talent)) return true;
  if (isPointsGate(talent)) return true;
  return false;
}

/**
 * Phase 11.7.E++ — cooldown badge cho active talent đã học, đang còn lượt
 * cooldown > 0. Passive talent / chưa học / cooldown=0 không hiện badge này.
 * Server-authoritative: số lượt còn lại lấy từ Pinia `talentsStore.cooldownOf`
 * sau mỗi lần fetch state hoặc trận combat refresh state.
 */
function cooldownBadgeVisible(talent: TalentDef): boolean {
  if (talent.type !== 'active') return false;
  if (!talentsStore.isLearned(talent.key)) return false;
  return talentsStore.cooldownOf(talent.key) > 0;
}

/**
 * Phase 11.7.E++ — "Sẵn sàng" badge cho active talent đã học, cooldown=0.
 * Hiển thị trạng thái positive đối lập với cooldown badge (rose vs sky).
 */
function readyBadgeVisible(talent: TalentDef): boolean {
  if (talent.type !== 'active') return false;
  if (!talentsStore.isLearned(talent.key)) return false;
  return talentsStore.cooldownOf(talent.key) === 0;
}

async function onLearn(talent: TalentDef): Promise<void> {
  if (learnButtonDisabled(talent)) return;
  const errCode = await talentsStore.learn(talent.key);
  if (errCode === null) {
    toast.push({
      type: 'success',
      text: t('talents.learn.success', { name: talent.name }),
    });
  } else {
    const key = `talents.learn.errors.${errCode}`;
    // Fallback to UNKNOWN if i18n key missing.
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('talents.learn.errors.UNKNOWN') : text,
    });
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await talentsStore.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">{{ t('talents.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('talents.subtitle', { total: counts.total }) }}
          </p>
        </div>
        <div class="text-xs text-ink-300" data-testid="talents-counts">
          {{ t('talents.counts', { passive: counts.passive, active: counts.active }) }}
        </div>
      </header>

      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex flex-wrap items-center gap-3 text-xs"
        data-testid="talents-budget"
      >
        <span class="text-ink-300">{{ t('talents.budget.title') }}</span>
        <template v-if="talentsStore.loaded">
          <span class="text-amber-200" data-testid="talents-budget-spent">
            {{ t('talents.budget.spent', { spent: talentsStore.spent }) }}{{ t('talents.budget.of', { budget: talentsStore.budget }) }}
          </span>
          <span class="text-emerald-200" data-testid="talents-budget-remaining">
            {{ t('talents.budget.remaining', { remaining: talentsStore.remaining }) }}
          </span>
        </template>
        <span v-else class="text-ink-300">{{ t('talents.budget.loading') }}</span>
      </section>

      <section class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex flex-wrap items-center gap-3 text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('talents.filter.type') }}</label>
          <select
            v-model="typeFilter"
            data-testid="talents-filter-type"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('talents.filter.all') }}</option>
            <option value="passive">{{ t('talents.filter.passive') }}</option>
            <option value="active">{{ t('talents.filter.active') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('talents.filter.element') }}</label>
          <select
            v-model="elementFilter"
            data-testid="talents-filter-element"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('talents.filter.all') }}</option>
            <option v-for="el in ELEMENTS" :key="el" :value="el">
              {{ elementLabel(el) }}
            </option>
            <option value="neutral">{{ t('talents.element.neutral') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('talents.filterStatus.label') }}</label>
          <select
            v-model="statusFilter"
            data-testid="talents-filter-status"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('talents.filterStatus.all') }}</option>
            <option value="learned">{{ t('talents.filterStatus.learned') }}</option>
            <option value="available">{{ t('talents.filterStatus.available') }}</option>
            <option value="locked">{{ t('talents.filterStatus.locked') }}</option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="talents-result-count">
          {{ t('talents.filter.shown', { shown: counts.filtered, total: counts.total }) }}
        </span>
      </section>

      <section
        v-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="talents-empty"
      >
        {{ t('talents.empty') }}
      </section>

      <section v-else class="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="talents-list">
        <article
          v-for="talent in filtered"
          :key="talent.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`talent-card-${talent.key}`"
          :data-status="statusOf(talent)"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ talent.name }}</h2>
            <div class="flex items-center gap-1">
              <span
                v-if="talentsStore.isLearned(talent.key)"
                class="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                :data-testid="`talent-badge-learned-${talent.key}`"
              >
                {{ t('talents.badge.learned') }}
              </span>
              <span
                v-if="cooldownBadgeVisible(talent)"
                class="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider bg-rose-700/40 text-rose-200 border-rose-500/40"
                :data-testid="`talent-badge-cooldown-${talent.key}`"
                :title="t('talents.cooldown.tooltip')"
              >
                {{ t('talents.badge.cooldown', { turns: talentsStore.cooldownOf(talent.key) }) }}
              </span>
              <span
                v-else-if="readyBadgeVisible(talent)"
                class="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider bg-sky-700/40 text-sky-200 border-sky-500/40"
                :data-testid="`talent-badge-ready-${talent.key}`"
              >
                {{ t('talents.badge.ready') }}
              </span>
              <span
                class="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider"
                :class="elementClass(talent.element)"
              >
                {{ elementLabel(talent.element) }}
              </span>
              <span
                class="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider"
                :class="typeClass(talent.type)"
              >
                {{ t(`talents.type.${talent.type}`) }}
              </span>
            </div>
          </header>
          <p class="text-sm text-ink-200">{{ talent.description }}</p>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-300">
            <dt>{{ t('talents.field.realm') }}</dt>
            <dd class="text-ink-100">{{ realmText(talent.realmRequirement) }}</dd>
            <dt>{{ t('talents.field.cost') }}</dt>
            <dd class="text-ink-100">{{ talent.talentPointCost }}</dd>
            <dt>{{ t('talents.field.effect') }}</dt>
            <dd class="text-ink-100 col-span-1">{{ effectSummary(talent) }}</dd>
          </dl>
          <div class="flex justify-end pt-1">
            <button
              type="button"
              class="px-3 py-1 rounded border text-xs tracking-wider"
              :class="learnButtonDisabled(talent)
                ? 'bg-ink-700/30 text-ink-400 border-ink-300/20 cursor-not-allowed'
                : 'bg-amber-700/40 text-amber-100 border-amber-500/40 hover:bg-amber-600/50'"
              :disabled="learnButtonDisabled(talent)"
              :data-testid="`talent-learn-${talent.key}`"
              @click="onLearn(talent)"
            >
              {{ learnButtonLabel(talent) }}
            </button>
          </div>
        </article>
      </section>
    </div>
  </AppShell>
</template>
