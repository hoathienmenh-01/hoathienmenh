import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/npc';

/**
 * Phase 12 Story PR-4 — NPC dialogue store.
 *
 * State mirror server `GET /npcs/me`:
 *   - `npcs`: full list NPC visible.
 *   - `loaded` / `loading` / `lastError`: lifecycle flags cho loading/empty/error UI.
 *   - `activeNpcKey`: NPC đang mở dialogue modal (null = đóng).
 *   - `activeDialogue`: dialogue line đang hiển thị (null = chưa load / đã đóng).
 *   - `dialogueLoading` / `dialogueError`: state riêng cho refetch sau action.
 *
 * Tất cả filter / dialogue branch / quest status chạy server-side. Store chỉ
 * hold state + dispatch reload khi quest accept đổi branch.
 */
export const useNpcStore = defineStore('npc', () => {
  const npcs = ref<api.NpcView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  const activeNpcKey = ref<string | null>(null);
  const activeDialogue = ref<api.NpcDialogueView | null>(null);
  const dialogueLoading = ref(false);
  const dialogueError = ref<string | null>(null);

  const visibleCount = computed(() => npcs.value.length);

  function findNpc(key: string): api.NpcView | undefined {
    return npcs.value.find((n) => n.key === key);
  }

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      npcs.value = await api.fetchNpcs();
      loaded.value = true;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN_ERROR';
      lastError.value = code;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Mở modal dialogue cho NPC. Ưu tiên dùng `dialogue` đã cache trong list (mới
   * fetch); refetch endpoint riêng nếu chưa có hoặc đã stale (param force=true).
   */
  async function openDialogue(npcKey: string, opts?: { force?: boolean }): Promise<void> {
    activeNpcKey.value = npcKey;
    dialogueError.value = null;
    const cached = findNpc(npcKey)?.dialogue ?? null;
    if (cached && !opts?.force) {
      activeDialogue.value = cached;
      return;
    }
    dialogueLoading.value = true;
    try {
      activeDialogue.value = await api.fetchNpcDialogue(npcKey);
    } catch (e) {
      activeDialogue.value = null;
      dialogueError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN_ERROR';
    } finally {
      dialogueLoading.value = false;
    }
  }

  function closeDialogue(): void {
    activeNpcKey.value = null;
    activeDialogue.value = null;
    dialogueError.value = null;
    dialogueLoading.value = false;
  }

  /**
   * Refresh dialogue branch sau khi accept quest (vì quest_status condition có
   * thể đã đổi). Caller nên gọi sau `quest accept` thành công.
   */
  async function refreshActiveDialogue(): Promise<void> {
    if (!activeNpcKey.value) return;
    await openDialogue(activeNpcKey.value, { force: true });
  }

  function reset(): void {
    npcs.value = [];
    loaded.value = false;
    loading.value = false;
    lastError.value = null;
    closeDialogue();
  }

  return {
    npcs,
    loaded,
    loading,
    lastError,
    activeNpcKey,
    activeDialogue,
    dialogueLoading,
    dialogueError,
    visibleCount,
    findNpc,
    load,
    openDialogue,
    closeDialogue,
    refreshActiveDialogue,
    reset,
  };
});
