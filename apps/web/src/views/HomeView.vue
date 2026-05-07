<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { getCharacter } from '@/api/character';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import NextActionPanel from '@/components/NextActionPanel.vue';
import OnboardingChecklist from '@/components/OnboardingChecklist.vue';
import DailyLoginCard from '@/components/DailyLoginCard.vue';
import LiveOpsTodayPanel from '@/components/LiveOpsTodayPanel.vue';
import LiveOpsNotice from '@/components/LiveOpsNotice.vue';
import { extractApiErrorCode } from '@/lib/apiError';

const auth = useAuthStore();
const router = useRouter();
const toast = useToastStore();
const game = useGameStore();
const badges = useBadgesStore();
const { t } = useI18n();

const submitting = ref(false);

const expText = computed(() => {
  const c = game.character;
  if (!c) return '';
  return `${c.exp} / ${c.expNext}`;
});
const atPeak = computed(() => {
  const c = game.character;
  if (!c) return false;
  return c.realmStage === 9 && BigInt(c.exp) >= BigInt(c.expNext);
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  const char = await getCharacter().catch(() => null);
  if (!char) {
    router.replace('/onboarding');
    return;
  }
  await game.fetchState();
  game.bindSocket();
  badges.refresh();
});

async function toggleCultivate(): Promise<void> {
  if (!game.character) return;
  submitting.value = true;
  try {
    await game.setCultivating(!game.character.cultivating);
    toast.push({
      type: 'success',
      text: game.character.cultivating
        ? t('home.cultivate.startedToast')
        : t('home.cultivate.stoppedToast'),
    });
  } catch {
    toast.push({ type: 'error', text: t('auth.errors.UNKNOWN') });
  } finally {
    submitting.value = false;
  }
}

async function onBreakthrough(): Promise<void> {
  submitting.value = true;
  try {
    await game.breakthrough();
    toast.push({ type: 'system', text: t('home.breakthrough.successToast') });
  } catch (e) {
    const code = extractApiErrorCode(e);
    if (code === 'NOT_AT_PEAK') {
      toast.push({ type: 'warning', text: t('home.breakthrough.notAtPeakToast') });
    } else {
      toast.push({ type: 'error', text: t('auth.errors.UNKNOWN') });
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppShell>
    <OnboardingChecklist v-if="game.character" class="mb-4" />
    <DailyLoginCard v-if="game.character" class="mb-4" />
    <LiveOpsTodayPanel v-if="game.character" class="mb-4" />
    <LiveOpsNotice v-if="game.character" />
    <!-- Phase 13.1.B — Sect mission CTA. -->
    <section
      v-if="game.character"
      class="mb-4 rounded border border-amber-300/30 bg-ink-700/30 p-3 flex items-center justify-between gap-3"
      data-test="home-sect-mission-cta"
    >
      <div class="min-w-0">
        <div class="text-sm text-amber-200">{{ t('homeLiveOps.sectMissionTitle') }}</div>
        <div class="text-xs text-ink-300/80 truncate">{{ t('homeLiveOps.sectMissionDesc') }}</div>
      </div>
      <MButton @click="router.push('/sect-war?tab=missions')">
        {{ t('homeLiveOps.openBtn') }}
      </MButton>
    </section>
    <NextActionPanel v-if="game.character" class="mb-6" />
    <div v-if="game.character" class="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section class="rounded border border-ink-300/40 bg-ink-700/30 p-5">
        <header class="mb-3 flex items-center justify-between">
          <h2 class="text-xl tracking-widest">{{ game.character.name }}</h2>
          <span class="text-xs text-ink-300">{{ game.realmFullName }}</span>
        </header>

        <div class="space-y-3">
          <div>
            <div class="flex justify-between text-xs text-ink-300">
              <span>{{ t('home.expLabel') }}</span>
              <span>{{ expText }}</span>
            </div>
            <div class="h-2 mt-1 rounded bg-ink-900/60 overflow-hidden">
              <div
                class="h-full transition-all"
                :class="game.character.cultivating ? 'bg-emerald-400' : 'bg-ink-300'"
                :style="{ width: Math.round(game.expProgress * 100) + '%' }"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-ink-300 flex justify-between">
                <span>HP</span>
                <span>{{ game.character.hp }} / {{ game.character.hpMax }}</span>
              </div>
              <div class="h-1.5 mt-1 rounded bg-ink-900/60 overflow-hidden">
                <div
                  class="h-full bg-rose-400"
                  :style="{ width: (game.character.hp / game.character.hpMax) * 100 + '%' }"
                />
              </div>
            </div>
            <div>
              <div class="text-xs text-ink-300 flex justify-between">
                <span>MP</span>
                <span>{{ game.character.mp }} / {{ game.character.mpMax }}</span>
              </div>
              <div class="h-1.5 mt-1 rounded bg-ink-900/60 overflow-hidden">
                <div
                  class="h-full bg-sky-400"
                  :style="{ width: (game.character.mp / game.character.mpMax) * 100 + '%' }"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <MButton :loading="submitting" @click="toggleCultivate">
            {{ game.character.cultivating ? t('home.cultivate.stop') : t('home.cultivate.start') }}
          </MButton>
          <MButton :loading="submitting" :disabled="!atPeak" @click="onBreakthrough">
            {{ t('home.breakthrough.submit') }}
          </MButton>
        </div>

        <p v-if="game.lastTickAt" class="text-xs text-ink-300 mt-3">
          {{ t('home.lastTick', {
            gain: game.lastTickGain,
            time: new Date(game.lastTickAt).toLocaleTimeString(),
          }) }}
        </p>
      </section>

      <section class="rounded border border-ink-300/40 bg-ink-700/30 p-5">
        <h3 class="text-sm tracking-widest text-ink-300 uppercase mb-3">{{ t('home.stats.title') }}</h3>
        <dl class="grid grid-cols-2 gap-y-2 text-sm">
          <dt class="text-ink-300">{{ t('home.stats.power') }}</dt>
          <dd class="text-right">{{ game.character.power }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.spirit') }}</dt>
          <dd class="text-right">{{ game.character.spirit }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.speed') }}</dt>
          <dd class="text-right">{{ game.character.speed }}</dd>
          <dt class="text-ink-300">{{ t('home.stats.luck') }}</dt>
          <dd class="text-right">{{ game.character.luck }}</dd>
        </dl>
        <p class="text-xs text-ink-300 mt-4">
          {{ t('home.wip') }}
        </p>
      </section>
    </div>
    <div v-else class="text-center text-ink-300">{{ t('home.loadingChar') }}</div>
  </AppShell>
</template>
