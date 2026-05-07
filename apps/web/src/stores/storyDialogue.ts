import { ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/storyDialogue';

/**
 * Phase 12 Story Dialogue Foundation — Pinia store.
 *
 * Holds the active story dialogue node for NPC branching conversations.
 * Separate from `useNpcStore` because story dialogue has its own lifecycle
 * (conditions, effects, flag/quest mutations) vs the simpler NPC quick-accept
 * dialogue.
 */
export const useStoryDialogueStore = defineStore('storyDialogue', () => {
  const activeNpcKey = ref<string | null>(null);
  const node = ref<api.StoryDialogueNodeView | null>(null);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref<string | null>(null);
  const lastResult = ref<api.StoryDialogueChoiceResult | null>(null);

  async function open(npcKey: string): Promise<void> {
    activeNpcKey.value = npcKey;
    error.value = null;
    lastResult.value = null;
    loading.value = true;
    try {
      node.value = await api.fetchStoryDialogue(npcKey);
    } catch (e) {
      node.value = null;
      error.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      loading.value = false;
    }
  }

  async function pickChoice(choiceKey: string): Promise<api.StoryDialogueChoiceResult | null> {
    if (!activeNpcKey.value || !node.value) return null;
    submitting.value = true;
    error.value = null;
    try {
      const result = await api.submitStoryDialogueChoice(
        activeNpcKey.value,
        node.value.nodeId,
        choiceKey,
      );
      lastResult.value = result;
      if (result.nextNode) {
        node.value = result.nextNode;
      } else {
        // No next node → close modal after caller shows toast.
        node.value = null;
      }
      return result;
    } catch (e) {
      error.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return null;
    } finally {
      submitting.value = false;
    }
  }

  function close(): void {
    activeNpcKey.value = null;
    node.value = null;
    loading.value = false;
    submitting.value = false;
    error.value = null;
    lastResult.value = null;
  }

  return {
    activeNpcKey,
    node,
    loading,
    submitting,
    error,
    lastResult,
    open,
    pickChoice,
    close,
  };
});
