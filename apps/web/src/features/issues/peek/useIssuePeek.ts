import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { peekSearch } from '@/lib/rowOpen';
import { PEEK_PARAM } from './peekParam';

export function useIssuePeek() {
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  // `open`/`close` phải ổn định: dòng Việc chờ là memo và so sánh `onOpen`.
  const ref = useRef({ search, pathname, navigate });
  ref.current = { search, pathname, navigate };
  const go = useCallback((key: string | null) => {
    const c = ref.current;
    c.navigate({ pathname: c.pathname, search: peekSearch(c.search, key) }, { replace: true });
  }, []);
  const open = useCallback((key: string) => go(key), [go]);
  const close = useCallback(() => go(null), [go]);
  const peekKey = new URLSearchParams(search).get(PEEK_PARAM);
  return { peekKey: peekKey || null, open, close };
}
