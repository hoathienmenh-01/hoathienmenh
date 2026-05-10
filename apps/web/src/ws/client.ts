import { io, type Socket } from 'socket.io-client';
import type {
  CharacterStatePayload,
  CultivateTickPayload,
  WsFrame,
  WsEventType,
} from '@xuantoi/shared';

let socket: Socket | null = null;

type Handler<T = unknown> = (frame: WsFrame<T>) => void;
const handlers = new Map<WsEventType, Set<Handler>>();

export function on<T>(type: WsEventType, fn: Handler<T>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(fn as Handler);
  return () => set?.delete(fn as Handler);
}

function dispatch<T>(type: WsEventType, frame: WsFrame<T>): void {
  const set = handlers.get(type);
  if (!set) return;
  for (const fn of set) fn(frame as WsFrame);
}

/**
 * Trích origin (scheme://host[:port]) từ giá trị `VITE_WS_URL`.
 * KHÔNG được giữ path (vd `/ws`) vì socket.io-client sẽ hiểu phần path
 * là namespace, lệch với gateway server (gateway path `/ws`, namespace `/`).
 *
 * - rỗng / không hợp lệ → trả về `fallback` (thường là same-origin để Vite
 *   proxy `/ws` xử lý ở dev).
 */
export function resolveWsOrigin(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  if (trimmed) {
    try {
      const u = new URL(trimmed);
      return `${u.protocol}//${u.host}`;
    } catch {
      // ignore — rơi xuống fallback
    }
  }
  return fallback;
}

export function connect(): Socket {
  if (socket) return socket;
  const url = resolveWsOrigin(
    import.meta.env.VITE_WS_URL as string | undefined,
    window.location.origin,
  );
  socket = io(url, {
    path: '/ws',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelayMax: 30_000,
  });

  // Log lỗi để debug khi handshake fail (auth, CORS, namespace …).
  socket.on('connect_error', (err) => {
    console.warn('[ws] connect_error', err.message);
  });
  socket.on('error', (err: unknown) => {
    console.warn('[ws] error', err);
  });

  // Đăng ký listener cho mỗi loại event ở phía client.
  const events: WsEventType[] = [
    'state:update',
    'cultivate:tick',
    'logs:append',
    'marquee',
    'chat:msg',
    'boss:spawn',
    'boss:update',
    'boss:end',
    'boss:defeated',
    'mail:new',
    'mission:progress',
    // Phase 15.3.B — LiveOps announcement / event broadcast channels.
    'liveops:announcement',
    'liveops:event',
    'pong',
  ];
  for (const ev of events) {
    socket.on(ev, (frame: WsFrame) => dispatch(ev, frame));
  }

  return socket;
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
}

export function emit<T>(type: WsEventType, payload: T): void {
  socket?.emit(type, payload);
}

export type StateFrame = WsFrame<CharacterStatePayload>;
export type TickFrame = WsFrame<CultivateTickPayload>;
