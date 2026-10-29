import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectCommands } from './projectCommands';
import { TRIAGE_TITLE } from '@/features/triage/triageLogic';

const sprints = [
  { id: 's1', name: 'Sprint 1', state: 'CLOSED' },
  { id: 's2', name: 'Sprint 2', state: 'ACTIVE' },
  { id: 's3', name: 'Sprint 3', state: 'FUTURE' },
] as const;
const base = {
  projectKey: 'DEMO',
  projectId: 'p1',
  sprints: [...sprints],
  canSprint: true,
  canAutomation: true,
  canTriage: true,
  canImport: true,
};

describe('buildProjectCommands', () => {
  it('có Tạo sprint, và Kết thúc sprint đang chạy', () => {
    const labels = buildProjectCommands(base).map((c) => c.label);
    expect(labels).toContain('Tạo sprint');
    expect(labels).toContain('Kết thúc sprint “Sprint 2”');
  });
  it('đang có sprint chạy → KHÔNG đề nghị Bắt đầu sprint khác', () => {
    expect(buildProjectCommands(base).some((c) => c.label.startsWith('Bắt đầu sprint'))).toBe(
      false,
    );
  });
  it('không có sprint chạy → Bắt đầu sprint chưa bắt đầu', () => {
    const labels = buildProjectCommands({ ...base, sprints: [sprints[0], sprints[2]] }).map(
      (c) => c.label,
    );
    expect(labels).toContain('Bắt đầu sprint “Sprint 3”');
  });
  it('lệnh sprint đi qua Việc chờ kèm tham số action (kích hoạt đúng luồng của trang)', () => {
    const to = Object.fromEntries(buildProjectCommands(base).map((c) => [c.label, c.to]));
    expect(to['Tạo sprint']).toBe('/p/DEMO/backlog?action=create-sprint');
    expect(to['Kết thúc sprint “Sprint 2”']).toBe('/p/DEMO/backlog?action=complete&sprint=s2');
    const noActive = buildProjectCommands({ ...base, sprints: [sprints[2]] });
    expect(noActive.find((c) => c.label.startsWith('Bắt đầu'))?.to).toBe(
      '/p/DEMO/backlog?action=start&sprint=s3',
    );
  });
  it('tối đa 5 sprint chưa bắt đầu, theo thứ tự', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `f${i}`,
      name: `F${i}`,
      state: 'FUTURE',
      sequence: i,
    }));
    const starts = buildProjectCommands({ ...base, sprints: many }).filter((c) =>
      c.label.startsWith('Bắt đầu sprint'),
    );
    expect(starts.map((c) => c.label)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `Bắt đầu sprint “F${i}”`),
    );
  });
  it('không có quyền sprint → không có lệnh sprint, vẫn có điều hướng', () => {
    const cmds = buildProjectCommands({ ...base, canSprint: false });
    expect(cmds.some((c) => /sprint/i.test(c.label))).toBe(false);
    expect(cmds.map((c) => c.to)).toContain('/p/DEMO/reports');
  });
  it('điều hướng đủ Báo cáo / Lịch trình / Việc mới vào / Rủi ro; Tự động hoá theo quyền', () => {
    const to = buildProjectCommands({ ...base, canAutomation: false }).map((c) => c.to);
    expect(to).toEqual(
      expect.arrayContaining([
        '/p/DEMO/reports',
        '/p/DEMO/gantt',
        '/p/DEMO/triage',
        '/manage/risks?project=p1',
      ]),
    );
    expect(to).not.toContain('/connect/automation?project=p1');
    expect(buildProjectCommands(base).map((c) => c.to)).toContain('/connect/automation?project=p1');
  });
  it('Nhập công việc từ Excel → trang Dữ liệu của cấu hình dự án; ẩn khi thiếu quyền import', () => {
    const cmd = buildProjectCommands(base).find((c) => c.id === 'import.excel');
    expect(cmd?.label).toBe('Nhập công việc từ Excel');
    expect(cmd?.to).toBe('/p/DEMO/config/data');
    expect(cmd?.keywords).toContain('excel');
    expect(
      buildProjectCommands({ ...base, canImport: false }).some((c) => c.id === 'import.excel'),
    ).toBe(false);
  });
  it('Wiki không nằm trong nhóm dự án (wiki chưa lọc theo dự án) — có ở nhóm Điều hướng chung', () => {
    expect(buildProjectCommands(base).some((c) => c.to === '/wiki')).toBe(false);
  });
  it('Việc mới vào theo quyền duyệt (issue:triage), độc lập với quyền sprint', () => {
    expect(buildProjectCommands({ ...base, canSprint: false }).map((c) => c.to)).toContain(
      '/p/DEMO/triage',
    );
    const noTriage = buildProjectCommands({ ...base, canTriage: false });
    expect(noTriage.map((c) => c.id)).not.toContain('nav.triage');
    expect(noTriage.map((c) => c.to)).not.toContain('/p/DEMO/triage');
    // các lệnh điều hướng khác không bị ảnh hưởng
    expect(noTriage.map((c) => c.to)).toContain('/p/DEMO/reports');
  });
  it('nhãn lệnh dùng đúng tên chức năng (TRIAGE_TITLE) như tab và tiêu đề trang', () => {
    const cmd = buildProjectCommands(base).find((c) => c.to === '/p/DEMO/triage');
    expect(cmd?.label).toBe(`Mở ${TRIAGE_TITLE}`);
  });
  it('không lặp lệnh Báo lỗi (đã có ở nhóm Hành động của bảng lệnh)', () => {
    expect(buildProjectCommands(base).some((c) => /báo lỗi/i.test(c.label))).toBe(false);
  });
  it('từ khoá không dấu để gõ không cần dấu; id duy nhất', () => {
    const cmds = buildProjectCommands(base);
    expect(cmds.find((c) => c.label === 'Tạo sprint')?.keywords).toContain('tao sprint');
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
  });
});

describe('ProjectCommandGroup — quyền Việc mới vào', () => {
  it('đọc-source: canTriage lấy từ useCan thô (không useProjectCan/useCanIn đã trừ lưu trữ) và truyền vào buildProjectCommands', () => {
    const src = readFileSync(join(__dirname, 'ProjectCommandGroup.tsx'), 'utf8');
    expect(src).toMatch(/useCan\(project\?\.id\)\('issue:triage'\)/);
    expect(src).toMatch(/canTriage,\s*canImport,\s*\}\)/);
  });
});
