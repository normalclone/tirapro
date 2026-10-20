import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonOptionRow } from './PersonOptionRow';
import type { PersonOption } from './PeoplePicker';

const person: PersonOption = {
  id: 'u1',
  name: 'Lan Phạm',
  position: 'Lập trình viên',
  teams: [{ name: 'Web' }],
  search: 'lan',
};
const render = (hint: Parameters<typeof PersonOptionRow>[0]['hint']) =>
  renderToStaticMarkup(
    <PersonOptionRow option={person} active={false} onPick={() => undefined} hint={hint} />,
  );

describe('PersonOptionRow — "còn trống" là phụ, TÊN vẫn là tên truy cập (Task 7)', () => {
  it('có gợi ý: tên truy cập = aria-labelledby tên; gợi ý qua aria-describedby; chữ hiển thị đủ', () => {
    const h = render({ kind: 'free', text: 'còn trống ~6 giờ/tuần' });
    const labelledby = h.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedby = h.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    expect(h).toMatch(new RegExp(`id="${labelledby}"[^>]*>Lan Phạm<`));
    expect(h).toMatch(new RegExp(`id="${describedby}"[^>]*>còn trống ~6 giờ/tuần<`));
    expect(h).not.toContain('aria-label="');
  });
  it('quá tải hiện chữ "quá tải ~N giờ" (không chỉ màu)', () => {
    const h = render({ kind: 'over', text: 'quá tải ~6 giờ' });
    expect(h).toContain('quá tải ~6 giờ');
    expect(h).toContain('text-danger');
  });
  it('không có dữ liệu (hint null/undefined): không gợi ý, không aria-labelledby/describedby thừa — như trước', () => {
    for (const h of [render(null), render(undefined)]) {
      expect(h).not.toContain('aria-describedby');
      expect(h).not.toContain('aria-labelledby');
      expect(h).toContain('Lan Phạm');
      expect(h).toContain('Lập trình viên');
    }
  });
  it('vẫn là option của listbox, chọn được', () => {
    const h = render({ kind: 'free', text: 'còn trống ~6 giờ/tuần' });
    expect(h).toContain('role="option"');
    expect(h).toContain('aria-selected="false"');
  });
});
