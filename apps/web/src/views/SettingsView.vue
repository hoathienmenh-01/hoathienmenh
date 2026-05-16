<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import { changePassword, logoutAll } from '@/api/auth';
import { setLocale, type LocaleKey } from '@/i18n';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import EffectSettingsPanel from '@/components/visual-effects/EffectSettingsPanel.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  APPEARANCE_VALUES,
  FONT_SIZE_VALUES,
  NUMBER_FORMAT_VALUES,
  DEFAULT_PLAYER_SETTINGS,
  type PlayerSettings,
} from '@xuantoi/shared';
import {
  fetchPlayerSettings,
  patchPlayerSettings,
  resetPlayerSettings,
} from '@/api/playerExperience';
import {
  applyAppearance,
  loadCachedTheme,
  setTheme,
  type AppearanceMode,
  type ThemeName,
} from '@/lib/appearance';
import {
  isSfxMuted,
  setSfxMuted,
  getSfxVolume,
  setSfxVolume,
  playSfxConfirm,
} from '@/lib/sfx';
import {
  isBgmMuted,
  setBgmMuted,
  getBgmVolume,
  setBgmVolume,
  playSceneBgm,
  stopBgm,
} from '@/lib/bgm';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t, locale } = useI18n();

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const submittingPwd = ref(false);
const submittingLogoutAll = ref(false);
const logoutAllConfirmOpen = ref(false);

const passwordMismatch = computed(
  () => newPassword.value.length > 0 && newPassword.value !== confirmPassword.value,
);
const passwordTooShort = computed(
  () => newPassword.value.length > 0 && newPassword.value.length < 8,
);

const playerSettings = ref<PlayerSettings>({ ...DEFAULT_PLAYER_SETTINGS });
const playerSettingsLoading = ref(true);
const playerSettingsSaving = ref(false);
const resetConfirmOpen = ref(false);

const sfxMuted = ref(false);
const sfxVolume = ref(0.6);
const bgmMuted = ref(false);
const bgmVolume = ref(0.35);

const currentTheme = ref<ThemeName>('night');

function toggleTheme(theme: ThemeName): void {
  currentTheme.value = theme;
  setTheme(theme);
  if (theme === 'day') {
    playerSettings.value = { ...playerSettings.value, appearance: 'light' };
  } else {
    playerSettings.value = { ...playerSettings.value, appearance: 'dark' };
  }
  // Best-effort: persist to backend nếu user đã login. Không block UI.
  savePlayerSettings({ appearance: theme === 'day' ? 'light' : 'dark' }).catch(() => null);
}

function onSfxMutedChange(ev: Event): void {
  const target = ev.target as HTMLInputElement;
  sfxMuted.value = target.checked;
  setSfxMuted(target.checked);
  if (!target.checked) playSfxConfirm();
}
function onSfxVolumeChange(ev: Event): void {
  const target = ev.target as HTMLInputElement;
  const v = Number(target.value) / 100;
  sfxVolume.value = v;
  setSfxVolume(v);
}
function previewSfx(): void {
  playSfxConfirm();
}
function onBgmMutedChange(ev: Event): void {
  const target = ev.target as HTMLInputElement;
  bgmMuted.value = target.checked;
  setBgmMuted(target.checked);
  if (target.checked) {
    stopBgm(400);
  } else {
    const scene = (document.body.dataset.scene ?? 'default') as Parameters<typeof playSceneBgm>[0];
    playSceneBgm(scene);
  }
}
function onBgmVolumeChange(ev: Event): void {
  const target = ev.target as HTMLInputElement;
  const v = Number(target.value) / 100;
  bgmVolume.value = v;
  setBgmVolume(v);
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  sfxMuted.value = isSfxMuted();
  sfxVolume.value = getSfxVolume();
  bgmMuted.value = isBgmMuted();
  bgmVolume.value = getBgmVolume();
  currentTheme.value = loadCachedTheme();
  await game.fetchState().catch(() => null);
  game.bindSocket();
  try {
    const row = await fetchPlayerSettings();
    playerSettings.value = row.settings;
    // Sync appearance từ server vào DOM (override cache nếu khác).
    applyAppearance(row.settings.appearance as AppearanceMode);
  } catch {
    // Silently fall back to default (NO_CHARACTER hoặc lỗi mạng).
  } finally {
    playerSettingsLoading.value = false;
  }
});

async function savePlayerSettings(patch: Partial<PlayerSettings>): Promise<void> {
  if (playerSettingsSaving.value) return;
  playerSettingsSaving.value = true;
  try {
    const row = await patchPlayerSettings(patch);
    playerSettings.value = row.settings;
    if (patch.appearance) {
      applyAppearance(patch.appearance as AppearanceMode);
    }
    toast.push({ type: 'success', text: t('playerSettings.saved') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`playerSettings.errors.${code}`, t('playerSettings.errors.UNKNOWN')),
    });
  } finally {
    playerSettingsSaving.value = false;
  }
}

async function doResetPlayerSettings(): Promise<void> {
  if (playerSettingsSaving.value) return;
  playerSettingsSaving.value = true;
  try {
    const row = await resetPlayerSettings();
    playerSettings.value = row.settings;
    applyAppearance(row.settings.appearance as AppearanceMode);
    toast.push({ type: 'success', text: t('playerSettings.saved') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`playerSettings.errors.${code}`, t('playerSettings.errors.UNKNOWN')),
    });
  } finally {
    playerSettingsSaving.value = false;
    resetConfirmOpen.value = false;
  }
}

async function submitChangePassword(): Promise<void> {
  if (submittingPwd.value) return;
  if (!oldPassword.value || !newPassword.value) {
    toast.push({ type: 'error', text: t('settings.password.empty') });
    return;
  }
  if (passwordMismatch.value) {
    toast.push({ type: 'error', text: t('settings.password.mismatch') });
    return;
  }
  if (passwordTooShort.value) {
    toast.push({ type: 'error', text: t('settings.password.tooShort') });
    return;
  }
  submittingPwd.value = true;
  try {
    await changePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    toast.push({ type: 'success', text: t('settings.password.success') });
    oldPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    // Đổi mật khẩu đã revoke toàn bộ refresh token → logout luôn về /auth.
    await auth.logout();
    router.replace('/auth');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const text = t(`settings.errors.${code}`, '__missing__');
    toast.push({
      type: 'error',
      text: text === '__missing__' ? t('settings.errors.UNKNOWN') : text,
    });
  } finally {
    submittingPwd.value = false;
  }
}

function openLogoutAllConfirm(): void {
  if (submittingLogoutAll.value) return;
  logoutAllConfirmOpen.value = true;
}

function cancelLogoutAllConfirm(): void {
  if (submittingLogoutAll.value) return;
  logoutAllConfirmOpen.value = false;
}

async function submitLogoutAll(): Promise<void> {
  if (submittingLogoutAll.value) return;
  submittingLogoutAll.value = true;
  try {
    const r = await logoutAll();
    toast.push({
      type: 'success',
      text: t('settings.logoutAll.success', { revoked: r.revoked }),
    });
    logoutAllConfirmOpen.value = false;
    auth.user = null;
    router.replace('/auth');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const text = t(`settings.errors.${code}`, '__missing__');
    toast.push({
      type: 'error',
      text: text === '__missing__' ? t('settings.errors.UNKNOWN') : text,
    });
  } finally {
    submittingLogoutAll.value = false;
  }
}

function changeLocale(value: string): void {
  if (value !== 'vi' && value !== 'en') return;
  setLocale(value as LocaleKey);
  toast.push({ type: 'success', text: t('settings.locale.changed') });
}
</script>

<template>
  <AppShell>
    <div class="max-w-2xl mx-auto space-y-6">
      <XTLuxHero
        eyebrow="TÂM TRẦN TU CHỈNH"
        label="Tạng Bảo Các"
        :title="t('settings.title')"
        :subtitle="t('settings.subtitle')"
        tone="gold"
        watermark-letter="T"
        breadcrumb="Hệ Thống · Thiết Lập"
        test-id="settings-view-hero"
      >
        <XTPageEyebrow
          caps="TÂM TRẦN TU CHỈNH"
          label="Tâm Trần Tu Chỉnh"
          class="sr-only"
        />
      </XTLuxHero>

      <!-- Ngày / Đêm theme toggle -->
      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
        data-testid="settings-theme-toggle"
      >
        <h2 class="text-amber-200 text-base">Chế độ giao diện</h2>
        <p class="text-xs text-ink-300">
          Chọn tông màu hiển thị: Ngày sáng hoặc Đêm tối.
        </p>
        <div
          class="inline-flex rounded border border-ink-300/30 overflow-hidden"
          role="group"
          aria-label="Ngày / Đêm"
        >
          <button
            type="button"
            class="px-4 py-1.5 text-xs transition"
            :class="
              currentTheme === 'day'
                ? 'bg-amber-500 text-ink-950 font-semibold'
                : 'bg-ink-700/40 text-ink-200 hover:bg-ink-700/60'
            "
            data-testid="settings-theme-day"
            :aria-pressed="currentTheme === 'day'"
            @click="toggleTheme('day')"
          >
            Ngày
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-xs transition"
            :class="
              currentTheme === 'night'
                ? 'bg-ink-900 text-amber-100 font-semibold'
                : 'bg-ink-700/40 text-ink-200 hover:bg-ink-700/60'
            "
            data-testid="settings-theme-night"
            :aria-pressed="currentTheme === 'night'"
            @click="toggleTheme('night')"
          >
            Đêm
          </button>
        </div>
      </section>

      <!-- Account info -->
      <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2 text-sm">
        <h2 class="text-amber-200 text-base">{{ t('settings.account.title') }}</h2>
        <dl class="grid grid-cols-2 gap-2">
          <dt class="text-ink-300">{{ t('settings.account.email') }}</dt>
          <dd>{{ auth.user?.email ?? '—' }}</dd>
          <dt class="text-ink-300">{{ t('settings.account.role') }}</dt>
          <dd>{{ auth.user?.role ?? 'PLAYER' }}</dd>
          <dt class="text-ink-300">{{ t('settings.account.createdAt') }}</dt>
          <dd>{{ auth.user ? new Date(auth.user.createdAt).toLocaleString() : '—' }}</dd>
        </dl>
      </section>

      <!-- Change password -->
      <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm">
        <h2 class="text-amber-200 text-base">{{ t('settings.password.title') }}</h2>
        <p class="text-xs text-ink-300">{{ t('settings.password.hint') }}</p>
        <label class="block">
          <span class="text-ink-300">{{ t('settings.password.old') }}</span>
          <input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('settings.password.new') }}</span>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
          <span v-if="passwordTooShort" class="text-red-400 text-xs mt-1 block">
            {{ t('settings.password.tooShort') }}
          </span>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('settings.password.confirm') }}</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
          <span v-if="passwordMismatch" class="text-red-400 text-xs mt-1 block">
            {{ t('settings.password.mismatch') }}
          </span>
        </label>
        <MButton
          :disabled="submittingPwd || !oldPassword || !newPassword || passwordMismatch || passwordTooShort"
          @click="submitChangePassword()"
        >
          {{ t('settings.password.submit') }}
        </MButton>
      </section>

      <!-- Locale -->
      <section class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2 text-sm">
        <h2 class="text-amber-200 text-base">{{ t('settings.locale.title') }}</h2>
        <select
          :value="locale"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          @change="changeLocale(($event.target as HTMLSelectElement).value)"
        >
          <option value="vi">Tiếng Việt</option>
          <option value="en">English</option>
        </select>
      </section>

      <!-- Phase 41 — Player experience preferences -->
      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
        data-testid="player-settings-section"
      >
        <h2 class="text-amber-200 text-base">{{ t('playerSettings.title') }}</h2>
        <p class="text-xs text-ink-300">{{ t('playerSettings.subtitle') }}</p>
        <div v-if="playerSettingsLoading" class="text-xs text-ink-300">
          {{ t('common.loading') }}
        </div>
        <template v-else>
          <label class="block">
            <span class="text-ink-300">{{ t('playerSettings.fields.fontSize') }}</span>
            <select
              :value="playerSettings.fontSize"
              class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
              data-testid="settings-font-size"
              @change="
                savePlayerSettings({
                  fontSize: ($event.target as HTMLSelectElement).value as PlayerSettings['fontSize'],
                })
              "
            >
              <option v-for="fs in FONT_SIZE_VALUES" :key="fs" :value="fs">
                {{ t(`playerSettings.fontSize.${fs}`) }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="text-ink-300">{{ t('playerSettings.fields.appearance') }}</span>
            <select
              :value="playerSettings.appearance"
              class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
              data-testid="settings-appearance"
              @change="
                savePlayerSettings({
                  appearance: ($event.target as HTMLSelectElement).value as PlayerSettings['appearance'],
                })
              "
            >
              <option v-for="ap in APPEARANCE_VALUES" :key="ap" :value="ap">
                {{ t(`playerSettings.appearance.${ap}`) }}
              </option>
            </select>
          </label>
          <div class="block rounded border border-[var(--xt-border-gold)]/40 bg-[var(--xt-ink-deep)]/40 p-3" data-testid="settings-sfx">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink-100 font-medium">Âm thanh hiệu ứng</span>
              <label class="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="sfxMuted"
                  data-testid="settings-sfx-muted"
                  @change="onSfxMutedChange"
                />
                <span>Tắt tiếng</span>
              </label>
            </div>
            <div class="mt-2 flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                :value="Math.round(sfxVolume * 100)"
                :disabled="sfxMuted"
                class="flex-1"
                data-testid="settings-sfx-volume"
                @input="onSfxVolumeChange"
              />
              <span class="w-10 text-right text-xs text-ink-300">{{ Math.round(sfxVolume * 100) }}%</span>
              <button
                type="button"
                class="text-xs text-[var(--xt-text-jade)] underline disabled:opacity-50"
                :disabled="sfxMuted"
                data-testid="settings-sfx-preview"
                @click="previewSfx"
              >Thử</button>
            </div>
          </div>
          <div class="block rounded border border-[var(--xt-border-gold)]/40 bg-[var(--xt-ink-deep)]/40 p-3" data-testid="settings-bgm">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink-100 font-medium">Nhạc nền</span>
              <label class="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="bgmMuted"
                  data-testid="settings-bgm-muted"
                  @change="onBgmMutedChange"
                />
                <span>Tắt tiếng</span>
              </label>
            </div>
            <div class="mt-2 flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                :value="Math.round(bgmVolume * 100)"
                :disabled="bgmMuted"
                class="flex-1"
                data-testid="settings-bgm-volume"
                @input="onBgmVolumeChange"
              />
              <span class="w-10 text-right text-xs text-ink-300">{{ Math.round(bgmVolume * 100) }}%</span>
            </div>
          </div>
          <label class="block">
            <span class="text-ink-300">{{ t('playerSettings.fields.numberFormat') }}</span>
            <select
              :value="playerSettings.numberFormat"
              class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
              data-testid="settings-number-format"
              @change="
                savePlayerSettings({
                  numberFormat: ($event.target as HTMLSelectElement).value as PlayerSettings['numberFormat'],
                })
              "
            >
              <option v-for="nf in NUMBER_FORMAT_VALUES" :key="nf" :value="nf">
                {{ t(`playerSettings.numberFormat.${nf}`) }}
              </option>
            </select>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              :checked="playerSettings.compactMode"
              data-testid="settings-compact"
              @change="savePlayerSettings({ compactMode: ($event.target as HTMLInputElement).checked })"
            />
            <span>{{ t('playerSettings.fields.compactMode') }}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              :checked="playerSettings.reduceMotion"
              data-testid="settings-reduce-motion"
              @change="savePlayerSettings({ reduceMotion: ($event.target as HTMLInputElement).checked })"
            />
            <span>{{ t('playerSettings.fields.reduceMotion') }}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              :checked="playerSettings.showCombatLogDetail"
              @change="savePlayerSettings({ showCombatLogDetail: ($event.target as HTMLInputElement).checked })"
            />
            <span>{{ t('playerSettings.fields.showCombatLogDetail') }}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              :checked="playerSettings.showSystemTips"
              @change="savePlayerSettings({ showSystemTips: ($event.target as HTMLInputElement).checked })"
            />
            <span>{{ t('playerSettings.fields.showSystemTips') }}</span>
          </label>
          <EffectSettingsPanel
            :settings="playerSettings"
            :loading="playerSettingsLoading"
            :saving="playerSettingsSaving"
            @patch="savePlayerSettings"
          />
          <div class="pt-2">
            <button
              :disabled="playerSettingsSaving"
              class="px-3 py-1.5 rounded border border-ink-300/40 hover:bg-ink-700/60 text-xs"
              data-testid="settings-reset-btn"
              @click="resetConfirmOpen = true"
            >
              {{ t('playerSettings.resetButton') }}
            </button>
          </div>
        </template>
      </section>

      <!-- Logout all sessions -->
      <section class="bg-ink-700/30 border border-red-400/30 rounded p-4 space-y-2 text-sm">
        <h2 class="text-red-300 text-base">{{ t('settings.logoutAll.title') }}</h2>
        <p class="text-xs text-ink-300">{{ t('settings.logoutAll.hint') }}</p>
        <button
          :disabled="submittingLogoutAll"
          class="px-5 py-2 rounded border border-red-400/40 bg-red-700/30 text-red-100 hover:bg-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          data-testid="settings-logout-all-btn"
          @click="openLogoutAllConfirm()"
        >
          {{ t('settings.logoutAll.submit') }}
        </button>
      </section>
    </div>

    <ConfirmModal
      :open="logoutAllConfirmOpen"
      :title="t('settings.logoutAll.title')"
      :message="t('settings.logoutAll.confirm')"
      :confirm-text="t('settings.logoutAll.submit')"
      :loading="submittingLogoutAll"
      danger
      test-id="logout-all-confirm-modal"
      @confirm="submitLogoutAll()"
      @cancel="cancelLogoutAllConfirm()"
    />
    <ConfirmModal
      :open="resetConfirmOpen"
      :title="t('playerSettings.resetButton')"
      :message="t('playerSettings.resetConfirm')"
      :confirm-text="t('playerSettings.resetButton')"
      :loading="playerSettingsSaving"
      test-id="settings-reset-confirm-modal"
      @confirm="doResetPlayerSettings()"
      @cancel="resetConfirmOpen = false"
    />
  </AppShell>
</template>
