import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('Thành viên workspace — cột thẳng hàng', () => {
  const s = read('members/MembersPage.tsx');
  it('cột vai trò + trạng thái có bề rộng cố định từ sm', () => {
    expect(s).toContain('min-w-0 sm:w-56 sm:shrink-0');
    expect(s).toContain('sm:w-36 sm:shrink-0 sm:justify-end');
  });
  it('dòng của mình có placeholder nút gỡ cùng kích thước (invisible, aria-hidden)', () => {
    const i = s.indexOf('member-action-placeholder');
    expect(i).toBeGreaterThan(0);
    const ph = s.slice(i - 260, i + 40);
    expect(ph).toContain('invisible h-9 w-9');
    expect(ph).toContain('aria-hidden');
    expect(s).toContain('{isSelf ? (');
  });
});

describe('Thành viên dự án', () => {
  const s = read('project-config/MembersSection.tsx');
  it('cột vai trò cố định bề rộng; nút "về mặc định" có placeholder', () => {
    expect(s).toContain('justify-end gap-1.5 sm:w-64 sm:shrink-0');
    expect(s).toContain('{m.isOverride ? (');
    expect(s).toMatch(/invisible h-9 w-9[\s\S]{0,200}row-action-placeholder/);
  });
});

describe('Admin người dùng', () => {
  const s = read('admin/AdminUsersPage.tsx');
  it('menu hành động có placeholder khi là mình / tài khoản hệ thống', () => {
    expect(s).toContain('u.id !== me?.id && !u.isAutomation ? (');
    expect(s).toMatch(/invisible h-9 w-9 shrink-0[\s\S]{0,200}row-action-placeholder/);
  });
});

describe('Vai trò', () => {
  it('cột tên (badge + "Hệ thống") bề rộng cố định', () => {
    expect(read('settings/RolesPage.tsx')).toContain('sm:w-64 sm:shrink-0 sm:flex-nowrap');
  });
});

describe('SLA', () => {
  const s = read('sla/SlaPage.tsx');
  it('các cột phải cố định bề rộng; "chưa phản hồi" giữ chỗ bằng invisible', () => {
    expect(s).toContain('sm:w-28 sm:shrink-0 sm:justify-end');
    expect(s).toContain("r.responded && 'invisible'");
    expect(s).toContain('sm:w-32');
    expect(s).toContain('sm:w-16');
  });
});

describe('Bộ lọc đã lưu', () => {
  it('nút xoá có placeholder để nút chia sẻ không xê dịch', () => {
    const s = read('saved-filters/FiltersPage.tsx');
    expect(s).toContain('{f.isOwner && canManage ? (');
    expect(s).toMatch(/invisible h-7 w-7 shrink-0[\s\S]{0,200}row-action-placeholder/);
  });
});

describe('Ngày nghỉ / Hợp đồng / Thùng rác / Triage', () => {
  it('TimeOff: cột loại + ngày cố định', () => {
    const s = read('resources/TimeOffPanel.tsx');
    expect(s).toContain('sm:w-28 sm:shrink-0');
    expect(s).toContain('sm:w-32 sm:shrink-0');
  });
  it('Clients: giá trị + thời hạn cố định bề rộng', () => {
    const s = read('clients/ClientsPage.tsx');
    expect(s).toContain('sm:w-32 sm:text-right');
    expect(s).toContain('sm:w-52 sm:text-right');
  });
  it('Trash: cột loại + mã cố định', () => {
    const s = read('trash/TrashPage.tsx');
    expect(s).toContain('sm:w-28 sm:shrink-0');
    expect(s).toContain('sm:w-24');
  });
  it('Triage: ô người nhận luôn rộng 22px', () => {
    expect(read('triage/TriageRow.tsx')).toContain('h-[22px] w-[22px] shrink-0');
  });
});
