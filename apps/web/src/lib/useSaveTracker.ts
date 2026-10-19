import { useCallback, useMemo, useReducer } from 'react';
import { deriveSaveStatus, saveTrackReducer, type SaveStatusState } from './saveStatus';

/** Hook mỏng quanh `saveTrackReducer`: `start()` khi gửi, `ok()` / `fail()` khi xong. Hàm trả về ổn định giữa các lần render. */
export function useSaveTracker(): {
  status: SaveStatusState;
  start: () => void;
  ok: () => void;
  fail: () => void;
} {
  const [track, dispatch] = useReducer(saveTrackReducer, {
    inFlight: 0,
    last: 'none',
    savedAt: null,
  });
  const start = useCallback(() => dispatch({ type: 'start' }), []);
  const ok = useCallback(() => dispatch({ type: 'ok', at: Date.now() }), []);
  const fail = useCallback(() => dispatch({ type: 'fail' }), []);
  const status = useMemo(() => deriveSaveStatus(track), [track]);
  return { status, start, ok, fail };
}
