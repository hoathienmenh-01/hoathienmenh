<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { STORY_DIALOGUES, NPCS } from '@xuantoi/shared';

/**
 * Phase 12.8.C — light Story Dungeon Dialogue Panel.
 *
 * Hiển thị 1 NPC line text từ catalog `STORY_DIALOGUES` (read-only —
 * KHÔNG branching như `StoryDialogueModal.vue` Phase 12 Foundation).
 * Đặt panel modal nhẹ trước/sau khi vào dungeon, không gọi server.
 *
 * Phase 12.8.B `entryDialogueKey` / `clearDialogueKey` reference
 * `STORY_DIALOGUES[].id`. Khi backend mở "advanced dialogue branch" sau
 * này (next roadmap), panel này có thể swap qua modal đầy đủ.
 */

const props = defineProps<{
  /** Dialogue node id từ catalog `STORY_DIALOGUES`. `null` = đóng panel. */
  nodeId: string | null;
  /** Optional override NPC name khi catalog node thiếu npcKey. */
  fallbackNpcName?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t, locale } = useI18n();

const open = computed(() => props.nodeId !== null);

const node = computed(() => {
  if (!props.nodeId) return null;
  return STORY_DIALOGUES.find((d) => d.id === props.nodeId) ?? null;
});

const npcName = computed(() => {
  const id = node.value?.npcKey;
  if (!id) return props.fallbackNpcName ?? null;
  return NPCS.find((n) => n.key === id)?.name ?? id;
});

const text = computed(() => {
  const n = node.value;
  if (!n) return '';
  if (locale.value === 'en' && n.textEn) return n.textEn;
  return n.text;
});

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
      v-if="open"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4"
      data-testid="story-dungeon-dialogue-panel"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div
        class="bg-ink-800 border border-amber-400/40 rounded p-5 max-w-md w-full space-y-3"
      >
        <header class="flex items-baseline justify-between gap-2">
          <h2
            class="text-base font-bold text-amber-100"
            data-testid="story-dungeon-dialogue-npc"
          >
            {{ npcName ?? t('storyDungeon.dialogue.narratorFallback') }}
          </h2>
          <button
            type="button"
            class="text-ink-300 hover:text-ink-100 text-sm"
            data-testid="story-dungeon-dialogue-close"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <p
          v-if="node"
          class="text-sm text-ink-200 leading-relaxed whitespace-pre-line"
          data-testid="story-dungeon-dialogue-text"
        >
          {{ text }}
        </p>
        <p
          v-else
          class="text-sm text-ink-300 italic"
          data-testid="story-dungeon-dialogue-empty"
        >
          {{ t('storyDungeon.dialogue.empty') }}
        </p>
        <div class="flex justify-end">
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-amber-400/50 bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 transition text-sm"
            data-testid="story-dungeon-dialogue-confirm"
            @click="emit('close')"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
