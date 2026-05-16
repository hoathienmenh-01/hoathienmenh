<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import * as authApi from '@/api/auth';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Trang `/auth/forgot-password` (public).
 *
 * BE `POST /_auth/forgot-password` luôn trả silent ok (chống user enumeration),
 * nên FE cũng hiển thị "đã gửi" cho mọi email — kể cả không tồn tại — sau khi
 * submit thành công. Chỉ throw lỗi khi `RATE_LIMITED` (429).
 *
 * Trong dev (`NODE_ENV !== 'production'`), BE trả thêm `devToken` để E2E auto-
 * fill; FE log hiển thị token trên UI để tester có thể test ngay không cần
 * Mailhog UI. Production sẽ là `null`.
 */

const router = useRouter();
const toast = useToastStore();
const { t } = useI18n();

const email = ref('');
const loading = ref(false);
const sent = ref(false);
const devToken = ref<string | null>(null);

function showServerError(code: string): void {
  const key = `auth.errors.${code}`;
  const text = t(key, '__missing__');
  toast.push({ type: 'error', text: text === '__missing__' ? t('auth.errors.UNKNOWN') : text });
}

async function onSubmit(): Promise<void> {
  if (!email.value) return;
  loading.value = true;
  try {
    const out = await authApi.forgotPassword({ email: email.value });
    sent.value = true;
    devToken.value = out.devToken;
    toast.push({ type: 'success', text: t('auth.forgot.sent') });
  } catch (e) {
    showServerError(extractApiErrorCodeOrDefault(e, 'UNKNOWN'));
  } finally {
    loading.value = false;
  }
}

function backToLogin(): void {
  router.push('/auth');
}

function goReset(): void {
  if (!devToken.value) return;
  router.push({ name: 'reset-password', query: { token: devToken.value } });
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
      <XTPageEyebrow caps="QUÊN MẬT KHÓA" label="Quên Mật Khóa" />
      <h1 class="text-2xl text-center text-ink-100 tracking-widest mt-1">
        {{ t('auth.forgot.title') }}
      </h1>
      <p class="text-center text-ink-300 italic mt-2 text-sm">
        {{ t('auth.forgot.subtitle') }}
      </p>

      <form v-if="!sent" class="mt-6 space-y-3" data-testid="forgot-form" @submit.prevent="onSubmit">
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.forgot.email') }}</span>
          <input
            v-model="email"
            type="email"
            required
            data-testid="forgot-email"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <MButton type="submit" :loading="loading" data-testid="forgot-submit" class="w-full">
          {{ t('auth.forgot.submit') }}
        </MButton>
      </form>

      <div v-else class="mt-6 space-y-4" data-testid="forgot-sent">
        <p class="text-ink-50 text-sm leading-relaxed">{{ t('auth.forgot.sent') }}</p>
        <div
          v-if="devToken"
          class="text-xs text-amber-300 break-all border border-amber-300/40 rounded p-2 bg-ink-900/40"
          data-testid="forgot-devtoken"
        >
          <div class="mb-1 font-semibold">{{ t('auth.forgot.devTokenNote') }}</div>
          <code>{{ devToken }}</code>
          <button
            type="button"
            class="block mt-2 text-xs underline text-amber-200"
            data-testid="forgot-goreset"
            @click="goReset"
          >
            → {{ t('auth.reset.title') }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="mt-6 w-full text-center text-xs text-ink-300 underline"
        data-testid="forgot-back"
        @click="backToLogin"
      >
        {{ t('auth.forgot.back') }}
      </button>
    </div>
  </div>
</template>
