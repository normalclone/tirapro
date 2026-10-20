/**
 * Một lời gọi huỷ được phía client (không stream): `AbortController` cắt request đang chờ, và một số thứ tự bảo đảm phản hồi
 * ĐẾN MUỘN sau khi huỷ (hoặc sau khi bị lần gọi mới thay) bị bỏ qua — không bao giờ hiện kết quả/lỗi của lần đã huỷ.
 * Lưu ý: huỷ chỉ ngừng CHỜ; yêu cầu đã tới máy chủ vẫn có thể chạy và tính vào hạn mức AI.
 */
export type RunOutcome<T> =
  | { kind: 'done'; value: T }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: unknown };

export function createCancellable<T>(send: (signal: AbortSignal) => Promise<T>) {
  let seq = 0;
  let current: { id: number; ctrl: AbortController } | null = null;
  return {
    start(): Promise<RunOutcome<T>> {
      current?.ctrl.abort(); // lần cũ còn chạy → bị thay: huỷ và bỏ kết quả
      const id = ++seq;
      const ctrl = new AbortController();
      current = { id, ctrl };
      const stale = () => id !== seq || ctrl.signal.aborted;
      const finish = () => {
        if (current?.id === id) current = null;
      };
      return send(ctrl.signal).then(
        (value): RunOutcome<T> => {
          const gone = stale();
          finish();
          return gone ? { kind: 'cancelled' } : { kind: 'done', value };
        },
        (error: unknown): RunOutcome<T> => {
          const gone = stale();
          finish();
          return gone ? { kind: 'cancelled' } : { kind: 'failed', error };
        },
      );
    },
    cancel(): void {
      if (!current) return;
      seq++; // mọi phản hồi của lần đang chạy thành "muộn"
      current.ctrl.abort();
      current = null;
    },
    active: () => current !== null,
  };
}

export type RequestState<T> =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'done'; data: T }
  | { phase: 'failed'; error: unknown };

export type RequestAction<T> =
  | { type: 'start' }
  | { type: 'done'; value: T }
  | { type: 'failed'; error: unknown }
  | { type: 'cancel' };

export const initialRequestState = <T>(): RequestState<T> => ({ phase: 'idle' });

/** Bắt đầu xoá kết quả cũ; huỷ về idle (không giữ lỗi); done/failed chỉ nhận khi còn pending (đã huỷ thì bỏ). */
export function requestReducer<T>(s: RequestState<T>, a: RequestAction<T>): RequestState<T> {
  switch (a.type) {
    case 'start':
      return { phase: 'pending' };
    case 'cancel':
      return { phase: 'idle' };
    case 'done':
      return s.phase === 'pending' ? { phase: 'done', data: a.value } : s;
    case 'failed':
      return s.phase === 'pending' ? { phase: 'failed', error: a.error } : s;
  }
}
