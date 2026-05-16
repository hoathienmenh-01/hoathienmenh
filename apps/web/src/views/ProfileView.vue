<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  fullRealmName,
  getCosmeticById,
  realmByKey,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { getPublicProfile, type PublicProfile } from '@/api/character';
import {
  fetchCosmeticProfile,
  type CosmeticLoadoutView,
} from '@/api/cosmetics';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';

function realmText(key: string, stage: number): string {
  const r = realmByKey(key);
  if (!r) return key;
  return fullRealmName(r, stage);
}

const auth = useAuthStore();
const game = useGameStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const profile = ref<PublicProfile | null>(null);
const loading = ref(true);
const notFound = ref(false);
const cosmeticLoadout = ref<CosmeticLoadoutView | null>(null);

const equippedTitle = computed(() => {
  const id = cosmeticLoadout.value?.activeTitleId;
  return id ? getCosmeticById(id) : null;
});
const equippedAura = computed(() => {
  const id = cosmeticLoadout.value?.activeAuraId;
  return id ? getCosmeticById(id) : null;
});
const equippedElementAura = computed(() => {
  const id = cosmeticLoadout.value?.activeElementAuraId;
  return id ? getCosmeticById(id) : null;
});
const equippedAvatarFrame = computed(() => {
  const id = cosmeticLoadout.value?.activeAvatarFrameId;
  return id ? getCosmeticById(id) : null;
});
const equippedProfileDecoration = computed(() => {
  const id = cosmeticLoadout.value?.activeProfileDecorationId;
  return id ? getCosmeticById(id) : null;
});

async function load(id: string): Promise<void> {
  loading.value = true;
  notFound.value = false;
  cosmeticLoadout.value = null;
  const p = await getPublicProfile(id);
  if (!p) {
    notFound.value = true;
    profile.value = null;
  } else {
    profile.value = p;
    // Fire-and-forget — cosmetic loadout is purely render-only and must
    // never block the profile from rendering.
    void fetchCosmeticProfile(p.id)
      .then((cp) => {
        cosmeticLoadout.value = cp.loadout;
      })
      .catch(() => {
        cosmeticLoadout.value = null;
      });
  }
  loading.value = false;
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  const id = String(route.params.id ?? '');
  if (!id) {
    notFound.value = true;
    loading.value = false;
    return;
  }
  await load(id);
});

watch(
  () => route.params.id,
  async (newId) => {
    if (typeof newId === 'string' && newId) await load(newId);
  },
);
</script>

<template>
  <AppShell>
    <div class="max-w-2xl mx-auto space-y-4">
      <XTSealFrame
        tone="gold"
        corner-ornaments="❀✦❀✦"
        watermark-letter="T"
        rounded="xl"
        inset="tight"
        test-id="profile-view-seal-frame"
        aria-label="Thân Thế Công Trạng hero frame"
      >
        <header>
          <XTPageEyebrow caps="THÂN THẾ CÔNG TRẠNG" label="Thân Thế Công Trạng" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('profile.title') }}</h1>
        </header>
      </XTSealFrame>

      <div v-if="loading" class="space-y-3" data-testid="profile-skeleton">
        <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2">
          <SkeletonBlock height="h-6" width="w-1/3" />
          <SkeletonBlock height="h-4" width="w-1/2" />
          <SkeletonBlock height="h-3" width="w-1/4" />
        </section>
        <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3">
          <SkeletonBlock height="h-5" width="w-1/4" />
          <div class="grid grid-cols-2 gap-2">
            <SkeletonBlock v-for="i in 8" :key="i" height="h-4" />
          </div>
        </section>
      </div>

      <div
        v-else-if="notFound"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
      >
        {{ t('profile.notFound') }}
      </div>

      <template v-else-if="profile">
        <section
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
          :class="equippedProfileDecoration ? equippedProfileDecoration.cssClass : ''"
          :data-cosmetic-profile="equippedProfileDecoration?.cosmeticId ?? ''"
        >
          <div class="flex items-baseline justify-between gap-2">
            <div class="flex items-center gap-3">
              <div
                v-if="equippedAvatarFrame || equippedAura || equippedElementAura"
                class="cosmetic-aura-wrap"
                :class="[
                  equippedAvatarFrame?.cssClass,
                  equippedAura?.cssClass,
                  equippedElementAura?.cssClass,
                ].filter(Boolean).join(' ')"
                data-testid="profile-avatar-aura"
              >
                <div class="w-12 h-12 rounded-full bg-ink-600 grid place-items-center text-ink-200 text-lg">
                  {{ profile.name.slice(0, 1).toUpperCase() }}
                </div>
              </div>
              <div>
                <h2 class="text-xl text-amber-200 flex items-center gap-2">
                  <span
                    v-if="equippedTitle"
                    :class="equippedTitle.cssClass"
                    data-testid="profile-equipped-title"
                  >{{ equippedTitle.nameVi }}</span>
                  <span>{{ profile.name }}</span>
                </h2>
                <p class="text-xs text-ink-300">
                  {{ realmText(profile.realmKey, profile.realmStage) }}
                  · Lv.{{ profile.level }}
                </p>
              </div>
            </div>
            <span
              v-if="profile.role !== 'PLAYER'"
              class="px-2 py-0.5 rounded text-xs"
              :class="profile.role === 'ADMIN' ? 'bg-amber-700/40 text-amber-200' : 'bg-blue-700/40 text-blue-200'"
            >
              {{ profile.role }}
            </span>
          </div>
          <div v-if="profile.sectName" class="text-sm text-ink-200">
            {{ t('profile.sect') }}: <span class="text-amber-100">{{ profile.sectName }}</span>
          </div>
          <div class="text-xs text-ink-300">
            {{ t('profile.joinedAt') }}: {{ new Date(profile.createdAt).toLocaleDateString() }}
          </div>
        </section>

        <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4">
          <h3 class="text-amber-200 mb-2">{{ t('profile.stats') }}</h3>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <dt class="text-ink-300">{{ t('profile.power') }}</dt>
            <dd>{{ profile.power }}</dd>
            <dt class="text-ink-300">{{ t('profile.spirit') }}</dt>
            <dd>{{ profile.spirit }}</dd>
            <dt class="text-ink-300">{{ t('profile.speed') }}</dt>
            <dd>{{ profile.speed }}</dd>
            <dt class="text-ink-300">{{ t('profile.luck') }}</dt>
            <dd>{{ profile.luck }}</dd>
          </dl>
        </section>
      </template>
    </div>
  </AppShell>
</template>
