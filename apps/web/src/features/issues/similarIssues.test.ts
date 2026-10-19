import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { similarIssues } from './similarIssues';

const issue = (key: string) => ({ id: key, key, summary: `Việc ${key}` });
const data = [issue('A-1'), issue('A-2'), issue('A-3'), issue('A-4'), issue('A-5')];

describe('similarIssues — gợi ý ở trang "Không tìm thấy công việc"', () => {
  it('loại chính mã đang xem, tối đa 3', () => {
    expect(similarIssues(data, 'A-2', false).map((i) => i.key)).toEqual(['A-1', 'A-3', 'A-4']);
  });
  it('dữ liệu giữ chỗ (placeholder = kết quả của mã TRƯỚC) → không hiện gì, tránh nháy', () => {
    expect(similarIssues(data, 'B-9', true)).toEqual([]);
  });
  it('chưa có dữ liệu → rỗng', () => {
    expect(similarIssues(undefined, 'A-1', false)).toEqual([]);
  });
});

describe('IssueNotFound dùng isPlaceholderData', () => {
  it('đọc-source: lấy isPlaceholderData từ useQuickSearch và truyền vào similarIssues', () => {
    const src = readFileSync(join(__dirname, 'IssueNotFound.tsx'), 'utf8');
    expect(src).toMatch(/isPlaceholderData/);
    expect(src).toMatch(/similarIssues\(/);
  });
});
