import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { CardBody } from './Card';
import { CardDisplayPanel } from './CardDisplayPopover';
import {
  DEFAULT_CARD_DISPLAY,
  CARD_FIELDS,
  setDensity,
  toggleField,
  type CardDisplay,
} from './cardDisplay';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const issue = {
  id: 'i1',
  key: 'TP-7',
  summary: 'Sửa lỗi đăng nhập trên Safari',
  type: { id: 't', name: 'Lỗi', color: '#c00', icon: null },
  priority: { id: 'p', name: 'Cao', rank: 2, color: '#c60' },
  assignee: { id: 'u', displayName: 'Lan Anh', avatarUrl: null },
  storyPoints: 5,
  dueDate: null,
  severity: null,
  acceptanceProgress: null,
  labels: [
    { id: 'l1', name: 'web', color: null },
    { id: 'l2', name: 'auth', color: null },
    { id: 'l3', name: 'safari', color: null },
    { id: 'l4', name: 'p1', color: null },
  ],
} as unknown as IssueDto;
const progress = { done: 1, total: 4 } as never;

function body(display?: CardDisplay) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CardBody issue={issue} progress={progress} display={display} />
    </QueryClientProvider>,
  );
}

describe('CardBody theo tuỳ chọn hiển thị', () => {
  const normal = body();
  it('không truyền gì = mặc định = giao diện cũ (đệm p-2.5, tiêu đề 2 dòng, đủ trường)', () => {
    expect(body(DEFAULT_CARD_DISPLAY)).toBe(normal);
    expect(normal).toContain('p-2.5');
    expect(normal).toContain('line-clamp-2');
    expect(normal).toContain('Lan Anh');
    expect(normal).toContain('web');
    expect(normal).toContain('+1'); // 4 nhãn, hiện 3
    expect(normal).toContain('1/4');
    expect(normal).toContain('title="5 điểm ước lượng');
    expect(normal).toContain('TP-7');
    expect(normal).toContain('Sửa lỗi đăng nhập trên Safari');
  });
  it('gọn: đệm nhỏ hơn, tiêu đề 1 dòng, tối đa 2 nhãn', () => {
    const h = body(setDensity(DEFAULT_CARD_DISPLAY, 'compact'));
    expect(h).toContain('p-2 ');
    expect(h).not.toContain('p-2.5');
    expect(h).toContain('line-clamp-1');
    expect(h).toContain('+2');
  });
  it.each([
    ['assignee', 'Lan Anh'],
    ['points', 'điểm ước lượng'],
    ['labels', 'Nhãn: web'],
    ['progress', '1/4'],
    ['priority', 'Cao'],
  ] as const)('tắt %s → mất khỏi thẻ, mã + tiêu đề vẫn còn', (id, text) => {
    expect(normal).toContain(text);
    const h = body(toggleField(DEFAULT_CARD_DISPLAY, id));
    expect(h).not.toContain(text);
    expect(h).toContain('TP-7');
    expect(h).toContain('Sửa lỗi đăng nhập trên Safari');
  });
  it('mọi trường tắt vẫn còn mã + tiêu đề + loại', () => {
    let d = DEFAULT_CARD_DISPLAY;
    for (const f of CARD_FIELDS) d = toggleField(d, f.id);
    const h = body(d);
    expect(h).toContain('TP-7');
    expect(h).toContain('Sửa lỗi đăng nhập trên Safari');
    expect(h).toContain('Lỗi');
    expect(h).not.toContain('Lan Anh');
  });
});

describe('cảnh báo hạn luôn hiện, bất kể tuỳ chọn', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
  const allOff = (() => {
    let d = setDensity(DEFAULT_CARD_DISPLAY, 'compact');
    for (const f of CARD_FIELDS) d = toggleField(d, f.id);
    return d;
  })();
  const render = (dueDate: string, display: CardDisplay) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CardBody issue={{ ...issue, dueDate }} display={display} />
      </QueryClientProvider>,
    );
  const settings: [string, CardDisplay][] = [
    ['mặc định', DEFAULT_CARD_DISPLAY],
    ['gọn', setDensity(DEFAULT_CARD_DISPLAY, 'compact')],
    ['mọi trường tắt + gọn', allOff],
  ];
  it.each(settings)('quá hạn (%s): viền đỏ + huy hiệu "Quá hạn"', (_n, d) => {
    const h = render(day(-3), d);
    expect(h).toContain('border-danger');
    expect(h).toContain('Quá hạn');
  });
  it.each(settings)('sắp đến hạn (%s): viền hổ phách + huy hiệu hạn', (_n, d) => {
    const h = render(day(1), d);
    expect(h).toContain('border-warning');
    expect(h).toMatch(/text-warning/);
  });
  it('hạn còn xa: không viền cảnh báo (như trước)', () => {
    const h = render(day(30), DEFAULT_CARD_DISPLAY);
    expect(h).not.toContain('border-danger');
    expect(h).not.toContain('border-warning');
  });
  it('popover không có công tắc Hạn', () => {
    const h = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CardDisplayPanel
          display={DEFAULT_CARD_DISPLAY}
          onChange={() => undefined}
          onReset={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(h).not.toMatch(/id="[^"]*-label"[^>]*>Hạn</);
  });
});

describe('CardDisplayPanel', () => {
  const panel = (display: CardDisplay = DEFAULT_CARD_DISPLAY) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CardDisplayPanel display={display} onChange={() => undefined} onReset={() => undefined} />
      </QueryClientProvider>,
    );
  it('mật độ Thường/Gọn là radiogroup có tên; mỗi trường là công tắc có tên', () => {
    const h = panel();
    expect(h).toMatch(/role="radiogroup"[^>]*aria-labelledby="[^"]+"/);
    expect(h).toContain('Thường');
    expect(h).toContain('Gọn');
    expect((h.match(/role="switch"/g) ?? []).length).toBe(CARD_FIELDS.length);
    for (const f of CARD_FIELDS) expect(h).toContain(`>${f.label}<`);
  });
  it('nói rõ mã + tiêu đề luôn hiện, chỉ áp cho riêng bạn; có xem trước và nút đặt lại', () => {
    const h = panel();
    expect(h).toContain('Mã và tiêu đề luôn hiện');
    expect(h).toContain('chỉ áp cho bạn');
    expect(h).toContain('Xem trước');
    expect(h).toContain('Đặt lại mặc định');
  });
  it('đang mặc định → "Đặt lại mặc định" aria-disabled (giữ focus), khác mặc định → bình thường', () => {
    const reset = (h: string) => /<button[^>]*>Đặt lại mặc định<\/button>/.exec(h)![0];
    expect(reset(panel())).toContain('aria-disabled="true"');
    expect(reset(panel(setDensity(DEFAULT_CARD_DISPLAY, 'compact')))).not.toContain(
      'aria-disabled',
    );
  });
  it('nhãn "Xem trước" cũng ẩn khỏi trình đọc màn hình (khối nó mô tả đã aria-hidden)', () => {
    expect(panel()).toMatch(/<p[^>]*aria-hidden="true"[^>]*>Xem trước<\/p>/);
  });
  it('xem trước không phải điều khiển: ẩn khỏi trình đọc màn hình, không bấm/focus được', () => {
    const h = panel();
    expect(h).toMatch(
      /aria-hidden="true"[^>]*pointer-events-none|pointer-events-none[^>]*aria-hidden="true"/,
    );
    expect(h).not.toContain('role="button"');
  });
});

describe('nối vào Bảng việc (đọc source)', () => {
  const page = read('BoardPage.tsx');
  it('nút Hiển thị nằm trong ToolbarStrip; context bọc BoardDnd (DragOverlay cũng nhận cùng tuỳ chọn)', () => {
    expect(page).toContain('<CardDisplayPopover');
    expect(page).toMatch(
      /<CardDisplayContext\.Provider[^>]*>\s*(<BulkSelectionContext\.Provider[^>]*>\s*)?<BoardDnd/,
    );
    expect(page.indexOf('<CardDisplayPopover')).toBeGreaterThan(page.indexOf('<ToolbarStrip'));
    expect(page.indexOf('<CardDisplayPopover')).toBeLessThan(page.indexOf('</ToolbarStrip>'));
  });
  it('giá trị context là đối tượng ổn định (useCardDisplay), không dựng mới mỗi lần vẽ', () => {
    const hook = read('useCardDisplay.ts');
    expect(page).toContain('useCardDisplay(');
    expect(hook).toContain('useSyncExternalStore');
    expect(hook).toContain('useMemo');
    // mọi chạm vào storage đi qua hàm có try/catch của module thuần
    expect(hook).toContain('readCardDisplayRaw');
    expect(hook).toContain('writeCardDisplay');
    expect(hook).not.toMatch(/localStorage\./);
    expect(read('cardDisplay.ts').match(/try\s*{/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('Card vẫn memo, đọc tuỳ chọn qua context (không thêm prop làm đổi so sánh), giữ highlight xem nhanh', () => {
    const card = read('Card.tsx');
    expect(card).toContain('useContext(CardDisplayContext)');
    expect(card).toContain('PEEKED_ROW_CLS');
    expect(card).toContain('peekedAttrs(peeked)');
    expect(card).toMatch(/export const Card = memo\(/);
    expect(card).not.toMatch(/prev\.display/);
    expect(read('Column.tsx')).not.toMatch(/display/i);
  });
  it('dưới sm: "Xem trước" lên đầu và dính mép trên khi cuộn; từ sm giữ thứ tự cũ', () => {
    const pop = read('CardDisplayPopover.tsx');
    expect(pop).toContain('flex flex-col gap-4');
    for (const c of [
      'max-sm:order-first',
      'max-sm:sticky',
      'max-sm:top-0',
      'z-10',
      'bg-surface',
      'max-sm:border-b',
    ]) {
      expect(pop).toContain(c);
    }
    expect(pop).not.toMatch(/[\s"`]sm:(order|sticky)/);
  });
  it('việc mẫu không mang trường status (không cần tên nhóm trạng thái)', () => {
    expect(read('CardDisplayPopover.tsx')).not.toMatch(/\bstatus:/);
  });
  it('chip Hiển thị đứng trước "Nhóm theo người" để còn nhìn thấy ở dải cuộn ngang của mobile', () => {
    expect(page.indexOf('<CardDisplayPopover')).toBeLessThan(
      page.indexOf('onClick={toggleAssignee}'),
    );
    expect(page.indexOf('<CardDisplayPopover')).toBeGreaterThan(page.indexOf('<AssigneeFilter'));
  });
  it('nút kích hoạt: chữ nhìn thấy làm tên, vùng bấm 44px trên cảm ứng', () => {
    const pop = read('CardDisplayPopover.tsx');
    expect(pop).toContain('Popover.Trigger');
    expect(pop).toContain('CHIP_TOUCH_HIT');
    expect(pop).toMatch(/>\s*Hiển thị\s*</);
    expect(pop).not.toMatch(/aria-label="(?!")/); // tên = chữ nhìn thấy, không nhãn aria khác
  });
});
