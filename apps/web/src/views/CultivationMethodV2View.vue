<script setup lang="ts">
/**
 * Phase 26.3 — Cultivation Method V2 (Công Pháp V2) view.
 *
 * Quản lý tiến trình công pháp V2 server-authoritative:
 *   - 5 slot (QI_MAIN / BODY_MAIN / SUPPORT / SECT / SPECIAL).
 *   - 36 method · 9 tier · 7 category.
 *   - 5 thao tác:
 *       unlock     (mảnh + linh thạch + realm gating),
 *       equip      (slot validation server),
 *       unequip    (slot reset),
 *       upgrade    (level + materials + linh thạch),
 *       starUp     (mảnh per-star).
 *
 * KHÔNG có optimistic state — gọi xong sẽ replace state từ
 * `CultivationMethodV2StateOut`. Tất cả số liệu balance lấy từ catalog
 * static `@xuantoi/shared` (`CULTIVATION_METHODS_V2`).
 *
 * Bao trùm đủ state: loading / error+reload / empty / list (UI MODULE RULE).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  CULTIVATION_METHODS_V2,
  METHOD_CATEGORIES,
  METHOD_EQUIP_SLOTS,
  getMethodV2Def,
  type CultivationMethodV2Def,
  type MethodCategory,
  type MethodEquipSlot,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useCultivationMethodV2Store } from '@/stores/cultivationMethodV2';
import { useToastStore } from '@/stores/toast';
import type { CultivationMethodV2CatalogEntry } from '@/api/cultivationMethodV2';
import AppShell from '@/components/shell/AppShell.vue';

const auth = useAuthStore();
const game = useGameStore();
const store = useCultivationMethodV2Store();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const categoryFilter = ref<'all' | MethodCategory>('all');
const slotFilter = ref<'all' | MethodEquipSlot>('all');
const unlockedOnly = ref(false);

interface Row {
  def: CultivationMethodV2Def;
  entry: CultivationMethodV2CatalogEntry;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (const entry of store.catalog) {
    const def = getMethodV2Def(entry.methodKey);
    if (!def) continue;
    out.push({ def, entry });
  }
  // Sort: equipped first, then tier asc, then key.
  out.sort((a, b) => {
    const equippedA = a.entry.equippedSlot ? 0 : 1;
    const equippedB = b.entry.equippedSlot ? 0 : 1;
    if (equippedA !== equippedB) return equippedA - equippedB;
    if (a.def.tier !== b.def.tier) return a.def.tier - b.def.tier;
    return a.def.key.localeCompare(b.def.key);
  });
  return out;
});

const filtered = computed<Row[]>(() =>
  rows.value.filter((r) => {
    if (categoryFilter.value !== 'all' && r.def.category !== categoryFilter.value) return false;
    if (slotFilter.value !== 'all' && !r.def.allowedSlots.includes(slotFilter.value)) return false;
    if (unlockedOnly.value && !r.entry.unlocked) return false;
    return true;
  }),
);

const counts = computed(() => ({
  total: store.catalog.length,
  filtered: filtered.value.length,
  catalog: CULTIVATION_METHODS_V2.length,
}));

const slotSummary = computed<{ slot: MethodEquipSlot; row: Row | null }[]>(() => {
  const out: { slot: MethodEquipSlot; row: Row | null }[] = [];
  for (const slot of METHOD_EQUIP_SLOTS) {
    const equipped = store.equippedSlots.find((e) => e.slot === slot);
    if (!equipped) {
      out.push({ slot, row: null });
      continue;
    }
    const def = getMethodV2Def(equipped.methodKey);
    const entry = store.findEntry(equipped.methodKey);
    if (!def || !entry) {
      out.push({ slot, row: null });
      continue;
    }
    out.push({ slot, row: { def, entry } });
  }
  return out;
});

function gradeClass(grade: string): string {
  switch (grade) {
    case 'PHAM':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'HUYEN':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'DIA':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'THIEN':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'TIEN':
      return 'bg-fuchsia-700/40 text-fuchsia-200 border-fuchsia-500/40';
    case 'THAN':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'THANH':
    case 'CHUAN_THANH':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    case 'CHI_TON':
      return 'bg-gradient-to-br from-amber-600/50 to-rose-700/50 text-amber-100 border-amber-400/60';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

/**
 * MethodStatScaling values are already in **integer percent** (e.g. `qiExpPercent: 50`
 * = +50%) except for `bossDamageReduction` / `elementalAtkBonus` / `tribulationSupport`
 * which are 0..1 fractions per Phase 26.3 convention. UI rounds to one decimal where
 * fractional, otherwise integer.
 */
function formatPercent(value: number): string {
  // Treat values < 1 as 0..1 fractions (mul 100); else assume already integer percent.
  const pct = value <= 1 ? value * 100 : value;
  return Math.round(pct * 10) / 10 === Math.round(pct)
    ? Math.round(pct).toString()
    : (Math.round(pct * 10) / 10).toFixed(1);
}

function pushError(code: string, op: string): void {
  const key = `cultivationMethodV2.errors.${code}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t('cultivationMethodV2.errors.UNKNOWN') : text,
  });
  // Re-fetch on stale states to recover.
  if (code === 'METHOD_ALREADY_UNLOCKED' || code === 'NOT_UNLOCKED') {
    store.fetchState().catch(() => null);
  }
  // Reserved for op-specific logging hooks in future.
  void op;
}

async function onUnlock(row: Row): Promise<void> {
  const code = await store.unlock(row.def.key);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('cultivationMethodV2.success.unlock', { name: row.def.name }),
    });
  } else {
    pushError(code, 'unlock');
  }
}

async function onEquip(row: Row, slot: MethodEquipSlot): Promise<void> {
  const code = await store.equip(row.def.key, slot);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('cultivationMethodV2.success.equip', {
        name: row.def.name,
        slot: t(`cultivationMethodV2.slot.${slot}`),
      }),
    });
  } else {
    pushError(code, 'equip');
  }
}

async function onUnequip(slot: MethodEquipSlot): Promise<void> {
  const code = await store.unequip(slot);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('cultivationMethodV2.success.unequip', {
        slot: t(`cultivationMethodV2.slot.${slot}`),
      }),
    });
  } else {
    pushError(code, 'unequip');
  }
}

async function onUpgrade(row: Row): Promise<void> {
  const code = await store.upgrade(row.def.key);
  if (code === null) {
    const after = store.findEntry(row.def.key);
    toast.push({
      type: 'success',
      text: t('cultivationMethodV2.success.upgrade', {
        name: row.def.name,
        level: after?.level ?? row.entry.level + 1,
      }),
    });
  } else {
    pushError(code, 'upgrade');
  }
}

async function onStarUp(row: Row): Promise<void> {
  const code = await store.starUp(row.def.key);
  if (code === null) {
    const after = store.findEntry(row.def.key);
    toast.push({
      type: 'success',
      text: t('cultivationMethodV2.success.starUp', {
        name: row.def.name,
        star: after?.star ?? row.entry.star + 1,
      }),
    });
  } else {
    pushError(code, 'starUp');
  }
}

function clearFilters(): void {
  categoryFilter.value = 'all';
  slotFilter.value = 'all';
  unlockedOnly.value = false;
}

const fetchError = computed(() => {
  if (store.loaded) return null;
  return store.lastError;
});

async function reload(): Promise<void> {
  await store.fetchState();
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await store.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-6xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">
            {{ t('cultivationMethodV2.title') }}
          </h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('cultivationMethodV2.subtitle') }}
          </p>
        </div>
        <div
          class="text-xs text-ink-300 flex flex-wrap items-center gap-2"
          data-testid="cultivation-method-v2-rates"
        >
          <span>
            {{
              t('cultivationMethodV2.summary.cultivationRate', {
                mul: store.cultivationRateMul.toFixed(2),
              })
            }}
          </span>
          <span>
            {{
              t('cultivationMethodV2.summary.bodyRate', {
                mul: store.bodyRateMul.toFixed(2),
              })
            }}
          </span>
        </div>
      </header>

      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
        data-testid="cultivation-method-v2-summary"
      >
        <h2 class="text-sm text-amber-200 font-semibold">
          {{ t('cultivationMethodV2.summary.title') }}
        </h2>
        <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
          <li
            v-for="entry in slotSummary"
            :key="entry.slot"
            class="bg-ink-900/40 border border-ink-300/20 rounded p-2 space-y-1"
            :data-testid="`cultivation-method-v2-slot-${entry.slot}`"
          >
            <div class="text-[10px] text-ink-300 uppercase tracking-wider">
              {{ t(`cultivationMethodV2.slot.${entry.slot}`) }}
            </div>
            <template v-if="entry.row">
              <div class="text-amber-200 font-semibold truncate">
                {{ entry.row.def.name }}
              </div>
              <div class="text-ink-300">
                {{
                  t('cultivationMethodV2.field.level', {
                    level: entry.row.entry.level,
                    max: entry.row.def.maxLevel,
                  })
                }}
                ·
                {{
                  t('cultivationMethodV2.field.star', {
                    star: entry.row.entry.star,
                    max: entry.row.def.maxStar,
                  })
                }}
              </div>
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded border bg-ink-900/60 hover:bg-ink-700 border-ink-300/30 text-ink-200"
                :data-testid="`cultivation-method-v2-unequip-${entry.slot}`"
                :disabled="store.busy(`slot:${entry.slot}:unequip`)"
                @click="onUnequip(entry.slot)"
              >
                {{
                  t('cultivationMethodV2.action.unequip', {
                    slot: t(`cultivationMethodV2.slot.${entry.slot}`),
                  })
                }}
              </button>
            </template>
            <template v-else>
              <div class="text-ink-300 italic">
                {{ t('cultivationMethodV2.summary.empty') }}
              </div>
            </template>
          </li>
        </ul>

        <div
          v-if="store.aggregatedBonuses"
          class="text-[11px] text-ink-300 flex flex-wrap gap-x-3 gap-y-1 pt-1"
          data-testid="cultivation-method-v2-bonuses"
        >
          <span class="text-ink-400 uppercase tracking-wider">
            {{ t('cultivationMethodV2.summary.bonuses') }}:
          </span>
          <span
            v-if="store.aggregatedBonuses.qiExpPercent > 0"
            class="text-emerald-200"
            data-testid="cultivation-method-v2-bonus-qiExpPercent"
          >
            {{
              t('cultivationMethodV2.stat.qiExpPercent', {
                value: formatPercent(store.aggregatedBonuses.qiExpPercent),
              })
            }}
          </span>
          <span
            v-if="store.aggregatedBonuses.bodyExpPercent > 0"
            class="text-emerald-200"
            data-testid="cultivation-method-v2-bonus-bodyExpPercent"
          >
            {{
              t('cultivationMethodV2.stat.bodyExpPercent', {
                value: formatPercent(store.aggregatedBonuses.bodyExpPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.hpMaxPercent > 0" class="text-rose-200">
            {{
              t('cultivationMethodV2.stat.hpMaxPercent', {
                value: formatPercent(store.aggregatedBonuses.hpMaxPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.mpMaxPercent > 0" class="text-sky-200">
            {{
              t('cultivationMethodV2.stat.mpMaxPercent', {
                value: formatPercent(store.aggregatedBonuses.mpMaxPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.atkPercent > 0" class="text-amber-200">
            {{
              t('cultivationMethodV2.stat.atkPercent', {
                value: formatPercent(store.aggregatedBonuses.atkPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.defPercent > 0" class="text-emerald-300">
            {{
              t('cultivationMethodV2.stat.defPercent', {
                value: formatPercent(store.aggregatedBonuses.defPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.spiritPercent > 0" class="text-violet-200">
            {{
              t('cultivationMethodV2.stat.spiritPercent', {
                value: formatPercent(store.aggregatedBonuses.spiritPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.staminaMaxPercent > 0" class="text-orange-200">
            {{
              t('cultivationMethodV2.stat.staminaMaxPercent', {
                value: formatPercent(store.aggregatedBonuses.staminaMaxPercent),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.bossDamageReduction > 0" class="text-emerald-300">
            {{
              t('cultivationMethodV2.stat.bossDamageReduction', {
                value: formatPercent(store.aggregatedBonuses.bossDamageReduction),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.elementalAtkBonus > 0" class="text-amber-200">
            {{
              t('cultivationMethodV2.stat.elementalAtkBonus', {
                value: formatPercent(store.aggregatedBonuses.elementalAtkBonus),
              })
            }}
          </span>
          <span v-if="store.aggregatedBonuses.tribulationSupport > 0" class="text-amber-300">
            {{
              t('cultivationMethodV2.stat.tribulationSupport', {
                value: formatPercent(store.aggregatedBonuses.tribulationSupport),
              })
            }}
          </span>
        </div>
      </section>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('cultivationMethodV2.filter.category') }}</label>
          <select
            v-model="categoryFilter"
            data-testid="cultivation-method-v2-filter-category"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('cultivationMethodV2.filter.all') }}</option>
            <option v-for="c in METHOD_CATEGORIES" :key="c" :value="c">
              {{ t(`cultivationMethodV2.category.${c}`) }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('cultivationMethodV2.filter.slot') }}</label>
          <select
            v-model="slotFilter"
            data-testid="cultivation-method-v2-filter-slot"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('cultivationMethodV2.filter.all') }}</option>
            <option v-for="s in METHOD_EQUIP_SLOTS" :key="s" :value="s">
              {{ t(`cultivationMethodV2.slot.${s}`) }}
            </option>
          </select>
        </div>
        <label class="flex items-center gap-2 text-ink-300">
          <input
            v-model="unlockedOnly"
            type="checkbox"
            data-testid="cultivation-method-v2-filter-unlocked"
          />
          {{ t('cultivationMethodV2.filter.unlocked') }}
        </label>
        <button
          type="button"
          class="text-[11px] px-2 py-1 rounded border border-ink-300/30 hover:bg-ink-700/60 text-ink-200"
          data-testid="cultivation-method-v2-filter-clear"
          @click="clearFilters"
        >
          {{ t('cultivationMethodV2.filter.clear') }}
        </button>
        <span class="ml-auto text-ink-300" data-testid="cultivation-method-v2-count">
          {{
            t('cultivationMethodV2.filter.shown', {
              shown: counts.filtered,
              total: counts.total,
            })
          }}
        </span>
      </section>

      <section
        v-if="!store.loaded && !fetchError"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="cultivation-method-v2-loading"
      >
        {{ t('cultivationMethodV2.loading') }}
      </section>

      <section
        v-else-if="fetchError"
        class="bg-rose-900/30 border border-rose-500/40 rounded p-6 text-center text-rose-100 space-y-2"
        data-testid="cultivation-method-v2-error"
      >
        <div>{{ t('cultivationMethodV2.reloadError') }}</div>
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded bg-rose-700 text-rose-50 hover:bg-rose-600"
          data-testid="cultivation-method-v2-reload"
          @click="reload"
        >
          {{ t('cultivationMethodV2.reload') }}
        </button>
      </section>

      <section
        v-else-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="cultivation-method-v2-empty"
      >
        {{ t('cultivationMethodV2.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="cultivation-method-v2-list"
      >
        <article
          v-for="row in filtered"
          :key="row.def.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`cultivation-method-v2-card-${row.def.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div class="flex items-baseline gap-2">
              <h2 class="text-amber-200 text-base font-semibold">{{ row.def.name }}</h2>
              <span class="text-[10px] text-ink-300">
                {{
                  t('cultivationMethodV2.field.tier', {
                    tier: row.def.tier,
                    grade: t(`cultivationMethodV2.grade.${row.def.grade}`),
                  })
                }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <span
                :class="['text-[10px] px-1.5 py-0.5 rounded border', gradeClass(row.def.grade)]"
                :data-testid="`cultivation-method-v2-grade-${row.def.key}`"
              >
                {{ t(`cultivationMethodV2.grade.${row.def.grade}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`cultivation-method-v2-category-${row.def.key}`"
              >
                {{ t(`cultivationMethodV2.category.${row.def.category}`) }}
              </span>
              <span
                v-if="row.entry.equippedSlot"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                :data-testid="`cultivation-method-v2-equipped-badge-${row.def.key}`"
              >
                {{
                  t('cultivationMethodV2.field.equippedAt', {
                    slot: t(`cultivationMethodV2.slot.${row.entry.equippedSlot}`),
                  })
                }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ row.def.description }}</p>

          <div class="text-xs space-y-1">
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <span :data-testid="`cultivation-method-v2-level-${row.def.key}`">
                <span class="text-ink-300">{{
                  t('cultivationMethodV2.field.level', {
                    level: row.entry.level,
                    max: row.def.maxLevel,
                  })
                }}</span>
              </span>
              <span :data-testid="`cultivation-method-v2-star-${row.def.key}`">
                <span class="text-amber-200">{{
                  t('cultivationMethodV2.field.star', {
                    star: row.entry.star,
                    max: row.def.maxStar,
                  })
                }}</span>
              </span>
              <span :data-testid="`cultivation-method-v2-fragments-${row.def.key}`">
                <span class="text-ink-300">{{
                  row.entry.unlocked
                    ? t('cultivationMethodV2.field.fragmentsStar', {
                      owned: row.entry.fragmentsOwned,
                      required: row.entry.fragmentsPerStar,
                    })
                    : t('cultivationMethodV2.field.fragments', {
                      owned: row.entry.fragmentsOwned,
                      required: row.entry.fragmentsRequiredToUnlock,
                    })
                }}</span>
              </span>
            </div>
            <div
              v-if="!row.entry.unlocked"
              class="text-ink-300"
              :data-testid="`cultivation-method-v2-unlock-cost-${row.def.key}`"
            >
              {{
                t('cultivationMethodV2.field.unlockCost', {
                  linhThach: row.entry.unlockLinhThachCost,
                  fragments: row.entry.fragmentsRequiredToUnlock,
                })
              }}
            </div>
            <div
              v-else-if="row.entry.level < row.def.maxLevel"
              class="text-ink-300"
              :data-testid="`cultivation-method-v2-upgrade-cost-${row.def.key}`"
            >
              {{
                t('cultivationMethodV2.field.upgradeCost', {
                  linhThach: row.entry.upgradeLinhThachCost,
                })
              }}
            </div>
            <div
              v-if="row.def.sourceHint.length > 0"
              class="text-[11px] text-ink-400"
              :data-testid="`cultivation-method-v2-sources-${row.def.key}`"
            >
              {{
                t('cultivationMethodV2.field.sourceHint', {
                  sources: row.def.sourceHint.join(', '),
                })
              }}
            </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-1">
            <button
              v-if="!row.entry.unlocked"
              type="button"
              class="px-3 py-1.5 text-xs rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              :disabled="!row.entry.canUnlock || store.busy(`${row.def.key}:unlock`)"
              :data-testid="`cultivation-method-v2-unlock-${row.def.key}`"
              @click="onUnlock(row)"
            >
              {{
                store.busy(`${row.def.key}:unlock`)
                  ? t('cultivationMethodV2.action.unlocking')
                  : t('cultivationMethodV2.action.unlock')
              }}
            </button>

            <template v-else>
              <button
                v-for="slot in row.def.allowedSlots"
                :key="slot"
                type="button"
                class="px-3 py-1.5 text-xs rounded border border-ink-300/40 hover:bg-ink-700/60 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
                :class="
                  row.entry.equippedSlot === slot
                    ? 'bg-emerald-700/60 border-emerald-400/60 text-emerald-50'
                    : 'bg-ink-900/40 text-ink-100'
                "
                :disabled="
                  row.entry.equippedSlot === slot ||
                    !row.entry.canEquip ||
                    store.busy(`${row.def.key}:equip:${slot}`)
                "
                :data-testid="`cultivation-method-v2-equip-${row.def.key}-${slot}`"
                @click="onEquip(row, slot)"
              >
                {{
                  store.busy(`${row.def.key}:equip:${slot}`)
                    ? t('cultivationMethodV2.action.equipping')
                    : t('cultivationMethodV2.action.equip', {
                      slot: t(`cultivationMethodV2.slot.${slot}`),
                    })
                }}
              </button>

              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-sky-700 text-sky-50 hover:bg-sky-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
                :disabled="
                  !row.entry.canUpgrade ||
                    row.entry.level >= row.def.maxLevel ||
                    store.busy(`${row.def.key}:upgrade`)
                "
                :data-testid="`cultivation-method-v2-upgrade-${row.def.key}`"
                @click="onUpgrade(row)"
              >
                <template v-if="row.entry.level >= row.def.maxLevel">
                  {{ t('cultivationMethodV2.action.maxLevel') }}
                </template>
                <template v-else>
                  {{
                    store.busy(`${row.def.key}:upgrade`)
                      ? t('cultivationMethodV2.action.upgrading')
                      : t('cultivationMethodV2.action.upgrade')
                  }}
                </template>
              </button>

              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-violet-700 text-violet-50 hover:bg-violet-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
                :disabled="
                  !row.entry.canStarUp ||
                    row.entry.star >= row.def.maxStar ||
                    store.busy(`${row.def.key}:starUp`)
                "
                :data-testid="`cultivation-method-v2-starup-${row.def.key}`"
                @click="onStarUp(row)"
              >
                <template v-if="row.entry.star >= row.def.maxStar">
                  {{ t('cultivationMethodV2.action.maxStar') }}
                </template>
                <template v-else>
                  {{
                    store.busy(`${row.def.key}:starUp`)
                      ? t('cultivationMethodV2.action.starringUp')
                      : t('cultivationMethodV2.action.starUp')
                  }}
                </template>
              </button>
            </template>
          </div>
        </article>
      </section>
    </div>
  </AppShell>
</template>
