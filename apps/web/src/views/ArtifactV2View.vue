<script setup lang="ts">
/**
 * Phase 26.4 — Artifact / Pháp Bảo V2 view.
 *
 * Quản lý tiến trình Pháp Bảo V2 server-authoritative:
 *   - 9 tier · 6 grade · 10 type · 8 element (KIM/MOC/THUY/HOA/THO + NONE
 *     + MIXED + HON_NGUYEN) · 5 equip slot.
 *   - 6 thao tác:
 *       craft       (blueprint + materials + linhThach + RNG),
 *       equip       (slot validation server, partial unique),
 *       unequip     (slot reset),
 *       upgrade     (level, 100% success),
 *       starUp      (RNG, fail-soft),
 *       refine      (RNG, fail-soft),
 *       awaken      (RNG, fail-soft, tier ≥5 + grade TIEN/THAN cap).
 *
 * KHÔNG có optimistic state — gọi xong sẽ replace state từ
 * `ArtifactV2StateOut`. Tất cả số liệu balance lấy từ catalog static
 * `@xuantoi/shared` (`ARTIFACT_CATALOG_V2` / `ARTIFACT_BLUEPRINT_CATALOG`).
 *
 * Bao trùm đủ state: loading / error+reload / empty / list (UI MODULE RULE).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ARTIFACT_EQUIP_SLOTS,
  ARTIFACT_GRADES,
  ARTIFACT_TYPES,
  ARTIFACT_ELEMENTS,
  type ArtifactGrade,
  type ArtifactType,
  type ArtifactElement,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import {
  getArtifactV2State,
  craftArtifactV2,
  equipArtifactV2,
  unequipArtifactV2,
  upgradeArtifactV2Level,
  starUpArtifactV2,
  refineArtifactV2,
  awakenArtifactV2,
  type ArtifactV2State,
  type ArtifactV2OwnedEntry,
  type ArtifactV2BlueprintEntry,
  type ArtifactEquipSlotV2,
} from '@/api/artifactsV2';
import AppShell from '@/components/shell/AppShell.vue';

const { t } = useI18n();
const toast = useToastStore();

const state = ref<ArtifactV2State | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const tab = ref<'owned' | 'blueprint' | 'preview'>('owned');
const inFlight = ref<string | null>(null);

const typeFilter = ref<'all' | ArtifactType>('all');
const elementFilter = ref<'all' | ArtifactElement>('all');
const tierFilter = ref<'all' | number>('all');
const gradeFilter = ref<'all' | ArtifactGrade>('all');
const equippedOnly = ref(false);

const slotChoice = ref<Record<string, ArtifactEquipSlotV2>>({});

function pushError(code: string): void {
  const key = `artifactV2.error.${code}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t('artifactV2.error.UNKNOWN') : text,
  });
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await getArtifactV2State();
  } catch (e) {
    const msg = (e as Error)?.message || t('artifactV2.reloadError');
    error.value = msg;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
});

const ownedRows = computed<ArtifactV2OwnedEntry[]>(() => {
  if (!state.value) return [];
  const rows = [...state.value.owned];
  rows.sort((a, b) => {
    const ea = a.equippedSlot ? 0 : 1;
    const eb = b.equippedSlot ? 0 : 1;
    if (ea !== eb) return ea - eb;
    if (a.tier !== b.tier) return b.tier - a.tier;
    return b.powerScore - a.powerScore;
  });
  return rows;
});

const filteredOwned = computed<ArtifactV2OwnedEntry[]>(() =>
  ownedRows.value.filter((row) => {
    if (typeFilter.value !== 'all' && row.type !== typeFilter.value) return false;
    if (elementFilter.value !== 'all' && row.element !== elementFilter.value) return false;
    if (tierFilter.value !== 'all' && row.tier !== tierFilter.value) return false;
    if (gradeFilter.value !== 'all' && row.grade !== gradeFilter.value) return false;
    if (equippedOnly.value && !row.equippedSlot) return false;
    return true;
  }),
);

const filteredBlueprints = computed<ArtifactV2BlueprintEntry[]>(() => {
  if (!state.value) return [];
  return state.value.blueprints.filter((bp) => {
    if (typeFilter.value !== 'all' && bp.artifactType !== typeFilter.value) return false;
    if (elementFilter.value !== 'all' && bp.artifactElement !== elementFilter.value) return false;
    if (tierFilter.value !== 'all' && bp.artifactTier !== tierFilter.value) return false;
    return true;
  });
});

const tierOptions = computed<number[]>(() => [1, 2, 3, 4, 5, 6, 7, 8, 9]);

function elementKey(e: string): string {
  if (e === 'NONE' || e === 'MIXED' || e === 'HON_NGUYEN') return e;
  return e.toLowerCase();
}

function clearFilters(): void {
  typeFilter.value = 'all';
  elementFilter.value = 'all';
  tierFilter.value = 'all';
  gradeFilter.value = 'all';
  equippedOnly.value = false;
}

function pickSlot(artifactId: string, defaultSlot: ArtifactEquipSlotV2): ArtifactEquipSlotV2 {
  return slotChoice.value[artifactId] ?? defaultSlot;
}

function defaultSlotFor(row: ArtifactV2OwnedEntry): ArtifactEquipSlotV2 {
  if (row.type === 'CAULDRON') return 'ALCHEMY_ARTIFACT_V2';
  if (row.type === 'ARMOR') return 'DEFENSE_ARTIFACT_V2';
  if (row.type === 'BANNER' || row.type === 'PEARL' || row.type === 'MIRROR' || row.type === 'GOURD')
    return 'SUPPORT_ARTIFACT_V2';
  if (row.type === 'RING') return 'SPECIAL_ARTIFACT_V2';
  return 'MAIN_ARTIFACT_V2';
}

async function onCraft(bp: ArtifactV2BlueprintEntry): Promise<void> {
  if (!bp.canCraft || inFlight.value) return;
  inFlight.value = `craft:${bp.key}`;
  try {
    const res = await craftArtifactV2(bp.key);
    state.value = res.state;
    if (res.craft.success) {
      toast.push({
        type: 'success',
        text: t('artifactV2.toast.craftSuccess', {
          name: bp.artifactName,
          grade: t(`artifactV2.grade.${res.craft.grade ?? bp.maxGrade}`),
        }),
      });
    } else {
      toast.push({
        type: 'warning',
        text: t('artifactV2.toast.craftFail', { rate: bp.successRate }),
      });
    }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    pushError(code);
  } finally {
    inFlight.value = null;
  }
}

async function onEquip(row: ArtifactV2OwnedEntry): Promise<void> {
  if (inFlight.value) return;
  const slot = pickSlot(row.id, defaultSlotFor(row));
  inFlight.value = `equip:${row.id}`;
  try {
    state.value = await equipArtifactV2(row.id, slot);
    toast.push({
      type: 'success',
      text: t('artifactV2.toast.equipSuccess', {
        name: row.name,
        slot: t(`artifactV2.slot.${slot}`),
      }),
    });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    pushError(code);
  } finally {
    inFlight.value = null;
  }
}

async function onUnequip(row: ArtifactV2OwnedEntry): Promise<void> {
  if (inFlight.value) return;
  inFlight.value = `unequip:${row.id}`;
  try {
    state.value = await unequipArtifactV2(row.id);
    toast.push({
      type: 'success',
      text: t('artifactV2.toast.unequipSuccess', { name: row.name }),
    });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    pushError(code);
  } finally {
    inFlight.value = null;
  }
}

async function runUpgradeOp(
  row: ArtifactV2OwnedEntry,
  op: 'upgrade' | 'starUp' | 'refine' | 'awaken',
): Promise<void> {
  if (inFlight.value) return;
  inFlight.value = `${op}:${row.id}`;
  try {
    const fn = {
      upgrade: upgradeArtifactV2Level,
      starUp: starUpArtifactV2,
      refine: refineArtifactV2,
      awaken: awakenArtifactV2,
    }[op];
    const res = await fn(row.id);
    state.value = res.state;
    const actionLabel = t(`artifactV2.action.${op}`);
    if (res.upgrade.success) {
      toast.push({
        type: 'success',
        text: t('artifactV2.toast.upgradeSuccess', { action: actionLabel }),
      });
    } else {
      toast.push({
        type: 'warning',
        text: t('artifactV2.toast.upgradeFail', { action: actionLabel }),
      });
    }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    pushError(code);
  } finally {
    inFlight.value = null;
  }
}

function fmtPercent(v: number): string {
  return v.toFixed(2);
}
</script>

<template>
  <AppShell>
    <section data-testid="artifact-v2-view" class="artifact-v2">
      <header class="artifact-v2__header">
        <h1>{{ t('artifactV2.title') }}</h1>
        <p>{{ t('artifactV2.subtitle') }}</p>
      </header>

      <nav class="artifact-v2__tabs" role="tablist">
        <button
          v-for="key in (['owned', 'blueprint', 'preview'] as const)"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="tab === key"
          :class="{ active: tab === key }"
          :data-testid="`artifact-v2-tab-${key}`"
          @click="tab = key"
        >
          {{ t(`artifactV2.tab.${key}`) }}
        </button>
      </nav>

      <div class="artifact-v2__filters">
        <label>
          {{ t('artifactV2.filter.type') }}
          <select v-model="typeFilter" data-testid="artifact-v2-filter-type">
            <option value="all">{{ t('artifactV2.filter.all') }}</option>
            <option v-for="ty in ARTIFACT_TYPES" :key="ty" :value="ty">
              {{ t(`artifactV2.type.${ty}`) }}
            </option>
          </select>
        </label>
        <label>
          {{ t('artifactV2.filter.element') }}
          <select v-model="elementFilter" data-testid="artifact-v2-filter-element">
            <option value="all">{{ t('artifactV2.filter.all') }}</option>
            <option v-for="el in ARTIFACT_ELEMENTS" :key="el" :value="el">
              {{ t(`artifactV2.element.${elementKey(el)}`) }}
            </option>
          </select>
        </label>
        <label>
          {{ t('artifactV2.filter.tier') }}
          <select v-model="tierFilter" data-testid="artifact-v2-filter-tier">
            <option value="all">{{ t('artifactV2.filter.all') }}</option>
            <option v-for="ti in tierOptions" :key="ti" :value="ti">
              {{ t('artifactV2.field.tier', { tier: ti }) }}
            </option>
          </select>
        </label>
        <label v-if="tab === 'owned'">
          {{ t('artifactV2.filter.grade') }}
          <select v-model="gradeFilter" data-testid="artifact-v2-filter-grade">
            <option value="all">{{ t('artifactV2.filter.all') }}</option>
            <option v-for="g in ARTIFACT_GRADES" :key="g" :value="g">
              {{ t(`artifactV2.grade.${g}`) }}
            </option>
          </select>
        </label>
        <label v-if="tab === 'owned'">
          <input v-model="equippedOnly" type="checkbox" />
          {{ t('artifactV2.filter.equipped') }}
        </label>
        <button type="button" data-testid="artifact-v2-clear-filters" @click="clearFilters">
          {{ t('artifactV2.filter.clear') }}
        </button>
      </div>

      <p
        v-if="loading"
        class="artifact-v2__loading"
        data-testid="artifact-v2-loading"
      >
        {{ t('artifactV2.loading') }}
      </p>

      <div
        v-else-if="error"
        class="artifact-v2__error"
        data-testid="artifact-v2-error"
      >
        <p>{{ error }}</p>
        <button type="button" @click="refresh">{{ t('artifactV2.reload') }}</button>
      </div>

      <template v-else>
        <!-- OWNED TAB -->
        <ul
          v-if="tab === 'owned'"
          class="artifact-v2__list"
          data-testid="artifact-v2-owned-list"
        >
          <li
            v-if="filteredOwned.length === 0"
            class="artifact-v2__empty"
            data-testid="artifact-v2-owned-empty"
          >
            {{ t('artifactV2.empty') }}
          </li>
          <li
            v-for="row in filteredOwned"
            :key="row.id"
            class="artifact-v2__card"
            :data-testid="`artifact-v2-card-${row.id}`"
          >
            <header>
              <strong>{{ row.name }}</strong>
              <span class="badge">{{ t(`artifactV2.type.${row.type}`) }}</span>
              <span class="badge">{{ t(`artifactV2.element.${elementKey(row.element)}`) }}</span>
              <span class="badge">{{ t('artifactV2.field.tier', { tier: row.tier }) }}</span>
              <span class="badge">{{ t(`artifactV2.grade.${row.grade}`) }}</span>
            </header>
            <div class="artifact-v2__stats">
              <span>{{ t('artifactV2.field.level', { level: row.level, max: 30 }) }}</span>
              <span>{{ t('artifactV2.field.star', { star: row.star, max: 10 }) }}</span>
              <span>{{ t('artifactV2.field.refine', { refine: row.refineLevel, max: 6 }) }}</span>
              <span>{{ t('artifactV2.field.awaken', { awaken: row.awakenLevel, max: 5 }) }}</span>
              <span>{{ t('artifactV2.field.powerScore', { score: row.powerScore }) }}</span>
            </div>
            <div class="artifact-v2__actions">
              <template v-if="row.equippedSlot">
                <span class="badge equipped">{{ t(`artifactV2.slot.${row.equippedSlot}`) }}</span>
                <button
                  type="button"
                  :disabled="inFlight !== null"
                  :data-testid="`artifact-v2-unequip-${row.id}`"
                  @click="onUnequip(row)"
                >
                  {{ t('artifactV2.action.unequip') }}
                </button>
              </template>
              <template v-else>
                <select
                  :value="pickSlot(row.id, defaultSlotFor(row))"
                  :data-testid="`artifact-v2-slot-select-${row.id}`"
                  @change="(ev) => (slotChoice[row.id] = (ev.target as HTMLSelectElement).value as ArtifactEquipSlotV2)"
                >
                  <option v-for="slot in ARTIFACT_EQUIP_SLOTS" :key="slot" :value="slot">
                    {{ t(`artifactV2.slot.${slot}`) }}
                  </option>
                </select>
                <button
                  type="button"
                  :disabled="inFlight !== null"
                  :data-testid="`artifact-v2-equip-${row.id}`"
                  @click="onEquip(row)"
                >
                  {{ t('artifactV2.action.equip') }}
                </button>
              </template>
              <button
                type="button"
                :disabled="inFlight !== null"
                :data-testid="`artifact-v2-upgrade-${row.id}`"
                @click="runUpgradeOp(row, 'upgrade')"
              >
                {{ t('artifactV2.action.upgrade') }}
              </button>
              <button
                type="button"
                :disabled="inFlight !== null"
                :data-testid="`artifact-v2-star-${row.id}`"
                @click="runUpgradeOp(row, 'starUp')"
              >
                {{ t('artifactV2.action.starUp') }}
              </button>
              <button
                type="button"
                :disabled="inFlight !== null"
                :data-testid="`artifact-v2-refine-${row.id}`"
                @click="runUpgradeOp(row, 'refine')"
              >
                {{ t('artifactV2.action.refine') }}
              </button>
              <button
                type="button"
                :disabled="inFlight !== null || row.tier < 5"
                :data-testid="`artifact-v2-awaken-${row.id}`"
                @click="runUpgradeOp(row, 'awaken')"
              >
                {{ t('artifactV2.action.awaken') }}
              </button>
            </div>
          </li>
        </ul>

        <!-- BLUEPRINT TAB -->
        <ul
          v-else-if="tab === 'blueprint'"
          class="artifact-v2__list"
          data-testid="artifact-v2-blueprint-list"
        >
          <li
            v-if="filteredBlueprints.length === 0"
            class="artifact-v2__empty"
            data-testid="artifact-v2-blueprint-empty"
          >
            {{ t('artifactV2.field.noBlueprint') }}
          </li>
          <li
            v-for="bp in filteredBlueprints"
            :key="bp.key"
            class="artifact-v2__card"
            :data-testid="`artifact-v2-bp-${bp.key}`"
          >
            <header>
              <strong>{{ bp.artifactName }}</strong>
              <span class="badge">{{ t(`artifactV2.type.${bp.artifactType}`) }}</span>
              <span class="badge">{{ t(`artifactV2.element.${elementKey(bp.artifactElement)}`) }}</span>
              <span class="badge">{{ t('artifactV2.field.tier', { tier: bp.artifactTier }) }}</span>
              <span class="badge">{{ t('artifactV2.field.successRate', { value: bp.successRate }) }}</span>
            </header>
            <p class="artifact-v2__sourceHint">
              {{ t('artifactV2.field.sourceHint') }}: {{ bp.sourceHint.join(' · ') }}
            </p>
            <ul class="artifact-v2__inputs">
              <li v-for="input in bp.inputs" :key="input.itemKey">
                {{ input.itemKey }} × {{ input.qty }}
              </li>
            </ul>
            <p v-if="bp.missingMaterials.length > 0" class="artifact-v2__missing">
              {{ t('artifactV2.field.missingMaterials') }}:
              <span v-for="m in bp.missingMaterials" :key="m.itemKey">
                {{ m.itemKey }} ({{ m.owned }}/{{ m.required }})
              </span>
            </p>
            <p class="artifact-v2__cost">
              {{ t('artifactV2.field.linhThachCost', { value: bp.linhThachCost }) }}
            </p>
            <button
              type="button"
              :disabled="!bp.canCraft || inFlight !== null"
              :data-testid="`artifact-v2-craft-${bp.key}`"
              @click="onCraft(bp)"
            >
              {{ t('artifactV2.action.craft') }}
            </button>
          </li>
        </ul>

        <!-- PREVIEW TAB -->
        <div
          v-else
          class="artifact-v2__preview"
          data-testid="artifact-v2-preview"
        >
          <p>ATK +{{ state?.statPreview.atk ?? 0 }}</p>
          <p>DEF +{{ state?.statPreview.def ?? 0 }}</p>
          <p>HP +{{ state?.statPreview.hpMax ?? 0 }}</p>
          <p>MP +{{ state?.statPreview.mpMax ?? 0 }}</p>
          <p>Spirit +{{ state?.statPreview.spirit ?? 0 }}</p>
          <p>Speed +{{ fmtPercent(state?.statPreview.speed ?? 0) }}%</p>
          <p>Crit +{{ fmtPercent(state?.statPreview.crit ?? 0) }}%</p>
          <p>Boss DR -{{ fmtPercent(state?.statPreview.bossDamageReductionPct ?? 0) }}%</p>
          <p>Cultivation +{{ fmtPercent(state?.statPreview.cultivationRateBonusPct ?? 0) }}%</p>
          <p>Body +{{ fmtPercent(state?.statPreview.bodyCultivationRateBonusPct ?? 0) }}%</p>
          <p>Alchemy +{{ fmtPercent(state?.statPreview.alchemySuccessRateBonusPct ?? 0) }}%</p>
          <p>Drop +{{ fmtPercent(state?.statPreview.dropRateBonusPct ?? 0) }}%</p>
          <p>Luck +{{ fmtPercent(state?.statPreview.luckBonusPct ?? 0) }}%</p>
          <p>Tribulation +{{ fmtPercent(state?.statPreview.tribulationSupportBonusPct ?? 0) }}%</p>
        </div>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.artifact-v2 {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.artifact-v2__header h1 {
  margin: 0;
  font-size: 1.5rem;
}
.artifact-v2__tabs {
  display: flex;
  gap: 8px;
}
.artifact-v2__tabs button.active {
  font-weight: bold;
  text-decoration: underline;
}
.artifact-v2__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.artifact-v2__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.artifact-v2__card {
  border: 1px solid #444;
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.artifact-v2__card header {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: #333;
  font-size: 0.75rem;
}
.badge.equipped {
  background: #2a5;
}
.artifact-v2__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.85rem;
}
.artifact-v2__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.artifact-v2__missing {
  color: #c44;
  font-size: 0.85rem;
}
.artifact-v2__empty {
  list-style: none;
  padding: 16px;
  text-align: center;
  color: #888;
}
.artifact-v2__error {
  color: #c44;
}
</style>
