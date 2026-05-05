<script setup lang="ts">
import { computed, onBeforeUnmount, watch, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNpcStore } from '@/stores/npc';
import { useToastStore } from '@/stores/toast';
import { acceptQuest } from '@/api/quest';
import type { NpcDialogueChoiceView } from '@/api/npc';

/**
 * Phase 12 Story PR-4 — NPC dialogue modal.
 *
 * Render dialogue line đang được áp dụng (server-side filter qua realm + quest
 * status). Choice với `acceptQuestKey` gọi `POST /quests/accept` rồi refresh
 * dialogue (vì `quest_status` condition có thể đã đổi). Choice với
 * `closeDialogue` đóng modal, choice với `nextDialogueId` chưa được catalog
 * dùng — reserved cho dialogue chain ở PR sau.
 *
 * Modal thuộc dạng overlay teleport-to-body (mirror `ConfirmModal.vue`):
 * Esc / click backdrop / nút Đóng đều close. Disable đóng khi đang submit
 * choice tránh user mất state.
 */

interface Props {
  /** Phải truyền npcKey + name từ caller — store cache `dialogue` qua npcKey. */
  npcKey: string | null;
  npcName: string;
  /** Tóm tắt lore + faction để render header. */
  description: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'questAccepted', questKey: string): void;
}>();

const npcStore = useNpcStore();
const toast = useToastStore();
const { t } = useI18n();

const submittingChoice = ref<string | null>(null);

const open = computed(() => props.npcKey !== null);
const dialogue = computed(() => npcStore.activeDialogue);
const loading = computed(() => npcStore.dialogueLoading);
const errorCode = computed(() => npcStore.dialogueError);

function choiceDisabled(c: NpcDialogueChoiceView): boolean {
  if (submittingChoice.value !== null) return true;
  // Đã accept rồi (ACCEPTED / COMPLETED / CLAIMED) → khoá accept choice.
  if (c.acceptQuestKey && c.acceptQuestStatus !== null) {
    return (
      c.acceptQuestStatus === 'ACCEPTED' ||
      c.acceptQuestStatus === 'COMPLETED' ||
      c.acceptQuestStatus === 'CLAIMED' ||
      c.acceptQuestStatus === 'LOCKED'
    );
  }
  return false;
}

function choiceHint(c: NpcDialogueChoiceView): string | null {
  if (!c.acceptQuestKey || c.acceptQuestStatus === null) return null;
  if (c.acceptQuestStatus === 'NOT_STARTED' || c.acceptQuestStatus === 'AVAILABLE') {
    return null;
  }
  return t(`npc.dialogue.questStatus.${c.acceptQuestStatus}`);
}

async function handleChoice(c: NpcDialogueChoiceView): Promise<void> {
  if (choiceDisabled(c)) return;
  if (c.acceptQuestKey) {
    submittingChoice.value = c.key;
    try {
      await acceptQuest(c.acceptQuestKey);
      toast.push({
        type: 'success',
        text: t('npc.dialogue.acceptOk', { quest: c.acceptQuestKey }),
      });
      emit('questAccepted', c.acceptQuestKey);
      // Refresh list + active dialogue để branch + choice status update.
      await Promise.all([
        npcStore.load(),
        npcStore.refreshActiveDialogue(),
      ]);
    } catch (err) {
      const code =
        (err as { code?: string }).code ??
        (err as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      toast.push({
        type: 'error',
        text: t(`npc.dialogue.errors.${code}`, t('npc.dialogue.errors.UNKNOWN')),
      });
    } finally {
      submittingChoice.value = null;
    }
    return;
  }
  if (c.nextDialogueId) {
    // Catalog hiện tại không dùng — placeholder cho PR sau (dialogue chain).
    return;
  }
  // closeDialogue=true (hoặc default) → đóng modal.
  emit('close');
}

function onKeydown(ev: KeyboardEvent): void {
  if (!open.value) return;
  if (ev.key === 'Escape' && submittingChoice.value === null) {
    ev.preventDefault();
    emit('close');
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
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="npc-dialogue-modal"
      @click.self="submittingChoice === null && emit('close')"
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
            <p class="text-xs text-ink-300 italic">{{ description }}</p>
          </div>
          <button
            type="button"
            class="text-ink-300 hover:text-ink-50 transition text-xl leading-none px-2"
            data-testid="npc-dialogue-close"
            :disabled="submittingChoice !== null"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div
          v-if="loading"
          class="text-ink-300 text-sm py-6 text-center"
          data-testid="npc-dialogue-loading"
        >
          {{ t('common.loadingData') }}
        </div>

        <div
          v-else-if="errorCode"
          class="text-rose-300 text-sm py-6 text-center"
          data-testid="npc-dialogue-error"
        >
          {{ t(`npc.dialogue.errors.${errorCode}`, t('npc.dialogue.errors.UNKNOWN')) }}
        </div>

        <div v-else-if="dialogue" class="space-y-4" data-testid="npc-dialogue-body">
          <p
            class="text-ink-100 leading-relaxed bg-ink-800/40 border border-ink-300/15 rounded p-3"
            data-testid="npc-dialogue-text"
          >
            {{ dialogue.text }}
          </p>
          <ul class="space-y-2" data-testid="npc-dialogue-choices">
            <li v-for="c in dialogue.choices" :key="c.key">
              <button
                type="button"
                class="w-full text-left px-3 py-2 rounded border border-ink-300/30 bg-ink-700/40 text-ink-50 hover:bg-ink-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-between gap-3"
                :data-testid="`npc-dialogue-choice-${c.key}`"
                :disabled="choiceDisabled(c)"
                @click="handleChoice(c)"
              >
                <span>{{ c.label }}</span>
                <span
                  v-if="submittingChoice === c.key"
                  class="text-xs text-ink-300"
                >
                  {{ t('common.loading') }}
                </span>
                <span
                  v-else-if="choiceHint(c)"
                  class="text-xs text-ink-300 italic"
                >
                  {{ choiceHint(c) }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div
          v-else
          class="text-ink-300 text-sm py-6 text-center"
          data-testid="npc-dialogue-empty"
        >
          {{ t('npc.dialogue.empty') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
