import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionBannerView } from './ConnectionBanner';

const html = (phase: Parameters<typeof ConnectionBannerView>[0]['phase'], pending = 0) =>
  renderToStaticMarkup(<ConnectionBannerView phase={phase} pausedCount={pending} />);

describe('ConnectionBannerView', () => {
  it('luôn có vùng live role=status aria-live=polite (kể cả khi ẩn, để thông báo chữ mới)', () => {
    for (const p of ['hidden', 'paused', 'offline', 'restored'] as const) {
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
  it('không có nút (không "Tải lại"), không che nội dung (không fixed/absolute)', () => {
    for (const p of ['paused', 'offline', 'restored'] as const) {
      const h = html(p);
      expect(h).not.toContain('<button');
      expect(h).not.toMatch(/\b(fixed|absolute)\b/);
    }
  });
});
