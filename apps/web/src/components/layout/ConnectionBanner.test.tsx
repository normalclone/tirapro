import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionBannerView } from './ConnectionBanner';

const html = (phase: Parameters<typeof ConnectionBannerView>[0]['phase'], pending = 0) =>
  renderToStaticMarkup(<ConnectionBannerView phase={phase} pausedCount={pending} />);

describe('ConnectionBannerView', () => {
  it('luôn có vùng live role=status aria-live=polite (kể cả khi ẩn, để thông báo chữ mới)', () => {
    for (const p of ['hidden', 'paused', 'offline', 'restored', 'stopped'] as const) {
      const h = html(p);
      expect(h).toContain('role="status"');
      expect(h).toContain('aria-live="polite"');
    }
  });
  it('ẩn → không có chữ', () => {
    expect(html('hidden').replace(/<[^>]+>/g, '')).toBe('');
  });
  it('WS đứt, REST còn: nói cập nhật tạm dừng + thay đổi vẫn được lưu; không nói lưu lỗi', () => {
    const t = html('paused');
    expect(t).toContain('Mất kết nối thời gian thực — đang thử lại… (thay đổi vẫn được lưu)');
    expect(t).not.toMatch(/không (thể )?lưu|lưu (thất bại|lỗi)/i);
  });
  it('chỉ khi offline thật mới nói không có mạng, trung thực về việc giữ trang', () => {
    const t = html('offline');
    expect(t).toContain('Không có mạng');
    expect(t).toContain('thay đổi sẽ được gửi khi có mạng lại');
    expect(t).toContain('Giữ trang này mở');
    expect(html('paused')).not.toContain('Không có mạng');
  });
  it('đếm thay đổi chờ gửi (chỉ khi > 0)', () => {
    expect(html('offline', 2)).toContain('2 thay đổi đang chờ gửi');
    expect(html('offline', 0)).not.toContain('đang chờ gửi');
  });
  it('restored: "Đã kết nối lại", sắc thành công; mất kết nối: sắc cảnh báo như MaintenanceBanner', () => {
    expect(html('restored')).toContain('Đã kết nối lại');
    expect(html('restored')).toContain('bg-success/10');
    expect(html('paused')).toContain('border-warning/30 bg-warning/10');
  });
  it('đếm chờ gửi KHÔNG nằm trong vùng live (đổi số không đọc lại): chỉ ở chữ aria-hidden', () => {
    const h = html('offline', 3);
    const live = /<div role="status"[^>]*>([\s\S]*?)<\/div>/.exec(h)?.[1] ?? '';
    expect(live).not.toContain('đang chờ gửi');
    expect(live).toContain('Không có mạng');
    expect(h.replace(/<!-- -->/g, '')).toMatch(
      /aria-hidden="true"[^>]*>[^<]*3 thay đổi đang chờ gửi/,
    );
  });
  it('hết lượt nối lại ("stopped"): chữ ổn định + nút phụ "Tải lại"; các pha khác KHÔNG có nút', () => {
    const t = html('stopped');
    expect(t).toContain('Mất kết nối thời gian thực — tải lại trang để thử lại');
    expect(t).not.toContain('đang thử lại');
    expect(t).toMatch(/<button[^>]*>[^<]*Tải lại/);
    expect(t).toContain('border-border'); // Button variant secondary
    for (const p of ['hidden', 'paused', 'offline', 'restored'] as const)
      expect(html(p)).not.toContain('<button');
  });
  it('không che nội dung (không fixed/absolute)', () => {
    for (const p of ['paused', 'offline', 'restored', 'stopped'] as const)
      expect(html(p)).not.toMatch(/\b(fixed|absolute)\b/);
  });
});
