<script setup lang="ts">
/**
 * Phase 11.2.C — Skill Book (Pháp Quyển) view.
 *
 * Hiển thị skill character đã học (server trả về qua `GET /character/skill`)
 * + 3 action server-authoritative:
 *   - `equip(skillKey)` — gắn vào loadout (cap 4 ngoài basic_attack).
 *   - `unequip(skillKey)` — gỡ.
 *   - `upgradeMastery(skillKey)` — +1 mastery, server deduct LinhThach qua
 *     `CurrencyService.applyTx({reason:'SKILL_UPGRADE'})`.
 *
 * Server validate ownership + cost + cap. UI chỉ enable/disable button +
 * hiển thị toast theo error code.
 *
 * Filters:
 *   - Tier: all | basic | intermediate | advanced | master | legendary.
 *   - Element: all | kim | moc | thuy | hoa | tho | none (vô hệ).
 *   - Equipped: all | equipped | unequipped.
 *
 * Mỗi skill card kết hợp `SkillView` server + `SkillDef` static catalog
 * (từ `@xuantoi/shared`) để lấy name/description/sect/element/role.
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 4 endpoint Phase 11.2.B.
 * Skill book drop/consume defer Phase 11.2.D (item ledger flow).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  SKILLS,
  skillByKey,
  type ElementKey,
  type SkillDef,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useSkillStore } from '@/stores/skill';
import { useToastStore } from '@/stores/toast';
import type { SkillTier, SkillView } from '@/api/skill';
import AppShell from '@/components/shell/AppShell.vue';
import ElementBadge from '@/components/ElementBadge.vue';

type TierFilter = 'all' | SkillTier;
type ElementFilter = 'all' | ElementKey | 'none';
type EquippedFilter = 'all' | 'equipped' | 'unequipped';

interface SkillRow {
  view: SkillView;
  def: SkillDef;
}

const auth = useAuthStore();
const game = useGameStore();
const skills = useSkillStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const tierFilter = ref<TierFilter>('all');
const elementFilter = ref<ElementFilter>('all');
const equippedFilter = ref<EquippedFilter>('all');

const rows = computed<SkillRow[]>(() => {
  return skills.learned
    .map((view) => {
      const def = skillByKey(view.skillKey);
      return def ? { view, def } : null;
    })
    .filter((r): r is SkillRow => r !== null);
});

const filtered = computed<SkillRow[]>(() => {
  return rows.value.filter((r) => {
    if (tierFilter.value !== 'all' && r.view.tier !== tierFilter.value) {
      return false;
    }
    if (elementFilter.value !== 'all') {
      if (elementFilter.value === 'none') {
        if (r.def.element != null) return false;
      } else if (r.def.element !== elementFilter.value) {
        return false;
      }
    }
    if (equippedFilter.value === 'equipped' && !r.view.isEquipped) return false;
    if (equippedFilter.value === 'unequipped' && r.view.isEquipped) return false;
    return true;
  });
});

const counts = computed(() => ({
  total: rows.value.length,
  filtered: filtered.value.length,
  catalog: SKILLS.length,
  equipped: skills.equippedCount,
  maxEquipped: skills.maxEquipped,
}));

function tierClass(tier: SkillTier): string {
  switch (tier) {
    case 'basic':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'intermediate':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'advanced':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'master':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'legendary':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function isInFlight(skillKey: string): boolean {
  return skills.isInFlight(skillKey);
}

function equipDisabled(row: SkillRow): boolean {
  // basic_attack always equipped — never disable; server treats it as exempt.
  return row.view.isEquipped || isInFlight(row.view.skillKey);
}

function unequipDisabled(row: SkillRow): boolean {
  return !row.view.isEquipped || isInFlight(row.view.skillKey);
}

function upgradeDisabled(row: SkillRow): boolean {
  if (isInFlight(row.view.skillKey)) return true;
  return row.view.masteryLevel >= row.view.maxMastery;
}

function upgradeLabel(row: SkillRow): string {
  if (isInFlight(row.view.skillKey)) {
    return t('skillBook.button.upgrading');
  }
  if (row.view.masteryLevel >= row.view.maxMastery) {
    return t('skillBook.button.upgradeMax');
  }
  if (row.view.nextLevelLinhThachCost != null) {
    return t('skillBook.button.upgrade', {
      cost: row.view.nextLevelLinhThachCost,
    });
  }
  return t('skillBook.button.upgradeUnknown');
}

function pushErrorToast(code: string, fallbackKey: string): void {
  if (code === 'IN_FLIGHT') return;
  const key = `skillBook.errors.${code}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t(fallbackKey) : text,
  });
}

async function onEquip(row: SkillRow): Promise<void> {
  if (equipDisabled(row)) return;
  const code = await skills.equip(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.equip.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
  }
}

async function onUnequip(row: SkillRow): Promise<void> {
  if (unequipDisabled(row)) return;
  const code = await skills.unequip(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.unequip.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
  }
}

async function onUpgrade(row: SkillRow): Promise<void> {
  if (upgradeDisabled(row)) return;
  const code = await skills.upgradeMastery(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.upgrade.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
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
  await skills.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">{{ t('skillBook.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('skillBook.subtitle') }}
          </p>
        </div>
        <div class="text-xs text-ink-300" data-testid="skill-book-equipped-count">
          {{
            t('skillBook.equippedSummary', {
              equipped: counts.equipped,
              max: counts.maxEquipped,
            })
          }}
        </div>
      </header>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.tier') }}</label>
          <select
            v-model="tierFilter"
            data-testid="skill-book-filter-tier"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="basic">{{ t('skillBook.tier.basic') }}</option>
            <option value="intermediate">{{ t('skillBook.tier.intermediate') }}</option>
            <option value="advanced">{{ t('skillBook.tier.advanced') }}</option>
            <option value="master">{{ t('skillBook.tier.master') }}</option>
            <option value="legendary">{{ t('skillBook.tier.legendary') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.element') }}</label>
          <select
            v-model="elementFilter"
            data-testid="skill-book-filter-element"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="kim">{{ t('skillBook.element.kim') }}</option>
            <option value="moc">{{ t('skillBook.element.moc') }}</option>
            <option value="thuy">{{ t('skillBook.element.thuy') }}</option>
            <option value="hoa">{{ t('skillBook.element.hoa') }}</option>
            <option value="tho">{{ t('skillBook.element.tho') }}</option>
            <option value="none">{{ t('skillBook.element.none') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.equipped') }}</label>
          <select
            v-model="equippedFilter"
            data-testid="skill-book-filter-equipped"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="equipped">{{ t('skillBook.equipFilter.equipped') }}</option>
            <option value="unequipped">{{ t('skillBook.equipFilter.unequipped') }}</option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="skill-book-count">
          {{
            t('skillBook.filter.shown', {
              shown: counts.filtered,
              total: counts.total,
              catalog: counts.catalog,
            })
          }}
        </span>
      </section>

      <section
        v-if="!skills.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="skill-book-loading"
      >
        {{ t('skillBook.loading') }}
      </section>

      <section
        v-else-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="skill-book-empty"
      >
        {{ t('skillBook.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="skill-book-list"
      >
        <article
          v-for="row in filtered"
          :key="row.view.skillKey"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`skill-book-card-${row.view.skillKey}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ row.def.name }}</h2>
            <div class="flex items-center gap-1">
              <span
                :class="['text-[10px] px-1.5 py-0.5 rounded border', tierClass(row.view.tier)]"
                :data-testid="`skill-book-tier-${row.view.skillKey}`"
              >
                {{ t(`skillBook.tier.${row.view.tier}`) }}
              </span>
              <ElementBadge
                :element="row.def.element ?? null"
                :show-neutral="true"
                size="sm"
                :data-testid="`skill-book-element-${row.view.skillKey}`"
              />
              <span
                v-if="row.view.isEquipped"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                :data-testid="`skill-book-equipped-badge-${row.view.skillKey}`"
              >
                {{ t('skillBook.badge.equipped') }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ row.def.description }}</p>

          <div class="text-xs space-y-1">
            <div
              class="flex items-center gap-1"
              :data-testid="`skill-book-mastery-${row.view.skillKey}`"
            >
              <span class="text-ink-300">{{ t('skillBook.field.mastery') }}:</span>
              <span class="text-amber-200">
                {{ row.view.masteryLevel }} / {{ row.view.maxMastery }}
              </span>
            </div>
            <div
              v-if="row.view.effective"
              class="flex flex-wrap gap-x-3"
              :data-testid="`skill-book-effective-${row.view.skillKey}`"
            >
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.atkScale') }}</span>
                <span class="text-amber-200 ml-1">×{{ row.view.effective.atkScale.toFixed(2) }}</span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.mpCost') }}</span>
                <span class="text-sky-200 ml-1">{{ row.view.effective.mpCost }}</span>
              </span>
              <span v-if="row.view.effective.cooldownTurns > 0">
                <span class="text-ink-300">{{ t('skillBook.field.cooldown') }}</span>
                <span class="text-rose-200 ml-1">{{ row.view.effective.cooldownTurns }}</span>
              </span>
            </div>
            <div>
              <span class="text-ink-300">{{ t('skillBook.field.source') }}:</span>
              <span
                class="text-ink-100 ml-1"
                :data-testid="`skill-book-source-${row.view.skillKey}`"
              >
                {{ row.view.source }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 mt-1">
            <button
              v-if="!row.view.isEquipped"
              type="button"
              :disabled="equipDisabled(row)"
              :data-testid="`skill-book-equip-${row.view.skillKey}`"
              class="flex-1 min-w-[120px] px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onEquip(row)"
            >
              {{ isInFlight(row.view.skillKey) ? t('skillBook.button.equipping') : t('skillBook.button.equip') }}
            </button>
            <button
              v-else
              type="button"
              :disabled="unequipDisabled(row)"
              :data-testid="`skill-book-unequip-${row.view.skillKey}`"
              class="flex-1 min-w-[120px] px-3 py-1.5 text-sm rounded bg-ink-700 text-ink-100 hover:bg-ink-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onUnequip(row)"
            >
              {{ isInFlight(row.view.skillKey) ? t('skillBook.button.unequipping') : t('skillBook.button.unequip') }}
            </button>
            <button
              type="button"
              :disabled="upgradeDisabled(row)"
              :data-testid="`skill-book-upgrade-${row.view.skillKey}`"
              class="flex-1 min-w-[140px] px-3 py-1.5 text-sm rounded bg-violet-700 text-violet-50 hover:bg-violet-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onUpgrade(row)"
            >
              {{ upgradeLabel(row) }}
            </button>
          </div>
        </article>
      </section>
    </div>
  </AppShell>
</template>
