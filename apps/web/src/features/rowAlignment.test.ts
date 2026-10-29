import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

/** Phần tử mở (`<tag ... className="...">`) chứa đúng cụm class và (tuỳ chọn) thuộc tính khác — khớp trong MỘT thẻ. */
function tagWith(src: string, cls: string, extra = ''): boolean {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(?:span|div)\\b[^<>]*className="[^"]*${esc(cls)}[^"]*"[^<>]*${extra}[^<>]*>`,
  );
  return re.test(src);
}

describe('Thành viên workspace', () => {
  const s = read('members/MembersPage.tsx');
  it('cột vai trò + trạng thái bề rộng cố định', () => {
    expect(tagWith(s, 'min-w-0 sm:w-56 sm:shrink-0')).toBe(true);
    expect(tagWith(s, 'sm:w-36 sm:shrink-0 sm:justify-end')).toBe(true);
  });
  it('dòng của mình: placeholder invisible, aria-hidden, cùng cỡ nút xoá, ẩn ở mobile', () => {
    expect(s).toContain('{isSelf ? (');
    expect(tagWith(s, 'invisible h-9 w-9 max-sm:hidden', 'aria-hidden')).toBe(true);
  });
});

describe('Thành viên dự án', () => {
  const s = read('project-config/MembersSection.tsx');
  it('cột vai trò cố định; nút "về mặc định" có placeholder', () => {
    expect(tagWith(s, 'justify-end gap-1.5 sm:w-64 sm:shrink-0')).toBe(true);
    expect(s).toContain('{m.isOverride ? (');
    expect(tagWith(s, 'invisible h-9 w-9 max-sm:hidden', 'aria-hidden')).toBe(true);
  });
});

describe('Admin người dùng', () => {
  const s = read('admin/AdminUsersPage.tsx');
  it('menu hành động có placeholder cho dòng của mình / tài khoản hệ thống', () => {
    expect(s).toContain('u.id !== me?.id && !u.isAutomation ? (');
    expect(tagWith(s, 'invisible h-9 w-9 shrink-0 max-sm:hidden', 'aria-hidden')).toBe(true);
  });
});

describe('Vai trò', () => {
  it('cột tên (badge + "Hệ thống") bề rộng cố định', () => {
    expect(tagWith(read('settings/RolesPage.tsx'), 'sm:w-64 sm:shrink-0 sm:flex-nowrap')).toBe(
      true,
    );
  });
});

describe('Nhóm', () => {
  it('cụm MemberStack bọc trong ô bề rộng cố định', () => {
    const s = read('teams/TeamsPanel.tsx');
    expect(s).toMatch(
      /<div className="flex sm:w-40 sm:shrink-0 sm:justify-end">\s*<MemberStack team=\{t\} \/>/,
    );
  });
});

describe('SLA', () => {
  const s = read('sla/SlaPage.tsx');
  it('từng cột phải cố định bề rộng đúng phần tử', () => {
    expect(tagWith(s, 'hidden w-28 shrink-0 items-center text-xs text-muted sm:flex')).toBe(true);
    expect(tagWith(s, 'hidden w-32 shrink-0 truncate text-xs text-faint md:inline')).toBe(true);
    expect(s).toMatch(/cn\(\s*'flex sm:w-28 sm:shrink-0 sm:justify-end'/);
    expect(s).toMatch(
      /cn\(\s*'shrink-0 rounded px-1\.5 py-0\.5 text-center text-xs font-medium sm:w-32'/,
    );
    expect(tagWith(s, 'justify-end gap-1.5 sm:w-16')).toBe(true);
    expect(tagWith(s, 'text-right text-[11px] text-faint sm:w-16')).toBe(true);
  });
  it('"chưa phản hồi" giữ chỗ bằng invisible khi đã phản hồi', () => {
    expect(s).toMatch(/r\.responded && 'invisible'[\s\S]{0,120}chưa phản hồi/);
  });
});

describe('Bộ lọc đã lưu', () => {
  it('nút xoá có placeholder để nút chia sẻ không xê dịch', () => {
    const s = read('saved-filters/FiltersPage.tsx');
    expect(s).toContain('{f.isOwner && canManage ? (');
    expect(tagWith(s, 'invisible h-7 w-7 shrink-0 max-sm:hidden', 'aria-hidden')).toBe(true);
  });
});

describe('Ngày nghỉ / Hợp đồng / Thùng rác / Triage', () => {
  it('TimeOff: cột loại + ngày cố định', () => {
    const s = read('resources/TimeOffPanel.tsx');
    expect(tagWith(s, 'sm:w-28 sm:shrink-0')).toBe(true);
    expect(
      tagWith(s, 'whitespace-nowrap text-sm tabular-nums text-muted sm:w-32 sm:shrink-0'),
    ).toBe(true);
  });
  it('Clients: giá trị + thời hạn cố định bề rộng', () => {
    const s = read('clients/ClientsPage.tsx');
    expect(s).toContain('text-ink-strong sm:w-32 sm:text-right');
    expect(s).toContain('text-xs sm:w-52 sm:text-right');
  });
  it('Trash: cột loại + mã cố định', () => {
    const s = read('trash/TrashPage.tsx');
    expect(tagWith(s, 'sm:w-28 sm:shrink-0')).toBe(true);
    expect(tagWith(s, 'font-mono text-xs text-muted sm:w-24')).toBe(true);
  });
  it('Triage: ô người nhận luôn rộng 22px', () => {
    expect(tagWith(read('triage/TriageRow.tsx'), 'h-[22px] w-[22px] shrink-0')).toBe(true);
  });
});
