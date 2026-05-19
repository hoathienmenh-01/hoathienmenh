<script setup lang="ts">
/**
 * Phase 11.1.C — Cultivation Method (Công Pháp) view.
 *
 * Hiển thị các method character đã học (server trả về qua
 * `GET /character/cultivation-method`) + cho phép switch method đang equip
 * qua `POST /character/cultivation-method/equip`. Server-authoritative:
 *   - Server validate ownership + realm + sect + forbiddenElement.
 *   - Service `learn` defer Phase 11.1.D (drop table mission/dungeon) — UI
 *     hiện tại chỉ hiển thị method đã `learn` (mặc định starter qua lazy
 *     migration `grantStarterIfMissing`).
 *
 * Filters:
 *   - Grade: all | pham | huyen | tien | than
 *
 * Mỗi method card hiển thị (kết hợp learned row từ server + catalog static
 * `CULTIVATION_METHODS` từ `@xuantoi/shared` để lấy name/description/grade/
 * statBonus/expMultiplier):
 *   - Tên + grade badge + element badge (hoặc "Vô hệ" nếu element=null) +
 *     "Đang dùng" badge nếu equipped.
 *   - Description (lore).
 *   - Stat bonus (% hpMax/mpMax/atk/def, ẩn dòng nếu = 0).
 *   - Exp multiplier × N.NN.
 *   - Source (Khởi đầu / Sect / Dungeon / Boss / Sự kiện / Quest).
 *   - Nút "Đổi" (disable nếu in-flight hoặc đang equipped).
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 2 endpoint Phase 11.1.B.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  CULTIVATION_METHODS,
  getCultivationMethodDef,
  type CultivationMethodDef,
  type CultivationMethodGrade,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useCultivationMethodStore } from '@/stores/cultivationMethod';
import { useToastStore } from '@/stores/toast';
import type { CultivationMethodLearnedRow } from '@/api/cultivationMethod';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

type GradeFilter = 'all' | CultivationMethodGrade;

interface MethodRow {
  learned: CultivationMethodLearnedRow;
  def: CultivationMethodDef;
}

const auth = useAuthStore();
const game = useGameStore();
const methods = useCultivationMethodStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const gradeFilter = ref<GradeFilter>('all');

const rows = computed<MethodRow[]>(() => {
  return methods.learned
    .map((row) => {
      const def = getCultivationMethodDef(row.methodKey);
      return def ? { learned: row, def } : null;
    })
    .filter((x): x is MethodRow => x !== null);
});

const filtered = computed<MethodRow[]>(() => {
  if (gradeFilter.value === 'all') return rows.value;
  return rows.value.filter((r) => r.def.grade === gradeFilter.value);
});

const counts = computed(() => ({
  total: rows.value.length,
  filtered: filtered.value.length,
  catalog: CULTIVATION_METHODS.length,
}));

function gradeClass(g: CultivationMethodGrade): string {
  switch (g) {
    case 'pham':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'huyen':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'tien':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'than':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function equipButtonLabel(row: MethodRow): string {
  if (methods.isEquipped(row.def.key)) return t('cultivationMethod.button.equipped');
  if (methods.isEquipping(row.def.key)) return t('cultivationMethod.button.equipping');
  return t('cultivationMethod.button.equip');
}

function equipButtonDisabled(row: MethodRow): boolean {
  return methods.isEquipped(row.def.key) || methods.isEquipping(row.def.key);
}

async function onEquip(row: MethodRow): Promise<void> {
  if (equipButtonDisabled(row)) return;
  const errCode = await methods.equip(row.def.key);
  if (errCode === null) {
    toast.push({
      type: 'success',
      text: t('cultivationMethod.equip.success', { name: row.def.name }),
    });
  } else {
    const key = `cultivationMethod.equip.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('cultivationMethod.equip.errors.UNKNOWN') : text,
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
  await methods.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <XTLuxHero
        eyebrow="TÂM PHÁP TRUYỀN THỪA"
        label="Công Pháp"
        :title="t('cultivationMethod.title')"
        :subtitle="t('cultivationMethod.subtitle')"
        tone="gold"
        watermark-letter="C"
        breadcrumb="Tu Vi · Công Pháp"
        test-id="cultivation-method-hero"
        class="mb-4"
      />

      <div class="space-y-2 mb-4" data-testid="cultivation-method-role-section">
        <p class="text-xs text-ink-300 leading-relaxed" data-testid="cultivation-method-role-hint">
          {{ t('cultivationMethod.roleHint') }}
        </p>
        <div class="flex flex-wrap gap-2 text-xs" data-testid="cultivation-method-cross-nav">
          <router-link to="/cultivation" class="px-2 py-1 rounded bg-gold-900/40 text-gold-200 hover:bg-gold-800/50 transition">
            {{ t('cultivationMethod.crossNav.cultivation') }} — {{ t('cultivationMethod.crossNav.cultivationDesc') }}
          </router-link>
          <router-link to="/breakthrough" class="px-2 py-1 rounded bg-gold-900/40 text-gold-200 hover:bg-gold-800/50 transition">
            {{ t('cultivationMethod.crossNav.breakthrough') }} — {{ t('cultivationMethod.crossNav.breakthroughDesc') }}
          </router-link>
        </div>
      </div>

      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div
          class="text-xs text-ink-300 flex items-center gap-2"
          data-testid="cultivation-method-equipped"
        >
          <template v-if="methods.equippedMethodKey">
            <span>
              {{ t('cultivationMethod.equippedSummary', { key: methods.equippedMethodKey }) }}
            </span>
            <span
              v-if="methods.affinityPercentLabel && methods.affinityTierKey"
              class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
              :data-testid="'cultivation-method-affinity-summary'"
              :title="t(methods.affinityTierKey)"
              :aria-label="t(methods.affinityTierKey)"
            >
              {{ methods.affinityPercentLabel }}
            </span>
          </template>
          <template v-else>
            {{ t('cultivationMethod.equippedNone') }}
          </template>
        </div>
      </header>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('cultivationMethod.filter.grade') }}</label>
          <select
            v-model="gradeFilter"
            data-testid="cultivation-method-filter-grade"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('cultivationMethod.filter.all') }}</option>
            <option value="pham">{{ t('cultivationMethod.grade.pham') }}</option>
            <option value="huyen">{{ t('cultivationMethod.grade.huyen') }}</option>
            <option value="tien">{{ t('cultivationMethod.grade.tien') }}</option>
            <option value="than">{{ t('cultivationMethod.grade.than') }}</option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="cultivation-method-count">
          {{
            t('cultivationMethod.filter.shown', {
              shown: counts.filtered,
              total: counts.total,
              catalog: counts.catalog,
            })
          }}
        </span>
      </section>

      <section
        v-if="!methods.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="cultivation-method-loading"
      >
        {{ t('cultivationMethod.loading') }}
      </section>

      <section
        v-else-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="cultivation-method-empty"
      >
        {{ t('cultivationMethod.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="cultivation-method-list"
      >
        <article
          v-for="row in filtered"
          :key="row.def.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`cultivation-method-card-${row.def.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ row.def.name }}</h2>
            <div class="flex items-center gap-1">
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  gradeClass(row.def.grade),
                ]"
                :data-testid="`cultivation-method-grade-${row.def.key}`"
              >
                {{ t(`cultivationMethod.grade.${row.def.grade}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`cultivation-method-element-${row.def.key}`"
              >
                <template v-if="row.def.element">
                  {{ t(`cultivationMethod.element.${row.def.element}`) }}
                </template>
                <template v-else>
                  {{ t('cultivationMethod.element.none') }}
                </template>
              </span>
              <span
                v-if="methods.isEquipped(row.def.key)"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                :data-testid="`cultivation-method-equipped-badge-${row.def.key}`"
              >
                {{ t('cultivationMethod.badge.equipped') }}
              </span>
              <span
                v-if="
                  methods.isEquipped(row.def.key) &&
                    methods.affinityPercentLabel &&
                    methods.affinityTierKey
                "
                class="text-[10px] px-1.5 py-0.5 rounded border bg-amber-700/40 text-amber-200 border-amber-500/40"
                :data-testid="`cultivation-method-affinity-badge-${row.def.key}`"
                :title="t(methods.affinityTierKey)"
                :aria-label="t(methods.affinityTierKey)"
              >
                {{ methods.affinityPercentLabel }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ row.def.description }}</p>

          <div class="text-xs space-y-1">
            <div>
              <span class="text-ink-300">{{ t('cultivationMethod.field.expMultiplier') }}:</span>
              <span
                class="text-emerald-200 ml-1"
                :data-testid="`cultivation-method-exp-${row.def.key}`"
              >
                ×{{ row.def.expMultiplier.toFixed(2) }}
              </span>
            </div>
            <div
              v-if="
                row.def.statBonus.hpMaxPercent !== 0 ||
                  row.def.statBonus.mpMaxPercent !== 0 ||
                  row.def.statBonus.atkPercent !== 0 ||
                  row.def.statBonus.defPercent !== 0
              "
              class="flex flex-wrap gap-x-3"
              :data-testid="`cultivation-method-stat-${row.def.key}`"
            >
              <span v-if="row.def.statBonus.hpMaxPercent !== 0">
                <span class="text-ink-300">HP</span>
                <span class="text-rose-200 ml-1">+{{ Math.round(row.def.statBonus.hpMaxPercent * 100) }}%</span>
              </span>
              <span v-if="row.def.statBonus.mpMaxPercent !== 0">
                <span class="text-ink-300">MP</span>
                <span class="text-sky-200 ml-1">+{{ Math.round(row.def.statBonus.mpMaxPercent * 100) }}%</span>
              </span>
              <span v-if="row.def.statBonus.atkPercent !== 0">
                <span class="text-ink-300">ATK</span>
                <span class="text-amber-200 ml-1">+{{ Math.round(row.def.statBonus.atkPercent * 100) }}%</span>
              </span>
              <span v-if="row.def.statBonus.defPercent !== 0">
                <span class="text-ink-300">DEF</span>
                <span class="text-emerald-200 ml-1">+{{ Math.round(row.def.statBonus.defPercent * 100) }}%</span>
              </span>
            </div>
            <div>
              <span class="text-ink-300">{{ t('cultivationMethod.field.source') }}:</span>
              <span
                class="text-ink-100 ml-1"
                :data-testid="`cultivation-method-source-${row.def.key}`"
              >
                {{ t(`cultivationMethod.source.${row.def.source}`) }}
              </span>
            </div>
          </div>

          <button
            type="button"
            :disabled="equipButtonDisabled(row)"
            :data-testid="`cultivation-method-equip-${row.def.key}`"
            class="w-full mt-1 px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onEquip(row)"
          >
            {{ equipButtonLabel(row) }}
          </button>
        </article>
      </section>
    </div>
  </AppShell>
</template>
