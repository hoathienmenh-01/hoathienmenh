/**
 * Phase 42.0 — Effect Queue Manager (composable).
 *
 * State store-less manager để gom + giới hạn + ưu tiên + auto-dismiss
 * floating combat text / rare drop popup / boss warning / breakthrough
 * banner v.v.
 *
 * Quy tắc:
 *   - `maxVisible` không cho phép vượt số popup hiển thị cùng lúc.
 *   - `maxQueueSize` drop sự kiện cũ nhất khi tràn.
 *   - Effect priority cao hơn → hiện trước.
 *   - `dedupeKey` + `dedupeCooldownMs` để gom nhiều damage tick nhỏ.
 *   - Effect tự clear sau `durationMs` (nếu > 0).
 *   - Reduced-motion / OFF level filter ở caller (composable không tự
 *     đọc settings để dễ test).
 */
import { computed, onUnmounted, ref, type ComputedRef } from 'vue';
import {
  EFFECT_SAFETY,
  getEffectByKey,
  type VisualEffectMotionLevel,
} from '@xuantoi/shared';

export interface QueuedEffect {
  /** Unique id (caller-supplied hoặc auto). */
  id: string;
  /** Visual effect key trong shared catalog. */
  effectKey: string;
  /** Priority override; mặc định lấy từ catalog. */
  priority?: number;
  /** Duration override (ms); ≤ 0 → không auto-dismiss. */
  durationMs?: number;
  /** Dedupe key — push trùng key trong cooldown sẽ stack/gộp. */
  dedupeKey?: string;
  /** Stack counter (manager tăng khi dedupe). */
  stack?: number;
  /** Free metadata (component đọc để render). */
  payload?: Record<string, unknown>;
  /** Millisecond timestamp được push (manager auto-set). */
  pushedAt?: number;
}

export interface EffectQueueOptions {
  maxVisible?: number;
  maxQueueSize?: number;
  dedupeCooldownMs?: number;
  /** Hard-disable list — caller có thể truyền motion level OFF/LOW để skip. */
  motionLevel?: VisualEffectMotionLevel;
}

export interface EffectQueueApi {
  pushEffect(e: Omit<QueuedEffect, 'id' | 'pushedAt'> & { id?: string }): string | null;
  pushManyEffects(list: Array<Omit<QueuedEffect, 'id' | 'pushedAt'> & { id?: string }>): number;
  dismissEffect(id: string): void;
  clearEffects(): void;
  /** Effect đang hiển thị (đã clamp theo maxVisible + sort priority). */
  visibleEffects: ComputedRef<QueuedEffect[]>;
  /** Tổng số queue. */
  size: ComputedRef<number>;
  /** Helper: gộp nhiều damage event nhỏ thành 1 (sum stack). */
  groupSmallDamageEvents(): void;
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `ve-${Date.now()}-${_idCounter}`;
}

export function useEffectQueue(options: EffectQueueOptions = {}): EffectQueueApi {
  const maxVisible = options.maxVisible ?? EFFECT_SAFETY.DEFAULT_MAX_FLOATING_TEXTS;
  const maxQueueSize = options.maxQueueSize ?? EFFECT_SAFETY.DEFAULT_MAX_QUEUE;
  const dedupeCooldownMs =
    options.dedupeCooldownMs ?? EFFECT_SAFETY.DEFAULT_DEDUPE_COOLDOWN_MS;
  const motionLevel: VisualEffectMotionLevel = options.motionLevel ?? 'HIGH';

  const queue = ref<QueuedEffect[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function dismissEffect(id: string): void {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    queue.value = queue.value.filter((e) => e.id !== id);
  }

  function clearEffects(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    queue.value = [];
  }

  function scheduleDismiss(id: string, ms: number): void {
    if (ms <= 0) return;
    const t = setTimeout(() => dismissEffect(id), ms);
    timers.set(id, t);
  }

  function pushEffect(
    input: Omit<QueuedEffect, 'id' | 'pushedAt'> & { id?: string },
  ): string | null {
    if (motionLevel === 'OFF') return null;
    const def = getEffectByKey(input.effectKey);
    if (!def) return null;

    // Motion level gating
    if (motionLevel === 'LOW' && def.intensity !== 'NONE' && def.intensity !== 'LOW') {
      // Cho phép queue ở fallback nếu có
      const fb = def.reducedMotionFallback;
      if (fb && fb !== def.key) {
        return pushEffect({ ...input, effectKey: fb });
      }
      return null;
    }
    if (motionLevel === 'MEDIUM' && (def.intensity === 'LEGENDARY' || def.intensity === 'IMMORTAL')) {
      const fb = def.reducedMotionFallback;
      if (fb && fb !== def.key) {
        return pushEffect({ ...input, effectKey: fb });
      }
      return null;
    }

    const now = Date.now();
    // Dedupe — nếu trong cooldown đã có cùng key → tăng stack
    if (input.dedupeKey) {
      const idx = queue.value.findIndex(
        (e) =>
          e.dedupeKey === input.dedupeKey &&
          (e.pushedAt ?? 0) + dedupeCooldownMs >= now,
      );
      if (idx >= 0) {
        const existing = queue.value[idx];
        const stack = (existing.stack ?? 1) + 1;
        // Replace in place để keep id ổn định
        queue.value = queue.value.map((e, i) =>
          i === idx ? { ...e, stack, pushedAt: now } : e,
        );
        return existing.id;
      }
    }

    const id = input.id ?? nextId();
    const durationMs = input.durationMs ?? def.durationMs;
    const priority = input.priority ?? def.priority;
    const entry: QueuedEffect = {
      id,
      effectKey: input.effectKey,
      priority,
      durationMs,
      dedupeKey: input.dedupeKey,
      stack: 1,
      payload: input.payload,
      pushedAt: now,
    };
    queue.value = [...queue.value, entry];

    // Maintain maxQueueSize — drop lowest priority + oldest first
    if (queue.value.length > maxQueueSize) {
      const sorted = [...queue.value].sort((a, b) => {
        const pa = a.priority ?? 0;
        const pb = b.priority ?? 0;
        if (pa !== pb) return pa - pb; // ascending = lowest first
        return (a.pushedAt ?? 0) - (b.pushedAt ?? 0); // older first
      });
      const toRemove = sorted.slice(0, queue.value.length - maxQueueSize);
      for (const e of toRemove) dismissEffect(e.id);
    }

    scheduleDismiss(id, durationMs);
    return id;
  }

  function pushManyEffects(
    list: Array<Omit<QueuedEffect, 'id' | 'pushedAt'> & { id?: string }>,
  ): number {
    let count = 0;
    for (const e of list) if (pushEffect(e)) count += 1;
    return count;
  }

  function groupSmallDamageEvents(): void {
    // Gộp các DAMAGE_* / DOT đứng cạnh nhau cùng dedupeKey thành stack — đã
    // được xử lý ở dedupe trong pushEffect. Hàm này dọn tail noise nếu UI
    // đã render rời.
    const seen = new Map<string, QueuedEffect>();
    const merged: QueuedEffect[] = [];
    for (const e of queue.value) {
      if (!e.dedupeKey) {
        merged.push(e);
        continue;
      }
      const prev = seen.get(e.dedupeKey);
      if (!prev) {
        seen.set(e.dedupeKey, e);
        merged.push(e);
      } else {
        prev.stack = (prev.stack ?? 1) + (e.stack ?? 1);
        const t = timers.get(e.id);
        if (t) {
          clearTimeout(t);
          timers.delete(e.id);
        }
      }
    }
    queue.value = merged;
  }

  const visibleEffects = computed<QueuedEffect[]>(() => {
    const sorted = [...queue.value].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa; // descending = highest first
      return (a.pushedAt ?? 0) - (b.pushedAt ?? 0);
    });
    return sorted.slice(0, maxVisible);
  });

  const size = computed<number>(() => queue.value.length);

  onUnmounted(() => {
    clearEffects();
  });

  return {
    pushEffect,
    pushManyEffects,
    dismissEffect,
    clearEffects,
    visibleEffects,
    size,
    groupSmallDamageEvents,
  };
}
