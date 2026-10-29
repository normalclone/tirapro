import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { peekSearch } from '@/lib/rowOpen';
import { PEEK_PARAM } from './peekParam';
import { isPeekSheetViewport, peekNavPlan } from './peekSheetLogic';

/** Cờ trong `location.state` của mục lịch sử do việc mở sheet đẩy vào — để đóng sheet thì lùi đúng một mục đó. */
const PUSHED_STATE = { peekPushed: true } as const;
const isPushed = (state: unknown): boolean =>
  !!state && typeof state === 'object' && (state as { peekPushed?: unknown }).peekPushed === true;

export function useIssuePeek() {
  const loc = useLocation();
  const { search, pathname } = loc;
  const state: unknown = loc.state; // `any` của react-router → unknown (đọc có kiểm ở isPushed)
  const navigate = useNavigate();
  // `open`/`close` phải ổn định: dòng Việc chờ là memo và so sánh `onOpen`.
  const ref = useRef({ search, pathname, state, navigate });
  ref.current = { search, pathname, state, navigate };
  const go = useCallback((key: string | null) => {
    const c = ref.current;
    const plan = peekNavPlan({
      sheet: isPeekSheetViewport(),
      hasPeek: !!new URLSearchParams(c.search).get(PEEK_PARAM),
      pushed: isPushed(c.state),
      key,
    });
    if (plan === 'noop') return;
    // Sheet đáy (dưới md): mở = đẩy một mục lịch sử, Back/đóng lùi đúng mục đó; còn lại giữ `replace` như panel phi-modal.
    if (plan === 'back') return c.navigate(-1);
    const to = { pathname: c.pathname, search: peekSearch(c.search, key) };
    if (plan === 'push') c.navigate(to, { state: PUSHED_STATE });
    else c.navigate(to, { replace: true, state: isPushed(c.state) ? c.state : undefined });
  }, []);
  const open = useCallback((key: string) => go(key), [go]);
  const close = useCallback(() => go(null), [go]);
  const peekKey = new URLSearchParams(search).get(PEEK_PARAM);
  return { peekKey: peekKey || null, open, close };
}
