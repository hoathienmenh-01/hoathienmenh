<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ARTIFACT_EQUIP_SLOTS,
  EQUIP_SLOTS,
  LOADOUT_PRESET_MODES,
  LOADOUT_PRESET_NAME_MAX,
  MAX_ACTIVE_SKILLS,
  type ArtifactEquipSlot,
  type EquipSlot,
  type LoadoutApplyWarning,
  type LoadoutPresetMode,
  type LoadoutPresetView,
} from '@xuantoi/shared';
import {
  applyLoadoutPreset,
  createLoadoutPreset,
  deleteLoadoutPreset,
  listLoadoutPresets,
  setLoadoutDefault,
  updateLoadoutPreset,
  type LoadoutPresetInput,
} from '@/api/loadout';
import {
  listInventory,
  type InventoryView,
} from '@/api/inventory';
import { getSkillState, type SkillView } from '@/api/skill';
import {
  getArtifactV2State,
  type ArtifactV2OwnedEntry,
} from '@/api/artifactsV2';
import EquipmentArtCell from '@/components/xianxia/EquipmentArtCell.vue';

interface DraftForm {
  id: string | null;
  name: string;
  mode: LoadoutPresetMode;
  equipmentSlots: Partial<Record<EquipSlot, string>>;
  skillSlots: string[] | null;
  artifactSlots: Partial<Record<ArtifactEquipSlot, string>> | null;
}

const { t } = useI18n();

const loading = ref(false);
const loadError = ref<string | null>(null);
const presets = ref<LoadoutPresetView[]>([]);
const inventory = ref<InventoryView[]>([]);
const skills = ref<SkillView[]>([]);
const artifacts = ref<ArtifactV2OwnedEntry[]>([]);
const toastMsg = ref<string | null>(null);
const warnings = ref<LoadoutApplyWarning[] | null>(null);

const draft = ref<DraftForm | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);

function emptyDraft(): DraftForm {
  return {
    id: null,
    name: '',
    mode: 'PVE',
    equipmentSlots: {},
    skillSlots: null,
    artifactSlots: null,
  };
}

const defaultModes: ReadonlyArray<Exclude<LoadoutPresetMode, 'CUSTOM'>> = [
  'PVE',
  'PVP',
  'BOSS',
];

function isDefaultModeFlag(p: LoadoutPresetView, mode: LoadoutPresetMode): boolean {
  if (mode === 'PVE') return p.isDefaultForPve;
  if (mode === 'PVP') return p.isDefaultForPvp;
  if (mode === 'BOSS') return p.isDefaultForBoss;
  return false;
}

function selectedEquipmentTier(slot: EquipSlot): number | null {
  const id = draft.value?.equipmentSlots[slot];
  if (!id) return null;
  const iv = inventory.value.find((i) => i.id === id);
  return iv?.item.equipmentTier ?? null;
}

function eligibleEquipmentForSlot(slot: EquipSlot): InventoryView[] {
  return inventory.value.filter((iv) => iv.item.slot === slot);
}

function eligibleSkills(): SkillView[] {
  return skills.value;
}

function eligibleArtifacts(): ArtifactV2OwnedEntry[] {
  return artifacts.value;
}

const summary = computed(() => {
  const fmt = (p: LoadoutPresetView) => ({
    equipmentCount: Object.values(p.equipmentSlots).filter(Boolean).length,
    skillCount: p.skillSlots?.length ?? null,
    artifactCount: p.artifactSlots
      ? Object.values(p.artifactSlots).filter(Boolean).length
      : null,
  });
  return new Map(presets.value.map((p) => [p.id, fmt(p)] as const));
});

async function refresh(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [pres, inv, sk, art] = await Promise.all([
      listLoadoutPresets(),
      listInventory().catch(() => [] as InventoryView[]),
      getSkillState()
        .then((s) => s.learned)
        .catch(() => [] as SkillView[]),
      getArtifactV2State()
        .then((s) => s.owned)
        .catch(() => [] as ArtifactV2OwnedEntry[]),
    ]);
    presets.value = pres;
    inventory.value = inv;
    skills.value = sk;
    artifacts.value = art;
  } catch (err) {
    loadError.value = readErr(err, t('loadout.loadFail'));
  } finally {
    loading.value = false;
  }
}

function readErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string };
    if (e.code) {
      const key = `loadout.errors.${e.code}`;
      const tx = t(key);
      if (tx && tx !== key) return tx;
    }
    if (e.message) return e.message;
  }
  return fallback;
}

function startCreate(): void {
  draft.value = emptyDraft();
  submitError.value = null;
}

function startEdit(p: LoadoutPresetView): void {
  draft.value = {
    id: p.id,
    name: p.name,
    mode: p.mode,
    equipmentSlots: { ...p.equipmentSlots },
    skillSlots: p.skillSlots ? [...p.skillSlots] : null,
    artifactSlots: p.artifactSlots ? { ...p.artifactSlots } : null,
  };
  submitError.value = null;
}

function cancelDraft(): void {
  draft.value = null;
  submitError.value = null;
}

function toggleSkillEnabled(enabled: boolean): void {
  if (!draft.value) return;
  draft.value.skillSlots = enabled ? [] : null;
}

function toggleSkillSlot(skillKey: string): void {
  if (!draft.value) return;
  if (!draft.value.skillSlots) {
    draft.value.skillSlots = [skillKey];
    return;
  }
  const idx = draft.value.skillSlots.indexOf(skillKey);
  if (idx >= 0) {
    draft.value.skillSlots.splice(idx, 1);
  } else if (draft.value.skillSlots.length < MAX_ACTIVE_SKILLS) {
    draft.value.skillSlots.push(skillKey);
  }
}

function toggleArtifactEnabled(enabled: boolean): void {
  if (!draft.value) return;
  draft.value.artifactSlots = enabled ? {} : null;
}

function setEquipment(slot: EquipSlot, value: string): void {
  if (!draft.value) return;
  if (!value) delete draft.value.equipmentSlots[slot];
  else draft.value.equipmentSlots[slot] = value;
}

function setArtifact(slot: ArtifactEquipSlot, value: string): void {
  if (!draft.value || !draft.value.artifactSlots) return;
  if (!value) delete draft.value.artifactSlots[slot];
  else draft.value.artifactSlots[slot] = value;
}

async function submitDraft(): Promise<void> {
  if (!draft.value) return;
  submitting.value = true;
  submitError.value = null;
  const payload: LoadoutPresetInput = {
    name: draft.value.name.trim(),
    mode: draft.value.mode,
    equipmentSlots: draft.value.equipmentSlots,
    skillSlots: draft.value.skillSlots,
    artifactSlots: draft.value.artifactSlots,
  };
  try {
    let saved: LoadoutPresetView;
    if (draft.value.id) {
      saved = await updateLoadoutPreset(draft.value.id, payload);
      toastMsg.value = t('loadout.summary.updatedToast', { name: saved.name });
    } else {
      saved = await createLoadoutPreset(payload);
      toastMsg.value = t('loadout.summary.createdToast', { name: saved.name });
    }
    draft.value = null;
    await refresh();
  } catch (err) {
    submitError.value = readErr(err, t('common.apiFallback.loadoutCreate'));
  } finally {
    submitting.value = false;
  }
}

async function applyPreset(p: LoadoutPresetView): Promise<void> {
  warnings.value = null;
  try {
    const r = await applyLoadoutPreset(p.id);
    if (r.warnings.length > 0) {
      warnings.value = r.warnings;
    } else {
      toastMsg.value = t('loadout.summary.appliedToast', { name: p.name });
      await refresh();
    }
  } catch (err) {
    submitError.value = readErr(err, t('common.apiFallback.loadoutApply'));
  }
}

async function removePreset(p: LoadoutPresetView): Promise<void> {
  if (!window.confirm(t('loadout.actions.deleteConfirm', { name: p.name }))) return;
  try {
    await deleteLoadoutPreset(p.id);
    toastMsg.value = t('loadout.summary.deletedToast', { name: p.name });
    await refresh();
  } catch (err) {
    submitError.value = readErr(err, t('common.apiFallback.loadoutDelete'));
  }
}

async function setDefault(
  p: LoadoutPresetView,
  mode: Exclude<LoadoutPresetMode, 'CUSTOM'>,
): Promise<void> {
  try {
    await setLoadoutDefault(p.id, mode);
    toastMsg.value = t('loadout.summary.defaultSetToast', {
      name: p.name,
      mode: t(`loadout.mode.${mode}`),
    });
    await refresh();
  } catch (err) {
    submitError.value = readErr(err, t('common.apiFallback.loadoutSetDefault'));
  }
}

onMounted(refresh);
</script>

<template>
  <main class="page-shell space-y-4 px-3 sm:px-6 py-4">
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div>
        <h1 class="text-xl sm:text-2xl font-bold">{{ t('loadout.title') }}</h1>
        <p class="text-sm text-ink-400">{{ t('loadout.subtitle') }}</p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        data-testid="loadout-create-btn"
        :disabled="loading"
        @click="startCreate"
      >
        + {{ t('loadout.actions.create') }}
      </button>
    </header>

    <p v-if="toastMsg" class="rounded bg-emerald-700/30 text-emerald-200 px-3 py-2 text-sm">
      {{ toastMsg }}
    </p>
    <p v-if="loadError" class="rounded bg-rose-700/30 text-rose-200 px-3 py-2 text-sm">
      {{ loadError }}
    </p>
    <p v-if="submitError" class="rounded bg-rose-700/30 text-rose-200 px-3 py-2 text-sm">
      {{ submitError }}
    </p>

    <div
      v-if="warnings && warnings.length > 0"
      class="rounded bg-amber-700/30 text-amber-100 px-3 py-2 text-sm space-y-1"
      data-testid="loadout-warnings"
    >
      <strong>{{ t('loadout.warning.title') }}</strong>
      <ul class="list-disc pl-5">
        <li v-for="(w, i) in warnings" :key="i">
          <template v-if="w.code === 'EQUIPMENT_MISSING'">
            {{ t('loadout.warning.EQUIPMENT_MISSING', { slot: w.slot ?? '' }) }}
          </template>
          <template v-else-if="w.code === 'SKILL_NOT_LEARNED'">
            {{ t('loadout.warning.SKILL_NOT_LEARNED', { ref: w.ref ?? '' }) }}
          </template>
          <template v-else-if="w.code === 'ARTIFACT_MISSING'">
            {{ t('loadout.warning.ARTIFACT_MISSING', { slot: w.slot ?? '' }) }}
          </template>
        </li>
      </ul>
    </div>

    <section
      v-if="draft"
      class="rounded border border-ink-600 bg-ink-800/40 p-3 sm:p-4 space-y-3"
      data-testid="loadout-draft-form"
    >
      <h2 class="font-semibold">
        {{ draft.id ? t('loadout.actions.edit') : t('loadout.actions.create') }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('loadout.form.name') }}</span>
          <input
            v-model="draft.name"
            type="text"
            class="input"
            :maxlength="LOADOUT_PRESET_NAME_MAX"
            :placeholder="t('loadout.form.namePlaceholder')"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('loadout.form.mode') }}</span>
          <select v-model="draft.mode" class="input">
            <option v-for="m in LOADOUT_PRESET_MODES" :key="m" :value="m">
              {{ t(`loadout.mode.${m}`) }}
            </option>
          </select>
        </label>
      </div>

      <details open class="border border-ink-700 rounded">
        <summary class="px-3 py-2 cursor-pointer font-medium">
          {{
            t('loadout.form.equipmentLabel', {
              n: Object.values(draft.equipmentSlots).filter(Boolean).length,
            })
          }}
        </summary>
        <div class="px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            v-for="slot in EQUIP_SLOTS"
            :key="slot"
            class="flex items-center gap-2 text-xs"
          >
            <EquipmentArtCell
              :equip-slot="slot"
              :tier="selectedEquipmentTier(slot)"
              :equipped="!!draft.equipmentSlots[slot]"
              :alt="slot"
              size="sm"
            />
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <span>{{ slot }}</span>
              <select
                :value="draft.equipmentSlots[slot] ?? ''"
                class="input"
                @change="(e) => setEquipment(slot, (e.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="iv in eligibleEquipmentForSlot(slot)" :key="iv.id" :value="iv.id">
                  {{ iv.item.name ?? iv.itemKey }}
                  <template v-if="iv.refineLevel > 0">(+{{ iv.refineLevel }})</template>
                </option>
              </select>
            </div>
          </label>
        </div>
      </details>

      <details class="border border-ink-700 rounded">
        <summary class="px-3 py-2 cursor-pointer font-medium">
          {{
            t('loadout.form.skillLabel', {
              n: draft.skillSlots?.length ?? 0,
            })
          }}
        </summary>
        <div class="px-3 py-2 space-y-2">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="draft.skillSlots !== null"
              @change="(e) => toggleSkillEnabled((e.target as HTMLInputElement).checked)"
            />
            <span v-if="draft.skillSlots === null">{{ t('loadout.form.skillEmpty') }}</span>
            <span v-else>{{ t('loadout.form.skillLabel', { n: draft.skillSlots.length }) }}</span>
          </label>
          <div v-if="draft.skillSlots !== null" class="grid grid-cols-1 sm:grid-cols-2 gap-1">
            <label
              v-for="sk in eligibleSkills()"
              :key="sk.skillKey"
              class="flex items-center gap-2 text-xs"
            >
              <input
                type="checkbox"
                :checked="draft.skillSlots.includes(sk.skillKey)"
                :disabled="
                  !draft.skillSlots.includes(sk.skillKey) &&
                    draft.skillSlots.length >= MAX_ACTIVE_SKILLS
                "
                @change="() => toggleSkillSlot(sk.skillKey)"
              />
              <span>{{ sk.skillKey }} (Lv {{ sk.masteryLevel }})</span>
            </label>
          </div>
        </div>
      </details>

      <details class="border border-ink-700 rounded">
        <summary class="px-3 py-2 cursor-pointer font-medium">
          {{
            t('loadout.form.artifactLabel', {
              n: draft.artifactSlots
                ? Object.values(draft.artifactSlots).filter(Boolean).length
                : 0,
            })
          }}
        </summary>
        <div class="px-3 py-2 space-y-2">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="draft.artifactSlots !== null"
              @change="(e) => toggleArtifactEnabled((e.target as HTMLInputElement).checked)"
            />
            <span v-if="draft.artifactSlots === null">{{ t('loadout.form.artifactEmpty') }}</span>
            <span v-else>{{
              t('loadout.form.artifactLabel', {
                n: Object.values(draft.artifactSlots).filter(Boolean).length,
              })
            }}</span>
          </label>
          <div v-if="draft.artifactSlots !== null" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label
              v-for="slot in ARTIFACT_EQUIP_SLOTS"
              :key="slot"
              class="flex flex-col gap-1 text-xs"
            >
              <span>{{ slot }}</span>
              <select
                :value="draft.artifactSlots[slot] ?? ''"
                class="input"
                @change="(e) => setArtifact(slot, (e.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="a in eligibleArtifacts()" :key="a.id" :value="a.id">
                  {{ a.name }}
                </option>
              </select>
            </label>
          </div>
        </div>
      </details>

      <div class="flex flex-wrap gap-2 justify-end">
        <button type="button" class="btn" @click="cancelDraft">
          {{ t('loadout.form.cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="loadout-submit-btn"
          :disabled="submitting || !draft.name.trim()"
          @click="submitDraft"
        >
          {{ draft.id ? t('loadout.form.submitUpdate') : t('loadout.form.submitCreate') }}
        </button>
      </div>
    </section>

    <p v-if="!loading && presets.length === 0" class="text-ink-400 text-sm">
      {{ t('loadout.empty') }}
    </p>

    <ul v-else class="space-y-3" data-testid="loadout-list">
      <li
        v-for="p in presets"
        :key="p.id"
        class="rounded border border-ink-600 bg-ink-800/40 p-3 sm:p-4 space-y-2"
        :data-testid="`loadout-row-${p.id}`"
      >
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-semibold">{{ p.name }}</h3>
            <span
              class="text-[10px] px-1.5 py-0.5 rounded bg-ink-700/60 uppercase"
              :data-testid="`loadout-mode-${p.mode}`"
            >
              {{ t(`loadout.mode.${p.mode}`) }}
            </span>
            <span
              v-if="isDefaultModeFlag(p, 'PVE')"
              class="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-100"
            >
              {{ t('loadout.actions.isDefault') }} · {{ t('loadout.mode.PVE') }}
            </span>
            <span
              v-if="isDefaultModeFlag(p, 'PVP')"
              class="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-100"
            >
              {{ t('loadout.actions.isDefault') }} · {{ t('loadout.mode.PVP') }}
            </span>
            <span
              v-if="isDefaultModeFlag(p, 'BOSS')"
              class="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-100"
            >
              {{ t('loadout.actions.isDefault') }} · {{ t('loadout.mode.BOSS') }}
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :data-testid="`loadout-apply-${p.id}`"
              @click="applyPreset(p)"
            >
              {{ t('loadout.actions.apply') }}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :data-testid="`loadout-edit-${p.id}`"
              @click="startEdit(p)"
            >
              {{ t('loadout.actions.edit') }}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :data-testid="`loadout-delete-${p.id}`"
              @click="removePreset(p)"
            >
              {{ t('loadout.actions.delete') }}
            </button>
          </div>
        </div>

        <div class="text-xs text-ink-300 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {{
              t('loadout.summary.equipmentCount', {
                n: summary.get(p.id)?.equipmentCount ?? 0,
              })
            }}
          </span>
          <span v-if="summary.get(p.id)?.skillCount === null">
            {{ t('loadout.summary.skillUntouched') }}
          </span>
          <span v-else>
            {{
              t('loadout.summary.skillCount', {
                n: summary.get(p.id)?.skillCount ?? 0,
              })
            }}
          </span>
          <span v-if="summary.get(p.id)?.artifactCount === null">
            {{ t('loadout.summary.artifactUntouched') }}
          </span>
          <span v-else>
            {{
              t('loadout.summary.artifactCount', {
                n: summary.get(p.id)?.artifactCount ?? 0,
              })
            }}
          </span>
        </div>

        <div class="flex flex-wrap gap-1 text-[11px]">
          <button
            v-for="m in defaultModes"
            :key="m"
            type="button"
            class="btn btn-xs"
            :class="isDefaultModeFlag(p, m) ? 'opacity-60' : ''"
            :disabled="isDefaultModeFlag(p, m)"
            :data-testid="`loadout-setdefault-${p.id}-${m}`"
            @click="setDefault(p, m)"
          >
            {{ t('loadout.actions.setDefault') }} · {{ t(`loadout.mode.${m}`) }}
          </button>
        </div>
      </li>
    </ul>
  </main>
</template>
