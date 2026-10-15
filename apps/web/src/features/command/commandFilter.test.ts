import { describe, expect, it } from 'vitest';
import {
  commandFilter,
  ISSUE_GO_VALUE_PREFIX,
  ISSUE_VALUE_PREFIX,
  normalizeVi,
} from './commandFilter';

describe('commandFilter', () => {
  it('ô tìm rỗng => mọi lệnh hiện (điểm 1)', () => {
    expect(commandFilter('tao cong viec issue create', '')).toBe(1);
  });
  it('bỏ dấu cả hai phía: gõ "tạo công việc" khớp value ASCII; gõ "doi giao dien" khớp', () => {
    expect(commandFilter('tao cong viec issue create', 'tạo công việc')).toBeGreaterThan(0);
    expect(commandFilter('doi giao dien theme sang toi', 'giao diện')).toBeGreaterThan(0);
  });
  it('mọi từ gõ phải có; từ lạ => 0 (gõ "zebrafish" ẩn hết lệnh)', () => {
    expect(commandFilter('tao cong viec issue create', 'tao zebrafish')).toBe(0);
    expect(commandFilter('doi trang thai chuyen Done DEMO-1', 'zebrafish')).toBe(0);
  });
  it('khớp từ đầu chuỗi được điểm cao hơn khớp giữa', () => {
    expect(commandFilter('tao cong viec', 'tao')).toBeGreaterThan(
      commandFilter('doi giao dien tao', 'tao'),
    );
  });
  it('kết quả server (tiền tố issue:) luôn hiện nhưng xếp sau lệnh khớp', () => {
    const s = commandFilter(`${ISSUE_VALUE_PREFIX}DEMO-1 Lỗi thanh toán`, 'zzz');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(commandFilter('tao cong viec', 'tao'));
  });
  it('"Đi tới công việc" (issue:go) xếp trên mọi lệnh khớp khác để gõ mã + Enter là điều hướng', () => {
    const go = commandFilter(`${ISSUE_GO_VALUE_PREFIX}DEMO-TASK-1`, 'demo-task-1');
    expect(go).toBeGreaterThan(
      commandFilter('doi trang thai chuyen Done DEMO-TASK-1', 'demo-task-1'),
    );
    expect(go).toBeGreaterThan(commandFilter('giao cho toi assign me DEMO-TASK-1', 'demo-task-1'));
    expect(go).toBeGreaterThan(commandFilter(`${ISSUE_VALUE_PREFIX}DEMO-TASK-1 x`, 'demo-task-1'));
  });
  it('keywords cũng được so khớp', () => {
    expect(commandFilter('a', 'giao', ['giao cho toi'])).toBeGreaterThan(0);
  });
});
describe('normalizeVi (web)', () => {
  it('bỏ dấu + đ', () => expect(normalizeVi('Đổi trạng thái')).toBe('doi trang thai'));
});
