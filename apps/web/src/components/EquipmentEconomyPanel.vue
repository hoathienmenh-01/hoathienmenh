<script setup lang="ts">
/**
 * Phase 23.4 — Equipment Upgrade Economy / Resource Sink panel.
 *
 * Panel hiển thị cost + thao tác kinh tế cho 1 equipment item:
 *   - Cost ghép phẩm (3× → 1 quality cao hơn).
 *   - Cost cường hóa kế tiếp (đọc từ `enhance`, không gọi mutation ở đây).
 *   - Cost khảm/tháo gem.
 *   - Cost tẩy luyện (reforge) — chỉ hiển thị, mutation qua
 *     `EquipmentUpgradePanel` (Phase 15.0.A).
 *   - Yield phân giải (material + linhThach + gem trả về).
 *   - Bảo hộ phù recommended flag (foundation Phase 25.1).
 *   - Nút "Ghép phẩm" + "Phân giải" với ConfirmModal.
 *
 * Server-authoritative — UI chỉ render preview; tất cả mutate qua API.
 * Caller phải re-fetch `listInventory()` sau khi success.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { itemByKey } from '@xuantoi/shared';
import {
  dismantleEquipment,
  getEquipmentEconomyPreview,
  mergeEquipment,
  type EquipmentEconomyPreview,
  type InventoryView,
} from '@/api/inventory';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import MButton from '@/components/ui/MButton.vue';

interface Props {
  equipment: InventoryView;
  /** Tất cả item trong inventory (để tìm 2 món còn lại cùng `itemKey` để ghép). */
  inventory: readonly InventoryView[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const preview = ref<EquipmentEconomyPreview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const lastError = ref<string | null>(null);
const mergeOpen = ref(false);
const dismantleOpen = ref(false);

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
    preview.value = await getEquipmentEconomyPreview(props.equipment.id);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    preview.value = null;
  } finally {
    loading.value = false;
  }
}

function materialName(materialKey: string): string {
  return itemByKey(materialKey)?.name ?? materialKey;
}

/**
 * Tìm 2 món còn lại cùng `itemKey`, không equipped, để compose 3 món
 * input cho merge. Trả null nếu không đủ — UI disable nút ghép.
 */
const mergeCandidates = computed<readonly InventoryView[] | null>(() => {
  const same = props.inventory.filter(
    (i) =>
      i.id !== props.equipment.id &&
      i.itemKey === props.equipment.itemKey &&
      !i.equippedSlot,
  );
  if (same.length < 2) return null;
  return same.slice(0, 2);
});

const canMerge = computed(
  () =>
    !!preview.value?.merge &&
    !!mergeCandidates.value &&
    !props.equipment.equippedSlot,
);

const canDismantle = computed(
  () => !props.equipment.equippedSlot && !!preview.value,
);

function onClickMerge(): void {
  if (submitting.value || !canMerge.value) return;
  mergeOpen.value = true;
}

async function confirmMerge(): Promise<void> {
  if (submitting.value || !canMerge.value) return;
  const cands = mergeCandidates.value;
  if (!cands) return;
  submitting.value = true;
  lastError.value = null;
  try {
    const r = await mergeEquipment([
      props.equipment.id,
      cands[0].id,
      cands[1].id,
    ]);
    toast.push({
      type: 'success',
      text: t('inventory.economy.merge.successToast', {
        item: materialName(r.outputItemKey),
        quality: t(`quality.${r.outputQuality}`, r.outputQuality),
      }),
    });
    mergeOpen.value = false;
    emit('changed');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    toast.push({
      type: 'error',
      text: t(
        `inventory.economy.error.${code}`,
        t('inventory.economy.error.UNKNOWN'),
      ),
    });
  } finally {
    submitting.value = false;
  }
}

function onClickDismantle(): void {
  if (submitting.value || !canDismantle.value) return;
  dismantleOpen.value = true;
}

async function confirmDismantle(): Promise<void> {
  if (submitting.value || !canDismantle.value) return;
  submitting.value = true;
  lastError.value = null;
  try {
    const r = await dismantleEquipment(props.equipment.id);
    toast.push({
      type: 'success',
      text: t('inventory.economy.dismantle.successToast', {
        linhThach: r.yield.linhThachYield,
        materials: r.yield.materials.length,
      }),
    });
    dismantleOpen.value = false;
    emit('changed');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    lastError.value = code;
    toast.push({
      type: 'error',
      text: t(
        `inventory.economy.error.${code}`,
        t('inventory.economy.error.UNKNOWN'),
      ),
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
    data-testid="equipment-economy-panel"
  >
    <h4 class="text-sm font-bold tracking-wider text-ink-50">
      {{ t('inventory.economy.title') }}
    </h4>

    <p
      v-if="loading"
      class="text-xs text-ink-300"
      data-testid="equipment-economy-loading"
    >
      {{ t('common.loading') }}
    </p>

    <p
      v-else-if="lastError && !preview"
      class="text-xs text-red-300"
      data-testid="equipment-economy-error"
    >
      {{
        t(
          `inventory.economy.error.${lastError}`,
          t('inventory.economy.error.UNKNOWN'),
        )
      }}
    </p>

    <template v-else-if="preview">
      <!-- Tier note + merge tier-lock warning. -->
      <p class="text-[11px] text-ink-300 italic">
        {{
          t('inventory.economy.tierNote', {
            tier: preview.equipmentTier,
            quality: t(`quality.${preview.quality}`, preview.quality),
          })
        }}
      </p>

      <!-- Enhance cost preview. -->
      <section class="space-y-1" data-testid="equipment-economy-enhance">
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.economy.enhance.label') }}
        </h5>
        <p v-if="preview.enhance" class="text-xs text-ink-100">
          {{
            t('inventory.economy.enhance.costLabel', {
              level: preview.enhance.nextLevel,
              linhThach: preview.enhance.cost.linhThachCost,
              materialQty: preview.enhance.cost.materialQty,
              materialName: materialName(preview.enhance.cost.materialKey),
            })
          }}
        </p>
        <p v-else class="text-xs text-ink-300 italic">
          {{ t('inventory.economy.enhance.maxed') }}
        </p>
      </section>

      <!-- Merge cost + action. -->
      <section
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-economy-merge"
      >
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.economy.merge.label') }}
        </h5>
        <p v-if="preview.merge" class="text-xs text-ink-100">
          {{
            t('inventory.economy.merge.costLabel', {
              output: materialName(preview.merge.outputItemKey),
              outputQuality: t(
                `quality.${preview.merge.outputQuality}`,
                preview.merge.outputQuality,
              ),
              linhThach: preview.merge.cost.linhThachCost,
              materialQty: preview.merge.cost.materialQty,
              materialName: materialName(preview.merge.cost.materialKey),
            })
          }}
        </p>
        <p v-else class="text-xs text-ink-300 italic">
          {{ t('inventory.economy.merge.maxed') }}
        </p>
        <p
          v-if="preview.merge && !mergeCandidates"
          class="text-[11px] text-amber-300"
          data-testid="equipment-economy-merge-insufficient"
        >
          {{ t('inventory.economy.merge.insufficientStack') }}
        </p>
        <MButton
          v-if="preview.merge"
          :disabled="!canMerge || submitting"
          data-testid="equipment-economy-merge-btn"
          @click="onClickMerge"
        >
          {{ t('inventory.economy.merge.button') }}
        </MButton>
      </section>

      <!-- Socket / unsocket cost preview. -->
      <section
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-economy-socket"
      >
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.economy.socket.label') }}
        </h5>
        <p class="text-xs text-ink-100">
          {{
            t('inventory.economy.socket.costLabel', {
              linhThach: preview.socket.linhThachCost,
              materialQty: preview.socket.materialQty,
              materialName: materialName(preview.socket.materialKey),
            })
          }}
        </p>
        <p v-if="preview.unsocket" class="text-xs text-ink-100">
          {{
            t('inventory.economy.socket.unsocketCostLabel', {
              linhThach: preview.unsocket.linhThachCost,
              materialQty: preview.unsocket.materialQty,
              materialName: materialName(preview.unsocket.materialKey),
            })
          }}
        </p>
      </section>

      <!-- Reforge cost preview. -->
      <section
        v-if="preview.reforge"
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-economy-reforge"
      >
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.economy.reforge.label') }}
        </h5>
        <p class="text-xs text-ink-100">
          {{
            t('inventory.economy.reforge.costLabel', {
              linhThach: preview.reforge.linhThachCost,
              materialQty: preview.reforge.materialQty,
              materialName: materialName(preview.reforge.materialKey),
            })
          }}
        </p>
      </section>

      <!-- Protection charm hint (Phase 25.1 hook). -->
      <section
        v-if="preview.protection.recommended"
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-economy-protection"
      >
        <h5 class="text-xs font-bold text-amber-200">
          {{ t('inventory.economy.protection.label') }}
        </h5>
        <p class="text-xs text-amber-300">
          {{
            t('inventory.economy.protection.recommend', {
              item: materialName(preview.protection.requiredItemKey),
              threshold: preview.protection.minLevelThreshold,
            })
          }}
        </p>
      </section>

      <!-- Dismantle yield + action. -->
      <section
        class="space-y-1 border-t border-ink-300/20 pt-2"
        data-testid="equipment-economy-dismantle"
      >
        <h5 class="text-xs font-bold text-ink-200">
          {{ t('inventory.economy.dismantle.label') }}
        </h5>
        <p class="text-xs text-ink-100">
          {{
            t('inventory.economy.dismantle.yieldLabel', {
              linhThach: preview.dismantle.linhThachYield,
              materialCount: preview.dismantle.materials.length,
            })
          }}
        </p>
        <ul
          v-if="preview.dismantle.materials.length > 0"
          class="text-[11px] text-ink-300 list-disc list-inside"
        >
          <li v-for="m in preview.dismantle.materials" :key="m.itemKey">
            +{{ m.qty }} {{ materialName(m.itemKey) }}
          </li>
        </ul>
        <MButton
          :disabled="!canDismantle || submitting"
          data-testid="equipment-economy-dismantle-btn"
          @click="onClickDismantle"
        >
          {{ t('inventory.economy.dismantle.button') }}
        </MButton>
      </section>
    </template>

    <!-- Confirm modals. -->
    <ConfirmModal
      v-if="mergeOpen && preview?.merge"
      :open="mergeOpen"
      :title="t('inventory.economy.merge.confirmTitle')"
      :message="
        t('inventory.economy.merge.confirmBody', {
          output: materialName(preview.merge.outputItemKey),
        })
      "
      :confirm-text="t('inventory.economy.merge.confirm')"
      :loading="submitting"
      test-id="equipment-economy-merge-confirm"
      @confirm="confirmMerge"
      @cancel="mergeOpen = false"
    />
    <ConfirmModal
      v-if="dismantleOpen"
      :open="dismantleOpen"
      :title="t('inventory.economy.dismantle.confirmTitle')"
      :message="t('inventory.economy.dismantle.confirmBody')"
      :confirm-text="t('inventory.economy.dismantle.confirm')"
      danger
      :loading="submitting"
      test-id="equipment-economy-dismantle-confirm"
      @confirm="confirmDismantle"
      @cancel="dismantleOpen = false"
    />
  </div>
</template>
