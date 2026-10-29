import { fmtTime } from './dateFormat';

/**
 * Trạng thái lưu tự động hiển thị cạnh nơi lưu tức thì (công tắc, ô sửa tại chỗ): chưa lưu gì → lưu → đã lưu lúc… → lỗi.
 * Theo dõi bằng bộ đếm (nhiều lần lưu có thể chồng nhau): chỉ "Đã lưu"/"Lỗi" khi MỌI lần gửi đã xong; lỗi/ok của lần cuối
 * quyết định chữ hiện.
 */
export type SaveStatusState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error' };

export interface SaveTrack {
  /** Số lần lưu đang chạy. */
  inFlight: number;
  /** Kết quả của lần lưu xong gần nhất. */
  last: 'none' | 'ok' | 'error';
  /** Mốc (ms) lần lưu thành công gần nhất. */
  savedAt: number | null;
}

export type SaveTrackAction = { type: 'start' } | { type: 'ok'; at: number } | { type: 'fail' };

export function saveTrackReducer(t: SaveTrack, a: SaveTrackAction): SaveTrack {
  const inFlight = a.type === 'start' ? t.inFlight + 1 : Math.max(0, t.inFlight - 1);
  if (a.type === 'start') return { ...t, inFlight };
  if (a.type === 'ok') return { inFlight, last: 'ok', savedAt: a.at };
  return { ...t, inFlight, last: 'error' };
}

export function deriveSaveStatus(t: SaveTrack): SaveStatusState {
  if (t.inFlight > 0) return { state: 'saving' };
  if (t.last === 'error') return { state: 'error' };
  if (t.last === 'ok' && t.savedAt !== null) return { state: 'saved', at: t.savedAt };
  return { state: 'idle' };
}

/** Chữ hiển thị (không gồm định dạng): "Đang lưu…" / "Đã lưu lúc HH:mm" / "Lỗi · Thử lại"; idle → ''. */
export function saveStatusText(s: SaveStatusState): string {
  switch (s.state) {
    case 'saving':
      return 'Đang lưu…';
    case 'saved':
      return `Đã lưu lúc ${fmtTime(s.at)}`;
    case 'error':
      return 'Lỗi · Thử lại';
    default:
      return '';
  }
}
