<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStoryDialogueStore } from '@/stores/storyDialogue';
import { useToastStore } from '@/stores/toast';

/**
 * Phase 12 Story Dialogue Foundation — branching dialogue modal.
 *
 * Renders the current story dialogue node (server-authoritative: conditions,
 * flag-based branching, quest step advancement). Choice click dispatches
 * `pickChoice` → server applies effects → store auto-navigates to next node
 * or closes modal.
 *
 * Mirror overlay pattern from `NpcDialogueModal.vue` (Teleport, Esc close,
 * backdrop click).
 */

interface Props {
  npcKey: string | null;
  npcName: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'effectsApplied'): void;
}>();

const store = useStoryDialogueStore();
const toast = useToastStore();
const { t, locale } = useI18n();

/**
 * Modal visibility — controlled BY PARENT prop (not by store.node state) so that
 * the Teleport child unmounts only when parent flips `npcKey` back to null. Mirror
 * `NpcDialogueModal.vue`. Avoids re-render race where Esc triggers store.close()
 * → node becomes null → v-if flips inside the same tick → Teleport patch crashes.
 */
const open = computed(() => props.npcKey !== null);
const node = computed(() => store.node);
const loading = computed(() => store.loading);
const submitting = computed(() => store.submitting);
const errorCode = computed(() => store.error);

function choiceLabel(c: { label: string; labelEn?: string }): string {
  if (locale.value === 'en' && c.labelEn) return c.labelEn;
  return c.label;
}

function nodeText(n: { text: string; textEn?: string }): string {
  if (locale.value === 'en' && n.textEn) return n.textEn;
  return n.text;
}

async function handleChoice(choiceKey: string): Promise<void> {
  if (submitting.value) return;
  const result = await store.pickChoice(choiceKey);
  if (!result) return;
  // Show reward toast if any.
  const { granted } = result;
  const parts: string[] = [];
  if (granted.linhThach > 0) parts.push(`+${granted.linhThach} ${t('storyDialogue.linhThach')}`);
  if (granted.tienNgoc > 0) parts.push(`+${granted.tienNgoc} ${t('storyDialogue.tienNgoc')}`);
  if (granted.exp > 0) parts.push(`+${granted.exp} EXP`);
  if (parts.length > 0) {
    toast.push({ type: 'success', text: parts.join(', ') });
  }
  emit('effectsApplied');
  // If no next node, close modal after brief delay (let toast show).
  if (!result.nextNode) {
    setTimeout(() => {
      doClose();
    }, 300);
  }
}

function doClose(): void {
  // Parent owns store cleanup through `@close` handler — keep modal teleport
  // unmount sequence atomic.
  emit('close');
}

function onKeydown(ev: KeyboardEvent): void {
  if (!open.value) return;
  if (ev.key === 'Escape' && !submitting.value) {
    ev.preventDefault();
    doClose();
  }
}

watch(
  open,
  (val) => {
    if (typeof window === 'undefined') return;
    if (val) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open || loading"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="story-dialogue-modal"
      @click.self="!submitting && doClose()"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="bg-ink-700 border border-ink-300/30 rounded-lg shadow-2xl max-w-2xl w-[92vw] p-5 space-y-4"
      >
        <header class="flex items-baseline justify-between gap-3">
          <div>
            <h3 class="text-lg tracking-wider text-amber-100 font-bold">
              {{ npcName }}
            </h3>
            <p class="text-xs text-ink-300 italic">{{ t('storyDialogue.title') }}</p>
          </div>
          <button
            type="button"
            class="text-ink-300 hover:text-ink-50 transition text-xl leading-none px-2"
            data-testid="story-dialogue-close"
            :disabled="submitting"
            :aria-label="t('common.close')"
            @click="doClose()"
          >
            ×
          </button>
        </header>

        <div
          v-if="loading"
          class="text-ink-300 text-sm py-6 text-center"
          data-testid="story-dialogue-loading"
        >
          {{ t('common.loadingData') }}
        </div>

        <div
          v-else-if="errorCode"
          class="text-rose-300 text-sm py-6 text-center"
          data-testid="story-dialogue-error"
        >
          {{ t(`storyDialogue.errors.${errorCode}`, t('storyDialogue.errors.UNKNOWN')) }}
        </div>

        <div v-else-if="node" class="space-y-4" data-testid="story-dialogue-body">
          <p
            class="text-ink-100 leading-relaxed bg-ink-800/40 border border-ink-300/15 rounded p-3"
            data-testid="story-dialogue-text"
          >
            {{ nodeText(node) }}
          </p>
          <ul class="space-y-2" data-testid="story-dialogue-choices">
            <li v-for="c in node.choices" :key="c.key">
              <button
                type="button"
                class="w-full text-left px-3 py-2 rounded border transition flex items-center justify-between gap-3"
                :class="
                  c.available && !c.alreadyApplied
                    ? 'border-ink-300/30 bg-ink-700/40 text-ink-50 hover:bg-ink-700/70'
                    : 'border-ink-300/15 bg-ink-800/30 text-ink-400 cursor-not-allowed opacity-60'
                "
                :data-testid="`story-dialogue-choice-${c.key}`"
                :disabled="!c.available || c.alreadyApplied || submitting"
                @click="handleChoice(c.key)"
              >
                <span>{{ choiceLabel(c) }}</span>
                <span
                  v-if="submitting"
                  class="text-xs text-ink-300"
                >
                  {{ t('common.loading') }}
                </span>
                <span
                  v-else-if="c.alreadyApplied"
                  class="text-xs text-ink-400 italic"
                >
                  {{ t('storyDialogue.alreadyChosen') }}
                </span>
                <span
                  v-else-if="!c.available && c.unavailableReason"
                  class="text-xs text-ink-400 italic"
                >
                  {{ t('storyDialogue.locked') }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div
          v-else
          class="text-ink-300 text-sm py-6 text-center"
          data-testid="story-dialogue-empty"
        >
          {{ t('storyDialogue.empty') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
