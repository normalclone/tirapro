import { describe, expect, it } from 'vitest';
import { deleteDescription } from './TeamsPanel';

describe('deleteDescription', () => {
  it('nhóm đang gắn vào dự án: nêu số dự án và việc thành viên mất vai trò nhờ nhóm', () => {
    const text = deleteDescription({ projectCount: 3 });
    expect(text).toContain('gắn vào 3 dự án');
    expect(text).toContain('gỡ vai trò');
    expect(text).toContain('vẫn ở lại tổ chức');
  });
  it('nhóm chưa gắn dự án nào: chỉ nói nhóm bị xoá', () => {
    const text = deleteDescription({ projectCount: 0 });
    expect(text).not.toContain('dự án');
    expect(text).toContain('giữ nguyên vai trò');
  });
});
