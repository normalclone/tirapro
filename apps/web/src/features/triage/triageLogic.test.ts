import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAcceptPayload,
  defaultTypeKeyForKind,
  formatEnvironmentLine,
  isDeclineReasonValid,
  isLongDescription,
  kindLabel,
  TRIAGE_TITLE,
  triageAccess,
  triageSprintOptions,
} from './triageLogic';

describe('kind', () => {
  it('nhãn và loại công việc mặc định theo loại yêu cầu', () => {
    expect(kindLabel('BUG')).toBe('Bug');
    expect(kindLabel('FEATURE')).toBe('Yêu cầu tính năng');
    expect(kindLabel('QUESTION')).toBe('Câu hỏi');
    expect(kindLabel(null)).toBe('Yêu cầu');
    expect(defaultTypeKeyForKind('FEATURE')).toBe('STORY');
    expect(defaultTypeKeyForKind('QUESTION')).toBe('TASK');
    expect(defaultTypeKeyForKind('BUG')).toBe('BUG');
    expect(defaultTypeKeyForKind(null)).toBeNull();
  });
});

describe('buildAcceptPayload', () => {
  it('chỉ gửi trường đã đổi so với hiện tại; sprint rỗng = null (Việc chờ) chỉ khi khác sprint hiện tại', () => {
    const cur = {
      typeId: 't1',
      priorityId: 'p1',
      sprintId: null as string | null,
      assigneeId: null as string | null,
      version: 4,
    };
    expect(
      buildAcceptPayload(cur, { typeId: 't1', priorityId: 'p1', sprintId: '', assigneeId: '' }),
    ).toEqual({ version: 4 });
    expect(
      buildAcceptPayload(cur, {
        typeId: 't2',
        priorityId: 'p2',
        sprintId: 'sp1',
        assigneeId: 'u3',
      }),
    ).toEqual({ version: 4, typeId: 't2', priorityId: 'p2', sprintId: 'sp1', assigneeId: 'u3' });
  });

  it('việc đang ở sprint mà chọn "Việc chờ" => gửi sprintId null', () => {
    const cur = { typeId: 't1', priorityId: null, sprintId: 'sp9', assigneeId: null, version: 2 };
    expect(
      buildAcceptPayload(cur, { typeId: 't1', priorityId: '', sprintId: '', assigneeId: '' }),
    ).toEqual({ version: 2, sprintId: null });
  });
});

describe('isDeclineReasonValid', () => {
  it('cần ≥ 3 ký tự sau trim', () => {
    expect(isDeclineReasonValid('  ')).toBe(false);
    expect(isDeclineReasonValid('ab')).toBe(false);
    expect(isDeclineReasonValid('Trùng DEMO-BUG-2')).toBe(true);
  });
});

describe('formatEnvironmentLine', () => {
  it('nối các trường có giá trị thành một dòng, null/rỗng => null', () => {
    expect(formatEnvironmentLine(null)).toBeNull();
    expect(formatEnvironmentLine({})).toBeNull();
    expect(
      formatEnvironmentLine({
        env: 'production',
        browser: 'Chrome 130',
        os: 'macOS',
        viewport: '1440×900',
      }),
    ).toBe('Production · Chrome 130 · macOS · 1440×900');
    expect(formatEnvironmentLine({ build: '1.4.2' })).toBe('Build 1.4.2');
  });
});

describe('triageSprintOptions', () => {
  it('đầu danh sách là Việc chờ; bỏ sprint đã đóng; đánh dấu sprint đang chạy', () => {
    const base = {
      projectId: 'p',
      boardId: null,
      goal: null,
      startDate: null,
      endDate: null,
      completeDate: null,
      sequence: 1,
    };
    const opts = triageSprintOptions([
      { ...base, id: 'a', name: 'Sprint 1', state: 'CLOSED' },
      { ...base, id: 'b', name: 'Sprint 2', state: 'ACTIVE' },
      { ...base, id: 'c', name: 'Sprint 3', state: 'FUTURE' },
    ]);
    expect(opts).toEqual([
      { value: '', label: 'Việc chờ — chưa vào sprint' },
      { value: 'b', label: 'Sprint 2 · đang chạy' },
      { value: 'c', label: 'Sprint 3' },
    ]);
    expect(triageSprintOptions(undefined)).toEqual([
      { value: '', label: 'Việc chờ — chưa vào sprint' },
    ]);
  });
});

describe('isLongDescription', () => {
  it('chỉ mô tả dài (nhiều dòng hoặc nhiều chữ) mới bị cắt xem trước', () => {
    expect(isLongDescription(null)).toBe(false);
    expect(isLongDescription('ngắn')).toBe(false);
    expect(isLongDescription(Array.from({ length: 13 }, (_, i) => `d${i}`).join('\n'))).toBe(true);
    expect(isLongDescription('x'.repeat(701))).toBe(true);
  });
});

describe('TRIAGE_TITLE', () => {
  it('tên chức năng là "Việc mới vào" (UX_CONVENTIONS §19), không còn "Phân loại (Triage)"', () => {
    expect(TRIAGE_TITLE).toBe('Việc mới vào');
  });
});

describe('triageAccess — ai được mở trang "Việc mới vào"', () => {
  it('quyền dự án chưa tải xong → loading (không kết luận sớm, không gọi API)', () => {
    expect(triageAccess({ permsPending: true, canTriage: false })).toBe('loading');
    expect(triageAccess({ permsPending: true, canTriage: true })).toBe('loading');
  });
  it('tải xong: có issue:triage → allowed; thiếu → denied (NoAccess)', () => {
    expect(triageAccess({ permsPending: false, canTriage: true })).toBe('allowed');
    expect(triageAccess({ permsPending: false, canTriage: false })).toBe('denied');
  });
});

describe('TriagePage — chặn truy cập trực tiếp bằng URL', () => {
  const page = readFileSync(join(__dirname, 'TriagePage.tsx'), 'utf8');
  it('dùng useCan (KHÔNG useCanIn: dự án lưu trữ làm useCanIn trả false) để quyết định xem trang', () => {
    expect(page).toMatch(/useCan\(projectId\)\('issue:triage'\)/);
    expect(page).toMatch(/triageAccess\(/);
    expect(page).toMatch(/<NoAccess/);
  });
  it('không gọi API hộp/đếm khi chưa được phép (truyền undefined → skipToken)', () => {
    expect(page).toMatch(/useTriageInbox\(allowed \? projectId : undefined\)/);
    expect(page).toMatch(/useTriageCount\(allowed \? projectId : undefined\)/);
  });
});
