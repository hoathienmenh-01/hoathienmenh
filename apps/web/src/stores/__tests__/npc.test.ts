import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const fetchNpcsMock = vi.fn();
const fetchNpcDialogueMock = vi.fn();

vi.mock('@/api/npc', () => ({
  fetchNpcs: (...a: unknown[]) => fetchNpcsMock(...a),
  fetchNpcDialogue: (...a: unknown[]) => fetchNpcDialogueMock(...a),
}));

import { useNpcStore } from '@/stores/npc';
import type { NpcDialogueView, NpcView } from '@/api/npc';

const STUB_DIALOGUE: NpcDialogueView = {
  dialogueId: 'dlg_x',
  speakerNpcKey: 'npc_x',
  text: 'hi',
  choices: [],
};

const STUB_DIALOGUE_REFRESH: NpcDialogueView = {
  dialogueId: 'dlg_x_refresh',
  speakerNpcKey: 'npc_x',
  text: 'refresh',
  choices: [],
};

const STUB_NPC: NpcView = {
  key: 'npc_x',
  name: 'X',
  faction: 'wandering',
  realmGateOrder: 0,
  description: '',
  loreSummary: '',
  questCount: 0,
  dialogue: STUB_DIALOGUE,
};

beforeEach(() => {
  setActivePinia(createPinia());
  fetchNpcsMock.mockReset();
  fetchNpcDialogueMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNpcStore.load', () => {
  it('happy path → npcs set + loaded=true + lastError=null', async () => {
    fetchNpcsMock.mockResolvedValue([STUB_NPC]);
    const s = useNpcStore();
    await s.load();
    expect(s.npcs).toEqual([STUB_NPC]);
    expect(s.loaded).toBe(true);
    expect(s.lastError).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.visibleCount).toBe(1);
  });

  it('error path (envelope code) → lastError = code, loaded=false', async () => {
    fetchNpcsMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const s = useNpcStore();
    await s.load();
    expect(s.lastError).toBe('NO_CHARACTER');
    expect(s.loaded).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.npcs).toEqual([]);
  });

  it('unknown error → lastError fallback "UNKNOWN_ERROR"', async () => {
    fetchNpcsMock.mockRejectedValue(new Error('weird'));
    const s = useNpcStore();
    await s.load();
    expect(s.lastError).toBe('UNKNOWN_ERROR');
  });
});

describe('useNpcStore.openDialogue / refreshActiveDialogue', () => {
  it('cached dialogue trong list → KHÔNG fetch endpoint riêng', async () => {
    fetchNpcsMock.mockResolvedValue([STUB_NPC]);
    const s = useNpcStore();
    await s.load();
    await s.openDialogue('npc_x');
    expect(fetchNpcDialogueMock).not.toHaveBeenCalled();
    expect(s.activeDialogue).toEqual(STUB_DIALOGUE);
    expect(s.activeNpcKey).toBe('npc_x');
  });

  it('force=true → bỏ cache, fetch endpoint riêng', async () => {
    fetchNpcsMock.mockResolvedValue([STUB_NPC]);
    fetchNpcDialogueMock.mockResolvedValue(STUB_DIALOGUE_REFRESH);
    const s = useNpcStore();
    await s.load();
    await s.openDialogue('npc_x', { force: true });
    expect(fetchNpcDialogueMock).toHaveBeenCalledWith('npc_x');
    expect(s.activeDialogue).toEqual(STUB_DIALOGUE_REFRESH);
  });

  it('refreshActiveDialogue → tái dùng activeNpcKey, force fetch', async () => {
    fetchNpcsMock.mockResolvedValue([STUB_NPC]);
    fetchNpcDialogueMock.mockResolvedValue(STUB_DIALOGUE_REFRESH);
    const s = useNpcStore();
    await s.load();
    await s.openDialogue('npc_x'); // cached
    await s.refreshActiveDialogue();
    expect(fetchNpcDialogueMock).toHaveBeenCalledTimes(1);
    expect(s.activeDialogue).toEqual(STUB_DIALOGUE_REFRESH);
  });

  it('không có cache + endpoint throw → activeDialogue=null + dialogueError set', async () => {
    fetchNpcsMock.mockResolvedValue([{ ...STUB_NPC, dialogue: null }]);
    fetchNpcDialogueMock.mockRejectedValue({ code: 'NPC_LOCKED_REALM' });
    const s = useNpcStore();
    await s.load();
    await s.openDialogue('npc_x');
    expect(s.activeDialogue).toBeNull();
    expect(s.dialogueError).toBe('NPC_LOCKED_REALM');
  });

  it('closeDialogue + reset → clear state', async () => {
    fetchNpcsMock.mockResolvedValue([STUB_NPC]);
    const s = useNpcStore();
    await s.load();
    await s.openDialogue('npc_x');
    s.closeDialogue();
    expect(s.activeDialogue).toBeNull();
    expect(s.activeNpcKey).toBeNull();
    s.reset();
    expect(s.npcs).toEqual([]);
    expect(s.loaded).toBe(false);
  });

  it('refreshActiveDialogue khi không có active → no-op', async () => {
    const s = useNpcStore();
    await s.refreshActiveDialogue();
    expect(fetchNpcDialogueMock).not.toHaveBeenCalled();
  });
});
