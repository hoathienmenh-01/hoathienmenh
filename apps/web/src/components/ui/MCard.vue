<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `MCard` (Phase 5 bento primitive).
 *
 * Card primitive dùng cho mọi context (cinematic home, bento hub, minimal
 * admin). Phân biệt với `XianxiaCard` ở chỗ:
 *  - Layout-first: có sẵn slot `eyebrow`, `title`, `meta`, `actions`, default.
 *  - `variant` quyết định "tone": jade (cultivation), gold (sect), seal
 *    (combat/danger), mist (secret), smoke (story), paper (admin minimal),
 *    cinematic (translucent overlay panel for home).
 *  - `tone` opt-in lift/press hành vi cho phù hợp context (`bento` =
 *    hover-lift; `cinematic` = no hover; `minimal` = compact, no glow).
 *  - Tôn trọng `prefers-reduced-motion` + `data-motion="off"`.
 *
 * Không thay thế `XianxiaCard` — mục tiêu là dần migrate các view sang
 * `MCard` để layout đồng nhất + có header/meta/actions slot.
 */
import { computed } from 'vue';

type Variant =
  | 'jade'
  | 'gold'
  | 'seal'
  | 'mist'
  | 'smoke'
  | 'paper'
  | 'cinematic';

type Tone = 'bento' | 'cinematic' | 'minimal' | 'flat';

type Padding = 'none' | 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    /** Visual accent. Default `jade`. */
    variant?: Variant;
    /** Layout tone — controls hover/press feedback + density. */
    tone?: Tone;
    /** Inner padding scale. Default `md`. */
    padding?: Padding;
    /** Optional `as` element (default `section`). Use `article` for self-contained tiles. */
    as?: 'section' | 'article' | 'div';
    /** When true → renders an interactive button-like card with press scale. */
    interactive?: boolean;
    /** Render as `<a>` with this `href`. Implies interactive=true. */
    href?: string | null;
    /** Optional test id. */
    testId?: string;
    /** Optional aria-label (used when card has no title slot). */
    ariaLabel?: string;
  }>(),
  {
    variant: 'jade',
    tone: 'bento',
    padding: 'md',
    as: 'section',
    interactive: false,
    href: null,
    testId: undefined,
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{
  (e: 'click', ev: MouseEvent | KeyboardEvent): void;
}>();

const tag = computed<'section' | 'article' | 'div' | 'a'>(() => {
  if (props.href) return 'a';
  return props.as;
});

const isInteractive = computed(() => Boolean(props.interactive || props.href));

const classes = computed(() => [
  'm-card',
  `m-card--${props.variant}`,
  `m-card--tone-${props.tone}`,
  `m-card--pad-${props.padding}`,
  isInteractive.value ? 'm-card--interactive' : '',
]);

function onActivate(ev: MouseEvent | KeyboardEvent): void {
  if (!isInteractive.value) return;
  emit('click', ev);
}

function onKeydown(ev: KeyboardEvent): void {
  if (!isInteractive.value) return;
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    emit('click', ev);
  }
}
</script>

<template>
  <component
    :is="tag"
    :class="classes"
    :href="href ?? undefined"
    :role="isInteractive && tag !== 'a' ? 'button' : undefined"
    :tabindex="isInteractive && tag !== 'a' ? 0 : undefined"
    :aria-label="ariaLabel"
    :data-testid="testId"
    :data-variant="variant"
    :data-tone="tone"
    @click="onActivate"
    @keydown="onKeydown"
  >
    <header
      v-if="$slots.eyebrow || $slots.title || $slots.meta"
      class="m-card__header"
    >
      <div v-if="$slots.eyebrow" class="m-card__eyebrow">
        <slot name="eyebrow" />
      </div>
      <div v-if="$slots.title" class="m-card__title">
        <slot name="title" />
      </div>
      <div v-if="$slots.meta" class="m-card__meta">
        <slot name="meta" />
      </div>
    </header>
    <div class="m-card__body">
      <slot />
    </div>
    <footer v-if="$slots.actions" class="m-card__actions">
      <slot name="actions" />
    </footer>
  </component>
</template>

<style scoped>
.m-card {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: var(--xt-radius-lg);
  border: 1px solid var(--xt-border-jade);
  background:
    linear-gradient(135deg, rgba(36, 46, 58, 0.85), rgba(20, 28, 38, 0.92)),
    radial-gradient(circle at 18% 0%, rgba(95, 227, 198, 0.1), transparent 38%);
  color: var(--xt-text-primary);
  text-align: inherit;
  text-decoration: none;
  box-shadow: var(--xt-shadow-card);
  transition:
    transform var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease),
    border-color var(--xt-motion-base, 220ms) ease,
    box-shadow var(--xt-motion-base, 220ms) ease;
}

.m-card--pad-none {
  padding: 0;
}
.m-card--pad-sm {
  padding: 12px;
}
.m-card--pad-md {
  padding: 16px;
}
.m-card--pad-lg {
  padding: 24px;
}

.m-card__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.m-card__eyebrow {
  font-family: var(--xt-font-display);
  font-size: var(--xt-text-eyebrow);
  line-height: var(--xt-text-eyebrow-leading);
  letter-spacing: var(--xt-text-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--xt-text-jade);
}
.m-card__title {
  font-family: var(--xt-font-display);
  font-size: var(--xt-text-h3);
  line-height: var(--xt-text-h3-leading);
  letter-spacing: var(--xt-text-h3-tracking);
  font-weight: 600;
  color: var(--xt-text-primary);
}
.m-card__meta {
  font-size: var(--xt-text-small);
  color: var(--xt-text-muted);
}
.m-card__body {
  flex: 1 1 auto;
  min-width: 0;
}
.m-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid rgba(242, 215, 137, 0.08);
}

/* ---- Variants ---- */
.m-card--jade {
  border-color: var(--xt-border-jade);
}
.m-card--gold {
  border-color: var(--xt-border-gold);
  background:
    linear-gradient(135deg, rgba(74, 59, 24, 0.65), rgba(36, 28, 16, 0.92)),
    radial-gradient(circle at 18% 0%, rgba(242, 215, 137, 0.16), transparent 40%);
}
.m-card--seal {
  border-color: var(--xt-border-seal);
  background:
    linear-gradient(135deg, rgba(90, 28, 28, 0.5), rgba(28, 16, 18, 0.92)),
    radial-gradient(circle at 18% 0%, rgba(208, 79, 79, 0.16), transparent 40%);
}
.m-card--mist {
  border-color: var(--xt-border-mist);
  background:
    linear-gradient(135deg, rgba(31, 51, 68, 0.7), rgba(16, 24, 32, 0.92)),
    radial-gradient(circle at 18% 0%, rgba(185, 214, 232, 0.14), transparent 40%);
}
.m-card--smoke {
  border-color: var(--xt-border-smoke);
  background:
    linear-gradient(135deg, rgba(42, 37, 64, 0.7), rgba(20, 18, 32, 0.92)),
    radial-gradient(circle at 18% 0%, rgba(169, 159, 212, 0.14), transparent 40%);
}
.m-card--paper {
  border-color: rgba(242, 215, 137, 0.18);
  background: rgba(20, 28, 38, 0.6);
  box-shadow: none;
}
.m-card--cinematic {
  border-color: rgba(242, 215, 137, 0.22);
  background:
    linear-gradient(180deg, rgba(8, 12, 18, 0.62), rgba(8, 12, 18, 0.78));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

/* ---- Tones ---- */
.m-card--tone-bento.m-card--interactive {
  cursor: pointer;
}
.m-card--tone-bento.m-card--interactive:hover {
  transform: translateY(-2px);
  border-color: rgba(95, 227, 198, 0.5);
  box-shadow:
    0 22px 42px rgba(0, 0, 0, 0.55),
    var(--xt-shadow-jade-glow);
}
.m-card--tone-bento.m-card--interactive:active {
  transform: scale(0.985);
}

.m-card--tone-cinematic {
  border-radius: var(--xt-radius-xl);
}
.m-card--tone-cinematic.m-card--interactive:hover {
  border-color: rgba(242, 215, 137, 0.4);
  box-shadow: var(--xt-shadow-gold-glow);
}

.m-card--tone-minimal {
  border-radius: var(--xt-radius-md);
  background: transparent;
  box-shadow: none;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.m-card--tone-minimal .m-card__actions {
  border-top-color: rgba(255, 255, 255, 0.05);
}
.m-card--tone-minimal.m-card--interactive:hover {
  border-color: rgba(95, 227, 198, 0.32);
  background: rgba(255, 255, 255, 0.02);
}

.m-card--tone-flat {
  background: transparent;
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.04);
}

.m-card--interactive:focus-visible {
  outline: 2px solid var(--xt-jade-bright);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .m-card {
    transition: none;
  }
  .m-card--tone-bento.m-card--interactive:hover {
    transform: none;
  }
  .m-card--tone-bento.m-card--interactive:active {
    transform: none;
  }
}
</style>
