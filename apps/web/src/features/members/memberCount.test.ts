import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countActiveMembers, memberCountParts } from './memberCount';

const m = (status: string) => ({ user: { status } }) as never;

describe('countActiveMembers', () => {
  it('bỏ tài khoản bị vô hiệu hoá', () => {
    expect(countActiveMembers([m('ACTIVE'), m('INVITED'), m('DEACTIVATED')])).toBe(2);
  });
});

describe('memberCountParts — chữ hiện ở đầu danh sách', () => {
  it('chỉ có người hoạt động → "N đang hoạt động", không phần vô hiệu hoá', () => {
    expect(memberCountParts([m('ACTIVE'), m('ACTIVE')])).toEqual({
      active: '2 đang hoạt động',
      deactivated: null,
    });
  });
  it('có người bị vô hiệu hoá → thêm "M đã vô hiệu hoá"', () => {
    expect(memberCountParts([m('ACTIVE'), m('DEACTIVATED'), m('DEACTIVATED')])).toEqual({
      active: '1 đang hoạt động',
      deactivated: '2 đã vô hiệu hoá',
    });
  });
  it('toàn người bị vô hiệu hoá vẫn đúng', () => {
    expect(memberCountParts([m('DEACTIVATED')])).toEqual({
      active: '0 đang hoạt động',
      deactivated: '1 đã vô hiệu hoá',
    });
  });
});

describe('MembersPage và bộ chọn không gian', () => {
  it('đầu danh sách dùng memberCountParts, không còn "N người"', () => {
    const page = readFileSync(join(__dirname, 'MembersPage.tsx'), 'utf8');
    expect(page).toMatch(/memberCountParts\(members\)/);
    expect(page).not.toMatch(/\} người\s*<\/span>/);
  });
  it('mỗi <li> trong listbox có role="presentation"', () => {
    const src = readFileSync(join(__dirname, '../workspace/WorkspaceOption.tsx'), 'utf8');
    expect(src).toMatch(/<li role="presentation">/);
  });
});
