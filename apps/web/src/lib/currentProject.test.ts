import { describe, expect, it } from 'vitest';
import {
  resolveCreateTarget,
  resolveCurrentProjectKey,
  safeDecode,
  createAccess,
  issueKeyFromPathname,
} from './currentProject';

const projects = [{ key: 'AAA' }, { key: 'BBB' }];
const r = (
  pathname: string,
  lastViewRaw: string | null = null,
  p: { key: string }[] | undefined = projects,
) => resolveCurrentProjectKey({ pathname, projects: p, lastViewRaw });

describe('resolveCurrentProjectKey', () => {
  it('lấy key từ /p/:key', () => expect(r('/p/BBB/board')).toBe('BBB'));
  it('giải mã %-escape hợp lệ', () => expect(r('/p/A%20B/board')).toBe('A B'));
  it('URL hỏng (%E0%A4%A) không ném lỗi, dùng nguyên chuỗi', () => {
    expect(() => r('/p/%E0%A4%A/board')).not.toThrow();
    expect(r('/p/%E0%A4%A/board')).toBe('%E0%A4%A');
  });
  it('ngoài /p → view gần nhất nếu dự án còn tồn tại', () =>
    expect(r('/issue/AAA-1', JSON.stringify({ key: 'BBB', view: 'board' }))).toBe('BBB'));
  it('view gần nhất trỏ dự án đã mất / JSON hỏng → dự án đầu', () => {
    expect(r('/', JSON.stringify({ key: 'ZZZ' }))).toBe('AAA');
    expect(r('/', '{hỏng')).toBe('AAA');
  });
  it('chưa có danh sách dự án → null', () =>
    expect(
      resolveCurrentProjectKey({ pathname: '/', projects: undefined, lastViewRaw: null }),
    ).toBeNull());
});

describe('safeDecode', () => {
  it('không ném lỗi', () => expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A'));
});

describe('resolveCreateTarget', () => {
  const active = [{ key: 'DEMO' }, { key: 'QAI' }];
  it('dự án hiện tại đang hoạt động => giữ nguyên, không thông báo', () => {
    expect(resolveCreateTarget('QAI', active)).toEqual({ projectKey: 'QAI' });
  });
  it('dự án hiện tại không nằm trong danh sách đang hoạt động (đã lưu trữ) => dự án đầu tiên + thông báo', () => {
    const r = resolveCreateTarget('OLD', active);
    expect(r.projectKey).toBe('DEMO');
    expect(r.notice).toContain('OLD');
    expect(r.notice).toContain('DEMO');
    expect(r.block).toBeUndefined();
  });
  it('key khác hoa/thường vẫn khớp dự án đang hoạt động => dùng key chuẩn, không thông báo', () => {
    expect(resolveCreateTarget('qai', active)).toEqual({ projectKey: 'QAI' });
  });
  it('thông báo không khẳng định "đã lưu trữ" khi chỉ biết key không còn hoạt động', () => {
    expect(resolveCreateTarget('OLD', active).notice).toContain('không còn hoạt động');
    expect(resolveCreateTarget('OLD', active).notice).not.toContain('đã lưu trữ');
    expect(resolveCreateTarget('OLD', []).notice).not.toContain('đã lưu trữ');
  });
  it('không còn dự án nào đang hoạt động => chặn + thông báo (không mở dialog trống)', () => {
    expect(resolveCreateTarget('OLD', [])).toMatchObject({ block: true });
  });
  it('danh sách chưa tải hoặc không có dự án hiện tại => như cũ', () => {
    expect(resolveCreateTarget('OLD', undefined)).toEqual({ projectKey: 'OLD' });
    expect(resolveCreateTarget(null, active)).toEqual({ projectKey: undefined });
  });
});

describe('createAccess — một luật cho mọi lối tạo việc', () => {
  it('không có issue:create ở dự án đích → deny (ẩn nút / phím báo ngắn, không mở form)', () => {
    expect(createAccess({ projectKey: 'DEMO' }, false)).toBe('deny');
  });
  it('có quyền hoặc chưa biết (đang tải) → open', () => {
    expect(createAccess({ projectKey: 'DEMO' }, true)).toBe('open');
    expect(createAccess({ projectKey: 'DEMO' }, undefined)).toBe('open');
  });
  it('không có dự án hoạt động nào (block) → blocked, kể cả khi thiếu quyền', () => {
    expect(createAccess({ block: true, notice: 'x' }, true)).toBe('blocked');
    expect(createAccess({ block: true, notice: 'x' }, false)).toBe('blocked');
  });
  it('đổi dự án do dự án hiện tại lưu trữ vẫn mở (kèm notice) khi có quyền ở dự án mới', () => {
    expect(createAccess({ projectKey: 'B', notice: 'đã chọn B' }, true)).toBe('open');
  });
});

describe('issueKeyFromPathname', () => {
  it('lấy key (đã giải mã) ở /issue/:key', () => {
    expect(issueKeyFromPathname('/issue/DEMO-BUG-1')).toBe('DEMO-BUG-1');
    expect(issueKeyFromPathname('/issue/A%2DB')).toBe('A-B');
    expect(issueKeyFromPathname('/issue/%E0%A4%A')).toBe('%E0%A4%A');
  });
  it('trang khác → null', () => {
    expect(issueKeyFromPathname('/p/DEMO/board')).toBeNull();
    expect(issueKeyFromPathname('/')).toBeNull();
  });
});
