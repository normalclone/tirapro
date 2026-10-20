import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('254 · hộp chia sẻ bảng tổng quan', () => {
  it('ShareDialog ghép SharePanel (bộ chọn mức + ai có quyền + sao chép liên kết); không còn khối radio/chọn tự viết', () => {
    const s = src('ShareDialog.tsx');
    expect(s).toContain("from '@/features/sharing/SharePanel'");
    expect(s).not.toContain('RadioCard');
    expect(s).not.toContain('SearchSelect');
  });
  it('vẫn xuất ShareValue (DashboardEditor import từ đây) và kiểm hợp lệ bằng shareValidation trước khi cho "Xong"', () => {
    const s = src('ShareDialog.tsx');
    expect(s).toMatch(/export type \{ ShareValue \}|export interface ShareValue/);
    expect(s).toContain('shareValidation(');
  });
  it('DashboardEditor chỉ truyền `link` khi đã lưu (có dashboard) và dùng dashboardUrl', () => {
    const s = src('DashboardEditor.tsx');
    expect(s).toContain('dashboardUrl(');
    expect(s).toContain('link={shareLinkOf(dashboard, saved)}');
    expect(s).toMatch(/if \(!dashboard\) return undefined;/);
  });
});
