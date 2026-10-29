import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BulletBar } from './BulletBar';

const html = (p: Partial<Parameters<typeof BulletBar>[0]> = {}) =>
  renderToStaticMarkup(
    <BulletBar
      label="Hoàn thành"
      value={30}
      target={40}
      targetLabel="cam kết"
      unit="điểm"
      {...p}
    />,
  );

describe('<BulletBar>', () => {
  it('role=meter, tên, giá trị ARIA hợp lệ, valuetext đầy đủ (không chỉ màu)', () => {
    const h = html();
    expect(h).toMatch(/role="meter"/);
    expect(h).toMatch(/aria-label="Hoàn thành"/);
    expect(h).toMatch(/aria-valuemin="0"/);
    expect(h).toMatch(/aria-valuemax="40"/);
    expect(h).toMatch(/aria-valuenow="30"/);
    expect(h).toContain(
      'aria-valuetext="Hoàn thành: 30 điểm, cam kết 40 điểm, so với cam kết −10 điểm"',
    );
  });
  it('vượt đích: valuenow kẹp ≤ valuemax, số thật ở valuetext', () => {
    const h = html({ value: 50, max: 40 });
    expect(h).toMatch(/aria-valuenow="40"/);
    expect(h).toMatch(/aria-valuemax="40"/);
    expect(h).toContain('Hoàn thành: 50 điểm');
  });
  it('vạch đích có nét đậm + dòng chữ "so với cam kết ±n" nhìn thấy được (aria-hidden: đã nằm trong valuetext)', () => {
    const h = html();
    expect(h).toMatch(/left:100%/);
    expect(h).toMatch(/<p aria-hidden="true"[^>]*>so với cam kết −10 điểm<\/p>/);
    expect(h).toMatch(/bg-ink-strong/);
  });
  it('showDelta={false} ẩn dòng chữ nhưng valuetext vẫn đủ', () => {
    const h = html({ showDelta: false });
    expect(h).not.toMatch(/<p /);
    expect(h).toContain('so với cam kết −10 điểm');
  });
  it('không có đích → chỉ thanh (không vạch, không dòng chênh lệch)', () => {
    const h = renderToStaticMarkup(<BulletBar label="Hoàn tất" value={9} max={30} />);
    expect(h).toContain('aria-valuetext="Hoàn tất: 9/30"');
    expect(h).not.toMatch(/bg-ink-strong/);
    expect(h).not.toMatch(/<p /);
    expect(h).toMatch(/width:30%/);
  });
  it('thanh theo tỉ lệ; tông không có gradient', () => {
    expect(html({ tone: 'done' })).toMatch(/bg-status-done/);
    expect(html()).not.toMatch(/gradient/);
    expect(html()).toMatch(/width:75%/);
  });
  it('marker phụ vẽ vạch nhạt có tên', () => {
    const h = html({ value: 20, target: 40, markers: [{ at: 30, label: 'lúc bắt đầu' }] });
    expect(h).toContain('lúc bắt đầu 30 điểm');
    expect(h).toMatch(/left:75%/);
  });
});
