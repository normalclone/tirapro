import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_LAST_KEY,
  LAST_ACTIVE_KEY,
  lastViewKey,
  createPresetFromTarget,
  readRecentProjectKeys,
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
  it('dự án hiện tại đã lưu trữ => dự án hoạt động dùng GẦN NHẤT + thông báo (không lấy dự án đầu danh sách)', () => {
    const r = resolveCreateTarget('OLD', active, ['OLD', 'QAI', 'DEMO']);
    expect(r.projectKey).toBe('QAI');
    expect(r.notice).toContain('OLD');
    expect(r.notice).toContain('QAI');
    expect(r.block).toBeUndefined();
    expect(r.pickProject).toBeUndefined();
  });
  it('bỏ qua key gần đây không còn hoạt động; so key không phân biệt hoa/thường', () => {
    expect(resolveCreateTarget('OLD', active, [undefined, 'GONE', 'qai']).projectKey).toBe('QAI');
  });
  it('lưu trữ + không có dự án gần đây hợp lệ => KHÔNG tự chọn dự án đầu, để trống + pickProject', () => {
    for (const recent of [[], ['GONE', 'OLD'], [null]]) {
      const r = resolveCreateTarget('OLD', active, recent);
      expect(r.projectKey).toBeUndefined();
      expect(r.pickProject).toBe(true);
      expect(r.block).toBeUndefined();
    }
    // không truyền lịch sử (mặc định) cũng không rơi về active[0]
    expect(resolveCreateTarget('OLD', active).projectKey).toBeUndefined();
  });
  it('key khác hoa/thường vẫn khớp dự án đang hoạt động => dùng key chuẩn, không thông báo', () => {
    expect(resolveCreateTarget('qai', active)).toEqual({ projectKey: 'QAI' });
  });
  it('thông báo không khẳng định "đã lưu trữ" khi chỉ biết key không còn hoạt động', () => {
    expect(resolveCreateTarget('OLD', active, ['QAI']).notice).toContain('không còn hoạt động');
    expect(resolveCreateTarget('OLD', active, ['QAI']).notice).not.toContain('đã lưu trữ');
    expect(resolveCreateTarget('OLD', []).notice).not.toContain('đã lưu trữ');
  });
  it('không còn dự án nào đang hoạt động => chặn + thông báo (không mở dialog trống)', () => {
    expect(resolveCreateTarget('OLD', [], ['QAI'])).toMatchObject({ block: true });
  });
  it('danh sách chưa tải hoặc không có dự án hiện tại => như cũ', () => {
    expect(resolveCreateTarget('OLD', undefined)).toEqual({ projectKey: 'OLD' });
    expect(resolveCreateTarget(null, active)).toEqual({ projectKey: undefined });
  });
});

describe('resolveCreateTarget — recentKeys tính lười', () => {
  const active = [{ key: 'DEMO' }, { key: 'QAI' }];
  it('truyền hàm: KHÔNG gọi khi dự án hiện tại đang hoạt động / danh sách chưa tải / không còn dự án nào', () => {
    const recent = vi.fn(() => ['QAI']);
    resolveCreateTarget('DEMO', active, recent);
    resolveCreateTarget('OLD', undefined, recent);
    resolveCreateTarget(null, active, recent);
    resolveCreateTarget('OLD', [], recent);
    expect(recent).not.toHaveBeenCalled();
  });
  it('truyền hàm: gọi đúng một lần khi dự án hiện tại đã lưu trữ và dùng kết quả', () => {
    const recent = vi.fn(() => ['QAI']);
    expect(resolveCreateTarget('OLD', active, recent).projectKey).toBe('QAI');
    expect(recent).toHaveBeenCalledOnce();
  });
});

describe('createPresetFromTarget', () => {
  it('pickProject => preset không có projectKey', () => {
    expect(createPresetFromTarget({ pickProject: true })).toEqual({ pickProject: true });
  });
  it('có dự án đích => chỉ projectKey', () => {
    expect(createPresetFromTarget({ projectKey: 'DEMO', notice: 'x' })).toEqual({
      projectKey: 'DEMO',
    });
  });
});

describe('readRecentProjectKeys', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('thứ tự: dự án hoạt động xem gần nhất → view gần nhất → tạo việc gần nhất, bỏ trùng', () => {
    store.set(LAST_ACTIVE_KEY, 'AAA');
    store.set(lastViewKey(), JSON.stringify({ key: 'OLD', view: 'board' }));
    store.set(CREATE_LAST_KEY, JSON.stringify({ projectKey: 'AAA' }));
    expect(readRecentProjectKeys()).toEqual(['AAA', 'OLD']);
  });
  it('storage bị chặn (getItem ném lỗi) → trả mảng rỗng, không ném', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(() => readRecentProjectKeys()).not.toThrow();
    expect(readRecentProjectKeys()).toEqual([]);
  });
  it('JSON hỏng không ném lỗi', () => {
    store.set(lastViewKey(), '{hỏng');
    store.set(CREATE_LAST_KEY, JSON.stringify({ projectKey: 'BBB' }));
    expect(readRecentProjectKeys()).toEqual(['BBB']);
  });
});

describe('lastViewKey theo người dùng (WO-M8)', () => {
  it('hai tài khoản có hai khoá khác nhau; chưa đăng nhập dùng anon', () => {
    expect(lastViewKey('u1')).not.toBe(lastViewKey('u2'));
    expect(lastViewKey('u1')).toContain('u1');
    expect(lastViewKey(undefined)).toBe('tirapro:lastProjectView:anon');
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
