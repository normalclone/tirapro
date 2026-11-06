// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useIssuePeek } from './useIssuePeek';

let api: ReturnType<typeof useIssuePeek>;
let where = '';
function Probe() {
  api = useIssuePeek();
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}
const mount = (url = '/p/A/board') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  );
afterEach(cleanup);

describe('useIssuePeek — bấm lại việc đang xem nhanh', () => {
  it('bấm lần 1 mở xem nhanh; bấm lần 2 đúng việc đó (hoặc bấm đúp) → trang chi tiết', () => {
    mount();
    act(() => api.open('A-1', { fromClick: true }));
    expect(where).toBe('/p/A/board?peek=A-1');
    act(() => api.open('A-1', { fromClick: true }));
    expect(where).toBe('/issue/A-1');
  });
  it('bấm việc KHÁC khi đang xem nhanh → chỉ đổi việc xem nhanh', () => {
    mount('/p/A/board?peek=A-1');
    act(() => api.open('A-2', { fromClick: true }));
    expect(where).toBe('/p/A/board?peek=A-2');
  });
  it('mở không phải từ bấm chuột (Enter, menu, ‹ ›) lên việc đang xem → giữ xem nhanh', () => {
    mount('/p/A/board?peek=A-1');
    act(() => api.open('A-1'));
    expect(where).toBe('/p/A/board?peek=A-1');
  });
});
