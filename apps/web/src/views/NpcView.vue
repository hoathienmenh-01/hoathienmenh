<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useNpcStore } from '@/stores/npc';
import { useNpcAffinityStore } from '@/stores/npcAffinity';
import AppShell from '@/components/shell/AppShell.vue';
import NpcAffinityPanel from '@/components/NpcAffinityPanel.vue';
import NpcDialogueModal from '@/components/NpcDialogueModal.vue';
import StoryDialogueModal from '@/components/StoryDialogueModal.vue';
import { useStoryDialogueStore } from '@/stores/storyDialogue';
import type { NpcView as NpcViewModel } from '@/api/npc';

/**
 * Phase 12 Story PR-4 — NPC list view.
 *
 * Server-authoritative: list NPC visible (`realmGateOrder <= character.realmOrder`)
 * + dialogue line đã filter branch theo realm + quest status. Click NPC mở
 * `NpcDialogueModal` (cùng store `useNpcStore`).
 *
 * UI MODULE RULE — list + loading/empty/error + i18n vi/en. Filter / pagination
 * chưa cần ở PR-4 (4 NPC catalog) — sẽ thêm khi catalog mở rộng.
 */

const auth = useAuthStore();
const game = useGameStore();
const npcStore = useNpcStore();
const npcAffinityStore = useNpcAffinityStore();
const storyDialogue = useStoryDialogueStore();
const router = useRouter();
const { t } = useI18n();

const loading = computed(() => npcStore.loading);
const loaded = computed(() => npcStore.loaded);
const lastError = computed(() => npcStore.lastError);
const npcs = computed(() => npcStore.npcs);

const activeNpc = computed<NpcViewModel | null>(() => {
  if (!npcStore.activeNpcKey) return null;
  return npcStore.findNpc(npcStore.activeNpcKey) ?? null;
});

function factionLabel(faction: NpcViewModel['faction']): string {
  if (!faction) return t('npc.faction.wandering');
  return t(`npc.faction.${faction}`);
}

async function open(npc: NpcViewModel): Promise<void> {
  await npcStore.openDialogue(npc.key);
}

function close(): void {
  npcStore.closeDialogue();
}

const activeStoryNpc = computed<NpcViewModel | null>(() => {
  if (!storyDialogue.activeNpcKey) return null;
  return npcStore.findNpc(storyDialogue.activeNpcKey) ?? null;
});

async function openStory(npc: NpcViewModel): Promise<void> {
  await storyDialogue.open(npc.key);
}

function closeStory(): void {
  storyDialogue.close();
}

async function onStoryEffectsApplied(): Promise<void> {
  // Refresh NPC list (faction quest counts + dialogue branch may have shifted),
  // game state (linhThach + exp may have been granted), and affinity panel
  // (Phase 12.10.A — change_affinity effect mutates affinity score).
  await Promise.all([
    npcStore.load(),
    game.fetchState().catch(() => null),
    npcAffinityStore.refresh().catch(() => null),
  ]);
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  if (!game.character) {
    router.replace('/onboarding');
    return;
  }
  await Promise.all([
    npcStore.load(),
    npcAffinityStore.load().catch(() => null),
  ]);
});
</script>

<template>
  <AppShell>
    <div class="max-w-4xl mx-auto space-y-4" data-testid="npc-view">
      <header class="flex items-baseline justify-between gap-3">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">{{ t('npc.title') }}</h1>
          <p class="text-sm text-ink-300">{{ t('npc.subtitle') }}</p>
        </div>
        <div class="text-right text-xs text-ink-300">
          <div data-testid="npc-visible-count">
            {{ t('npc.visibleCount', { n: npcs.length }) }}
          </div>
        </div>
      </header>

      <div
        v-if="loading && !loaded"
        class="text-ink-300 text-sm"
        data-testid="npc-loading"
      >
        {{ t('common.loadingData') }}
      </div>

      <div
        v-else-if="lastError"
        class="bg-rose-900/30 border border-rose-400/30 rounded p-4 text-sm text-rose-100"
        data-testid="npc-error"
      >
        {{ t(`npc.errors.${lastError}`, t('npc.errors.UNKNOWN')) }}
      </div>

      <div
        v-else-if="loaded && npcs.length === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="npc-empty"
      >
        {{ t('npc.empty') }}
      </div>

      <ul
        v-else
        class="grid gap-3 md:grid-cols-2"
        data-testid="npc-list"
      >
        <li
          v-for="n in npcs"
          :key="n.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
          :data-testid="`npc-row-${n.key}`"
        >
          <header class="flex items-baseline justify-between gap-2">
            <h3 class="font-bold text-amber-100">{{ n.name }}</h3>
            <span class="text-xs text-ink-300 italic">
              {{ factionLabel(n.faction) }}
            </span>
          </header>
          <p class="text-xs text-ink-300 leading-relaxed">{{ n.description }}</p>
          <p class="text-[11px] text-ink-400 leading-relaxed italic">
            {{ n.loreSummary }}
          </p>
          <div class="flex items-center justify-between gap-2 pt-1">
            <span class="text-xs text-ink-300">
              {{ t('npc.questCount', { n: n.questCount }) }}
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded border border-amber-400/40 bg-amber-700/30 text-amber-100 hover:bg-amber-700/50 transition text-sm"
                :data-testid="`npc-talk-${n.key}`"
                @click="open(n)"
              >
                {{ t('npc.talk') }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded border border-violet-400/40 bg-violet-700/30 text-violet-100 hover:bg-violet-700/50 transition text-sm"
                :data-testid="`npc-story-${n.key}`"
                @click="openStory(n)"
              >
                {{ t('storyDialogue.talk') }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <NpcAffinityPanel :auto-load="false" />

      <NpcDialogueModal
        :npc-key="activeNpc?.key ?? null"
        :npc-name="activeNpc?.name ?? ''"
        :description="activeNpc?.description ?? ''"
        @close="close"
      />

      <StoryDialogueModal
        :npc-key="activeStoryNpc?.key ?? null"
        :npc-name="activeStoryNpc?.name ?? ''"
        @close="closeStory"
        @effects-applied="onStoryEffectsApplied"
      />
    </div>
  </AppShell>
</template>
