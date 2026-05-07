<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { itemByKey } from '@xuantoi/shared';
import type { StoryDungeonClaimResult } from '@/api/storyDungeon';

/**
 * Phase 12.8.C — Story Dungeon Reward Result modal.
 *
 * Hiển thị reward grant sau claim thành công:
 *   - linhThach / tienNgoc / exp dạng `+{n}` chips.
 *   - items[] lookup `itemByKey` để render tên người đọc, fallback raw key.
 *   - Esc / backdrop / Close button đóng modal.
 *
 * Server-authoritative: reward đã grant qua CurrencyService.applyTx +
 * InventoryService.grantTx khi claim. Modal chỉ render snapshot kết quả.
 */

const props = defineProps<{
  result: StoryDungeonClaimResult | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();

const open = computed(() => props.result !== null);

function itemName(itemKey: string): string {
  return itemByKey(itemKey)?.name ?? itemKey;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && result"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4"
      data-testid="story-dungeon-reward-modal"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div
        class="bg-ink-800 border border-emerald-400/40 rounded p-5 max-w-md w-full space-y-3"
      >
        <h2 class="text-lg font-bold text-emerald-100">
          {{ t('storyDungeon.reward.modalTitle') }}
        </h2>
        <p class="text-sm text-ink-200">
          {{ t('storyDungeon.reward.modalSubtitle', { templateKey: result.templateKey }) }}
        </p>
        <ul class="text-sm space-y-1">
          <li
            v-if="result.granted.linhThach > 0"
            data-testid="story-dungeon-reward-linh-thach"
          >
            {{ t('storyDungeon.reward.linhThach', { n: result.granted.linhThach }) }}
          </li>
          <li
            v-if="result.granted.tienNgoc > 0"
            data-testid="story-dungeon-reward-tien-ngoc"
          >
            {{ t('storyDungeon.reward.tienNgoc', { n: result.granted.tienNgoc }) }}
          </li>
          <li
            v-if="result.granted.exp > 0"
            data-testid="story-dungeon-reward-exp"
          >
            {{ t('storyDungeon.reward.exp', { n: result.granted.exp }) }}
          </li>
          <li
            v-for="(it, idx) in result.granted.items"
            :key="`${it.itemKey}-${idx}`"
            :data-testid="`story-dungeon-reward-item-${idx}`"
          >
            {{ t('storyDungeon.reward.item', { name: itemName(it.itemKey), qty: it.qty }) }}
          </li>
        </ul>
        <div class="flex justify-end">
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm"
            data-testid="story-dungeon-reward-close"
            @click="emit('close')"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
