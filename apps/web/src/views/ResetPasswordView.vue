<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import * as authApi from '@/api/auth';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Trang `/auth/reset-password?token=...` (public).
 *
 * Token được auto-fill từ query param khi load (mặc định, ẩn input để chống
 * paste sai). Nếu URL thiếu token → hiện input cho phép paste tay.
 *
 * BE `POST /_auth/reset-password` throw `INVALID_RESET_TOKEN` (400) cho mọi
 * fail (token sai/expired/consumed/user banned) — FE map qua `auth.errors`.
 */

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const { t } = useI18n();

const token = ref('');
const newPassword = ref('');
const confirm = ref('');
const loading = ref(false);
const tokenFromUrl = ref(false);

const passwordsMatch = computed(
  () => confirm.value.length === 0 || newPassword.value === confirm.value,
);

onMounted(() => {
  const q = route.query.token;
  if (typeof q === 'string' && q.length >= 16) {
    token.value = q;
    tokenFromUrl.value = true;
  }
});

function showServerError(code: string): void {
  const key = `auth.errors.${code}`;
  const text = t(key, '__missing__');
  toast.push({ type: 'error', text: text === '__missing__' ? t('auth.errors.UNKNOWN') : text });
}

async function onSubmit(): Promise<void> {
  if (!token.value) {
    toast.push({ type: 'error', text: t('auth.reset.missingToken') });
    return;
  }
  if (newPassword.value !== confirm.value) {
    toast.push({ type: 'error', text: t('auth.reset.mismatch') });
    return;
  }
  loading.value = true;
  try {
    await authApi.resetPassword({ token: token.value, newPassword: newPassword.value });
    toast.push({ type: 'success', text: t('auth.reset.success') });
    router.push('/auth');
  } catch (e) {
    showServerError(extractApiErrorCodeOrDefault(e, 'INVALID_RESET_TOKEN'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div
    class="min-h-screen w-full flex items-center justify-center p-4 bg-ink-900 bg-cover bg-center"
    style="background-image: url('/background/auth-bg.svg')"
  >
    <div
      class="w-full max-w-md border-2 border-ink-300/60 rounded-md bg-ink-700/40 backdrop-blur-md p-6 shadow-2xl"
    >
      <XTPageEyebrow caps="ĐẶT LẠI MẬT KHÓA" label="Đặt Lại Mật Khóa" />
      <h1 class="text-2xl text-center text-ink-100 tracking-widest mt-1">
        {{ t('auth.reset.title') }}
      </h1>
      <p class="text-center text-ink-300 italic mt-2 text-sm">
        {{ t('auth.reset.subtitle') }}
      </p>

      <form class="mt-6 space-y-3" data-testid="reset-form" @submit.prevent="onSubmit">
        <label v-if="!tokenFromUrl" class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.reset.token') }}</span>
          <input
            v-model="token"
            type="text"
            required
            minlength="16"
            data-testid="reset-token"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50 font-mono text-xs"
          />
        </label>
        <p v-else class="text-xs text-ink-300/70" data-testid="reset-token-from-url">
          {{ t('auth.reset.tokenFromUrl') }}
        </p>

        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.reset.newPassword') }}</span>
          <input
            v-model="newPassword"
            type="password"
            required
            minlength="8"
            data-testid="reset-new"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.reset.confirm') }}</span>
          <input
            v-model="confirm"
            type="password"
            required
            minlength="8"
            data-testid="reset-confirm"
            class="mt-1 w-full bg-ink-900/60 border rounded px-3 py-2 text-ink-50"
            :class="passwordsMatch ? 'border-ink-300/40 bg-ink-900/60' : 'border-red-400/60 bg-red-900/20'"
          />
        </label>
        <p
          v-if="!passwordsMatch"
          class="text-xs text-red-300"
          data-testid="reset-mismatch"
        >
          {{ t('auth.reset.mismatch') }}
        </p>

        <MButton
          type="submit"
          :loading="loading"
          :disabled="!passwordsMatch"
          data-testid="reset-submit"
          class="w-full"
        >
          {{ t('auth.reset.submit') }}
        </MButton>
      </form>
    </div>
  </div>
</template>
