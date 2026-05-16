<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import { redeemGiftCode, type GiftCodeRedeemResult } from '@/api/giftcode';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import MButton from '@/components/ui/MButton.vue';
import { itemName } from '@/lib/itemName';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const code = ref('');
const busy = ref(false);
const last = ref<GiftCodeRedeemResult | null>(null);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  game.bindSocket();
});

async function onRedeem(): Promise<void> {
  const c = code.value.trim();
  if (!c) return;
  busy.value = true;
  try {
    const res = await redeemGiftCode(c);
    last.value = res;
    code.value = '';
    toast.push({
      type: 'success',
      text: t('giftcode.successToast', { code: res.code }),
    });
    await game.fetchState().catch(() => null);
  } catch (e) {
    const err = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const label = t(`giftcode.errors.${err}`, '__missing__');
    toast.push({
      type: 'error',
      text: label === '__missing__' ? t('giftcode.errors.UNKNOWN') : label,
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppShell>
    <div class="max-w-md mx-auto">
      <XTSealFrame
        tone="gold"
        corner-ornaments="❀✦❀✦"
        watermark-letter="T"
        rounded="xl"
        inset="tight"
        test-id="gift-code-view-seal-frame"
        aria-label="Tứ Phúc Long Sao hero frame"
      >
        <header>
          <XTPageEyebrow caps="TỨ PHÚC LONG SAO" label="Tứ Phúc Long Sao" />
          <h2 class="text-xl tracking-widest mb-2 mt-1">{{ t('giftcode.title') }}</h2>
          <p class="text-sm text-ink-300 mb-2">{{ t('giftcode.hint') }}</p>
        </header>
      </XTSealFrame>

      <form class="flex flex-col gap-3" @submit.prevent="onRedeem">
        <input
          v-model="code"
          class="bg-ink-900/60 border border-ink-300/40 rounded p-2 tracking-widest uppercase"
          :placeholder="t('giftcode.placeholder')"
          maxlength="32"
          autocomplete="off"
        />
        <MButton type="submit" :disabled="busy || !code.trim()">
          {{ busy ? t('common.loading') : t('giftcode.redeem') }}
        </MButton>
      </form>

      <div
        v-if="last"
        class="mt-6 border border-emerald-400/30 rounded p-3 bg-emerald-900/20"
      >
        <div class="text-sm text-ink-50 font-bold mb-1">
          {{ t('giftcode.lastReward', { code: last.code }) }}
        </div>
        <ul class="text-[12px] text-ink-200 space-y-0.5">
          <li v-if="last.grantedLinhThach !== '0'">
            + {{ last.grantedLinhThach }} {{ t('giftcode.reward.linhThach') }}
          </li>
          <li v-if="last.grantedTienNgoc > 0">
            + {{ last.grantedTienNgoc }} {{ t('giftcode.reward.tienNgoc') }}
          </li>
          <li v-if="last.grantedExp !== '0'">
            + {{ last.grantedExp }} {{ t('giftcode.reward.exp') }}
          </li>
          <li v-for="it in last.grantedItems" :key="it.itemKey">
            + {{ it.qty }}× {{ itemName(it.itemKey, t) }}
          </li>
        </ul>
      </div>
    </div>
  </AppShell>
</template>
