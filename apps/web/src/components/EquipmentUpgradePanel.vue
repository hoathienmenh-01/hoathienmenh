<script setup lang="ts">
/**
 * Phase 15.0.A — Equipment Reforge / Enchant Foundation panel.
 *
 * Panel hiển thị bên cạnh equipment slot trong InventoryView. UI tối thiểu:
 *   - Current substats list (atk/def/hpMax/mpMax/spirit) — empty if `[]`.
 *   - Current enchant element + level (`null` if not yet enchanted).
 *   - Cost preview cho reforge attempt kế tiếp.
 *   - Cost preview cho enchant level-up kế tiếp (hoặc MAX label).
 *   - 5 element button (kim/moc/thuy/hoa/tho) — disable nếu đã lock element khác.
 *   - 2 nút action: Reforge, Enchant. Confirm modal trước khi tiêu.
 *
 * Server-authoritative — UI chỉ render preview; tất cả mutate qua API.
 * Caller phải re-fetch `listInventory()` sau khi success.
 *
 * Empty/loading/error state đều handled — UI không crash khi equipment chưa
 * có substats/enchant.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  MAX_ENCHANT_LEVEL,
  itemByKey,
  type ElementKey,
  type EquipmentSubstat,
  type EquipmentSubstatKind,
} from '@xuantoi/shared';
import {
  enchantEquipment,
  getEquipmentUpgradePreview,
  reforgeEquipment,
  type EquipmentUpgradePreview,
  type InventoryView,
} from '@/api/inventory';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import MButton from '@/components/ui/MButton.vue';

interface Props {
  equipment: InventoryView;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const preview = ref<EquipmentUpgradePreview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const lastError = ref<string | null>(null);
const reforgeOpen = ref(false);
const enchantOpen = ref(false);
const selectedElement = ref<ElementKey | null>(null);

watch(
  () => props.equipment.id,
  () => {
    void load();
  },
  { immediate: true },
);

async function load(): Promise<void> {
  if (!props.equipment.item.slot) {
    preview.value = null;
    return;
  }
  loading.value = true;
  lastError.value = null;
  try {
    preview.value = await getEquipmentUpgradePreview(props.equipment.id);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    preview.value = null;
  } finally {
    loading.value = false;
  }
}

const lockedElement = computed<ElementKey | null>(() => {
  return preview.value?.enchant.currentElement ?? null;
});
const enchantMaxed = computed(
  () => (preview.value?.enchant.currentLevel ?? 0) >= MAX_ENCHANT_LEVEL,
);

function substatLabel(s: EquipmentSubstat): string {
  return t('inventory.upgrade.substatRow', {
    kind: t(`inventory.upgrade.substatKind.${s.kind}`),
    value: s.value,
  });
}

function materialName(materialKey: string): string {
  const def = itemByKey(materialKey);
  return def?.name ?? materialKey;
}

function bonusLabel(bonus: Record<EquipmentSubstatKind, number>): string {
  const parts: string[] = [];
  for (const k of ['atk', 'def', 'hpMax', 'mpMax', 'spirit'] as EquipmentSubstatKind[]) {
    if (bonus[k] > 0) {
      parts.push(`+${bonus[k]} ${t(`inventory.upgrade.substatKind.${k}`)}`);
    }
  }
  return parts.length === 0 ? t('inventory.upgrade.none') : parts.join(', ');
}

function onClickReforge(): void {
  if (submitting.value || !preview.value) return;
  reforgeOpen.value = true;
}

async function confirmReforge(): Promise<void> {
  if (submitting.value || !preview.value) return;
  submitting.value = true;
  lastError.value = null;
  try {
    const r = await reforgeEquipment(props.equipment.id);
    toast.push({
      type: 'success',
      text: t('inventory.upgrade.reforge.successToast', {
        count: r.after.length,
      }),
    });
    reforgeOpen.value = false;
    await load();
    emit('changed');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    toast.push({
      type: 'error',
      text: t(`inventory.upgrade.error.${code}`, t('inventory.upgrade.error.UNKNOWN')),
    });
  } finally {
    submitting.value = false;
  }
}

function onSelectElement(el: ElementKey): void {
  if (lockedElement.value && lockedElement.value !== el) return;
  if (enchantMaxed.value) return;
  selectedElement.value = el;
}

function onClickEnchant(): void {
  if (submitting.value || !preview.value || enchantMaxed.value) return;
  if (!selectedElement.value) {
    if (lockedElement.value) {
      selectedElement.value = lockedElement.value;
    } else {
      lastError.value = 'NO_ELEMENT_SELECTED';
      toast.push({
        type: 'error',
        text: t('inventory.upgrade.error.NO_ELEMENT_SELECTED'),
      });
      return;
    }
  }
  enchantOpen.value = true;
}

async function confirmEnchant(): Promise<void> {
  if (submitting.value || !preview.value || !selectedElement.value) return;
  submitting.value = true;
  lastError.value = null;
  try {
    const r = await enchantEquipment(props.equipment.id, selectedElement.value);
    toast.push({
      type: 'success',
      text: t('inventory.upgrade.enchant.successToast', {
        element: t(`elementBadge.element.${r.afterElement}`),
        level: r.afterLevel,
      }),
    });
    enchantOpen.value = false;
    await load();
    emit('changed');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    toast.push({
      type: 'error',
      text: t(`inventory.upgrade.error.${code}`, t('inventory.upgrade.error.UNKNOWN')),
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    v-if="equipment.item.slot"
    class="border border-ink-300/30 rounded-lg p-3 space-y-3 bg-ink-700/30"
    data-testid="equipment-upgrade-panel"
  >
    <h4 class="text-sm font-bold tracking-wider text-ink-50">
      {{ t('inventory.upgrade.title') }}
    </h4>

    <!-- Loading -->
    <p
      v-if="loading"
      class="text-xs text-ink-300"
      data-testid="equipment-upgrade-loading"
    >
      {{ t('common.loading') }}
    </p>

    <!-- Error -->
    <p
      v-else-if="lastError && !preview"
      class="text-xs text-red-300"
      data-testid="equipment-upgrade-error"
    >
      {{ t(`inventory.upgrade.error.${lastError}`, t('inventory.upgrade.error.UNKNOWN')) }}
    </p>

    <template v-else-if="preview">
      <!-- Current substats -->
      <section class="space-y-1" data-testid="equipment-upgrade-substats">
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.upgrade.reforge.currentSubstats') }}
        </h5>
        <ul
          v-if="preview.reforge.currentSubstats.length > 0"
          class="text-xs text-ink-100 space-y-0.5"
        >
          <li
            v-for="s in preview.reforge.currentSubstats"
            :key="s.kind"
            data-testid="equipment-upgrade-substat-row"
          >
            {{ substatLabel(s) }}
          </li>
        </ul>
        <p v-else class="text-xs text-ink-300 italic">
          {{ t('inventory.upgrade.reforge.empty') }}
        </p>
      </section>

      <!-- Current enchant -->
      <section
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-upgrade-enchant"
      >
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.upgrade.enchant.currentLabel') }}
        </h5>
        <p v-if="preview.enchant.currentElement" class="text-xs text-ink-100">
          {{
            t('inventory.upgrade.enchant.currentText', {
              element: t(`elementBadge.element.${preview.enchant.currentElement}`),
              level: preview.enchant.currentLevel,
              max: preview.enchant.maxLevel,
            })
          }}
          —
          {{ bonusLabel(preview.enchant.currentBonus) }}
        </p>
        <p v-else class="text-xs text-ink-300 italic">
          {{ t('inventory.upgrade.enchant.empty') }}
        </p>
      </section>

      <!-- Reforge action -->
      <section class="space-y-1 border-t border-ink-300/20 pt-2">
        <p
          class="text-xs text-ink-300"
          data-testid="equipment-upgrade-reforge-cost"
        >
          {{
            t('inventory.upgrade.reforge.costLabel', {
              linhThach: preview.reforge.nextCost.linhThachCost,
              materialQty: preview.reforge.nextCost.materialQty,
              materialName: materialName(preview.reforge.nextCost.materialKey),
            })
          }}
        </p>
        <MButton
         
          :disabled="submitting"
          data-testid="equipment-upgrade-reforge-button"
          @click="onClickReforge"
        >
          {{ t('inventory.upgrade.reforge.button') }}
        </MButton>
      </section>

      <!-- Enchant action -->
      <section class="space-y-1 border-t border-ink-300/20 pt-2">
        <p v-if="enchantMaxed" class="text-xs text-amber-300">
          {{ t('inventory.upgrade.enchant.maxLabel', { max: preview.enchant.maxLevel }) }}
        </p>
        <p
          v-else-if="preview.enchant.nextCost"
          class="text-xs text-ink-300"
          data-testid="equipment-upgrade-enchant-cost"
        >
          {{
            t('inventory.upgrade.enchant.costLabel', {
              level: preview.enchant.currentLevel + 1,
              linhThach: preview.enchant.nextCost.linhThachCost,
              materialQty: preview.enchant.nextCost.materialQty,
              materialName: materialName(preview.enchant.nextCost.materialKey),
            })
          }}
        </p>
        <div class="flex gap-1 flex-wrap" data-testid="equipment-upgrade-element-row">
          <button
            v-for="el in preview.enchant.elements"
            :key="el.element"
            type="button"
            class="px-2 py-1 rounded text-xs border transition disabled:opacity-50 disabled:cursor-not-allowed"
            :class="
              selectedElement === el.element
                ? 'border-amber-400 bg-amber-700/40 text-amber-50'
                : 'border-ink-300/40 bg-ink-700/40 text-ink-100 hover:bg-ink-700/70'
            "
            :disabled="
              enchantMaxed ||
                submitting ||
                (lockedElement !== null && lockedElement !== el.element)
            "
            :data-testid="`equipment-upgrade-element-${el.element}`"
            @click="onSelectElement(el.element)"
          >
            {{ t(`elementBadge.element.${el.element}`) }}
            <span class="text-ink-300 ml-1">
              (+{{ el.effect.bonusPerLevel }} {{ t(`inventory.upgrade.substatKind.${el.effect.statKind}`) }})
            </span>
          </button>
        </div>
        <MButton
         
          :disabled="submitting || enchantMaxed || !selectedElement"
          data-testid="equipment-upgrade-enchant-button"
          @click="onClickEnchant"
        >
          {{ t('inventory.upgrade.enchant.button') }}
        </MButton>
      </section>
    </template>

    <ConfirmModal
      :open="reforgeOpen"
      :title="t('inventory.upgrade.reforge.confirmTitle')"
      :message="
        preview
          ? t('inventory.upgrade.reforge.confirmMessage', {
            linhThach: preview.reforge.nextCost.linhThachCost,
            materialQty: preview.reforge.nextCost.materialQty,
            materialName: materialName(preview.reforge.nextCost.materialKey),
          })
          : ''
      "
      :loading="submitting"
      test-id="equipment-upgrade-reforge-confirm"
      @confirm="confirmReforge"
      @cancel="reforgeOpen = false"
    />

    <ConfirmModal
      :open="enchantOpen"
      :title="t('inventory.upgrade.enchant.confirmTitle')"
      :message="
        preview && selectedElement && preview.enchant.nextCost
          ? t('inventory.upgrade.enchant.confirmMessage', {
            element: t(`elementBadge.element.${selectedElement}`),
            level: preview.enchant.currentLevel + 1,
            linhThach: preview.enchant.nextCost.linhThachCost,
            materialQty: preview.enchant.nextCost.materialQty,
            materialName: materialName(preview.enchant.nextCost.materialKey),
          })
          : ''
      "
      :loading="submitting"
      test-id="equipment-upgrade-enchant-confirm"
      @confirm="confirmEnchant"
      @cancel="enchantOpen = false"
    />
  </div>
</template>
