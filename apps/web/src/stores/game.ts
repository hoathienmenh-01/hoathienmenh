import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { realmByKey, fullRealmName, type CharacterStatePayload } from '@xuantoi/shared';
import { apiClient } from '@/api/client';
import { fetchMailUnreadCount } from '@/api/mail';
import { connect, on } from '@/ws/client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface MailNewEvent {
  mailId?: string;
  subject: string;
  senderName: string;
  hasReward: boolean;
}

export const useGameStore = defineStore('game', () => {
  const character = ref<CharacterStatePayload | null>(null);
  const lastTickAt = ref<number | null>(null);
  const lastTickGain = ref<string | null>(null);
  const wsConnected = ref(false);
  const unreadMail = ref(0);
  const lastMailEvent = ref<MailNewEvent | null>(null);
  let socketBound = false;

  const realmFullName = computed(() => {
    if (!character.value) return '';
    const r = realmByKey(character.value.realmKey);
    if (!r) return character.value.realmKey;
    return fullRealmName(r, character.value.realmStage);
  });

  const expProgress = computed(() => {
    if (!character.value) return 0;
    const exp = BigInt(character.value.exp);
    const next = BigInt(character.value.expNext);
    if (next === 0n) return 1;
    const num = Number((exp * 10000n) / next);
    return Math.min(Math.max(num / 10000, 0), 1);
  });

  async function fetchState(): Promise<void> {
    const { data } = await apiClient.get<Envelope<{ character: CharacterStatePayload }>>(
      '/character/state',
    );
    if (data.ok && data.data) character.value = data.data.character;
  }

  /**
   * Hydrate `unreadMail` từ BE. Gọi sau login hoặc khi vào view có badge.
   * Silent error → không phá UI flow nếu mail service tạm chết.
   */
  async function hydrateUnreadMail(): Promise<void> {
    try {
      unreadMail.value = await fetchMailUnreadCount();
    } catch {
      // silent
    }
  }

  async function setCultivating(on: boolean): Promise<void> {
    const { data } = await apiClient.post<Envelope<{ character: CharacterStatePayload }>>(
      '/character/cultivate',
      { cultivating: on },
    );
    if (data.ok && data.data) character.value = data.data.character;
  }

  async function breakthrough(): Promise<void> {
    const { data } = await apiClient.post<Envelope<{ character: CharacterStatePayload }>>(
      '/character/breakthrough',
      {},
    );
    if (data.ok && data.data) character.value = data.data.character;
  }

  function bindSocket(): void {
    if (socketBound) return;
    socketBound = true;
    const s = connect();
    s.on('connect', () => (wsConnected.value = true));
    s.on('disconnect', () => (wsConnected.value = false));

    on<CharacterStatePayload>('state:update', (frame) => {
      character.value = frame.payload;
    });
    on<{
      characterId: string;
      expGained: string;
      exp: string;
      expNext: string;
      realmKey: string;
      realmStage: number;
      brokeThrough: boolean;
    }>('cultivate:tick', (frame) => {
      const p = frame.payload;
      lastTickAt.value = frame.ts;
      lastTickGain.value = p.expGained;
      if (character.value && character.value.id === p.characterId) {
        character.value = {
          ...character.value,
          exp: p.exp,
          expNext: p.expNext,
          realmKey: p.realmKey,
          realmStage: p.realmStage,
        };
      }
    });

    on<MailNewEvent>('mail:new', (frame) => {
      unreadMail.value += 1;
      lastMailEvent.value = frame.payload;
    });
  }

  function clearMailBadge(): void {
    unreadMail.value = 0;
  }

  return {
    character,
    lastTickAt,
    lastTickGain,
    wsConnected,
    unreadMail,
    lastMailEvent,
    realmFullName,
    expProgress,
    fetchState,
    hydrateUnreadMail,
    setCultivating,
    breakthrough,
    bindSocket,
    clearMailBadge,
  };
});
