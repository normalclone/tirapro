import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatRow, type StatItem } from './StatRow';

const html = (items: StatItem[], p: Partial<Parameters<typeof StatRow>[0]> = {}) =>
  renderToStaticMarkup(<StatRow items={items} {...p} />);

describe('<StatRow>', () => {
  const items: StatItem[] = [
    { label: 'Tổng công việc', value: 30 },
    { label: 'Quá hạn', value: 4, tone: 'danger', highlight: true, sub: 'trên 21 việc chưa xong' },
    { label: 'Hoàn thành', value: '34 điểm', tone: 'done', title: 'Giải nghĩa' },
  ];
  it('mỗi ô: nhãn + số cỡ vừa (text-lg), không còn text-2xl/3xl/4xl', () => {
    const h = html(items);
    expect(h).toContain('Tổng công việc');
    expect(h).toMatch(/text-lg font-semibold/);
    expect(h).not.toMatch(/text-(2|3|4)xl/);
  });
  it('highlight, sub, title; hàng không bị ngắt khi in', () => {
    const h = html(items);
    expect(h).toMatch(/bg-danger\/5/);
    expect(h).toContain('trên 21 việc chưa xong');
    expect(h).toContain('title="Giải nghĩa"');
    expect(h).toMatch(/print-avoid-break/);
  });
  it('ô có bullet vẽ BulletBar (role=meter) tên = nhãn ô; ô không đích không có thanh', () => {
    const h = html([
      { label: 'Tổng công việc', value: 30 },
      {
        label: 'Hoàn thành',
        value: '34 điểm',
        bullet: { value: 34, target: 40, targetLabel: 'cam kết', unit: 'điểm' },
      },
    ]);
    expect(h.match(/role="meter"/g)).toHaveLength(1);
    expect(h).toMatch(/aria-label="Hoàn thành"/);
    expect(h).toContain('so với cam kết −6 điểm');
  });
  it('số cột mặc định theo số ô; ô lẻ cuối chiếm 2 cột trên mobile; cols ghi đè', () => {
    expect(html(items)).toMatch(/sm:grid-cols-3/);
    expect(html(items)).toMatch(/max-sm:col-span-2/);
    const h = html(items, { cols: 'lg:grid-cols-5', className: 'mt-2' });
    expect(h).toMatch(/lg:grid-cols-5/);
    expect(h).not.toMatch(/sm:grid-cols-3/);
    expect(h).toMatch(/mt-2/);
  });
  it('tone primary/warning/bug có màu chữ', () => {
    const h = html([
      { label: 'a', value: 1, tone: 'primary' },
      { label: 'b', value: 2, tone: 'warning' },
      { label: 'c', value: 3, tone: 'bug' },
    ]);
    expect(h).toMatch(/text-primary/);
    expect(h).toMatch(/text-warning/);
    expect(h).toMatch(/text-danger/);
  });
});

describe('<StatRow> — bảng tone → class (ghim; so với các bản cũ của Tổng quan/Báo cáo)', () => {
  const TONES = {
    default: 'text-ink-strong',
    progress: 'text-status-progress',
    done: 'text-status-done',
    danger: 'text-danger',
    // text-warning ~2.4:1 trên nền sáng → không đạt AA ở cỡ chữ này; bản Báo cáo cũ dùng warning-ink.
    warning: 'text-warning-ink',
    bug: 'text-danger',
    primary: 'text-primary',
  } as const;
  for (const [tone, cls] of Object.entries(TONES)) {
    it(`tone ${tone} → ${cls}`, () => {
      const h = html([{ label: 'x', value: 1, tone: tone as StatItem['tone'] }]);
      expect(h).toMatch(new RegExp(`text-lg font-semibold[^"]*${cls}\\b|${cls}\\b[^"]*text-lg`));
    });
  }
  it('không tone nào dùng text-warning trơn (không đạt AA)', () => {
    for (const tone of Object.keys(TONES)) {
      expect(html([{ label: 'x', value: 1, tone: tone as StatItem['tone'] }])).not.toMatch(
        /text-warning(?!-ink)/,
      );
    }
  });
});

describe('<StatRow bare> — ô nằm trong khung ô dashboard (không đệm/viền thứ hai)', () => {
  it('bare bỏ viền, bo góc, nền và đệm của ô', () => {
    const h = html([{ label: 'Quá hạn', value: 3 }], { bare: true, cols: 'grid-cols-1' });
    expect(h).not.toMatch(/border-border/);
    expect(h).not.toMatch(/rounded-lg/);
    expect(h).not.toMatch(/px-4 py-2\.5/);
    expect(h).toMatch(/p-0/);
  });
  it('bare + highlight: KHÔNG tô nền hồng sát mép (chỉ chữ/thanh đỏ báo hiệu)', () => {
    const h = html([{ label: 'Quá hạn', value: 3, tone: 'danger', highlight: true }], {
      bare: true,
      cols: 'grid-cols-1',
    });
    expect(h).not.toMatch(/bg-danger\/5/);
    expect(h).toMatch(/text-danger/);
  });
  it('không bare + highlight vẫn có nền nhấn', () => {
    expect(html([{ label: 'Quá hạn', value: 3, highlight: true }])).toMatch(/bg-danger\/5/);
  });
  it('mặc định vẫn có viền + đệm', () => {
    const h = html([{ label: 'Quá hạn', value: 3 }]);
    expect(h).toMatch(/border-border/);
    expect(h).toMatch(/px-4 py-2\.5/);
  });
});
