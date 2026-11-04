import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEME,
  DEFAULT_WORKFLOWS,
  LEGACY_STATUS_MAP,
  WORKFLOW_OPEN_FROM,
  expandWorkflowTransitions,
  mapStatusByCategory,
  setProjectOverrideSchema,
  setWorkspaceSchemeSchema,
} from './workflow-defaults';

const KEYS = ['STANDARD', 'BUG', 'EPIC'] as const;
const OLD_NAMES = [
  'Cần làm',
  'Đang phân tích',
  'Sẵn sàng phát triển',
  'Đang làm',
  'Review code',
  'Chờ test',
  'Đang test',
  'Hoàn thành',
  'Không xử lý',
];

describe('DEFAULT_WORKFLOWS', () => {
  it('có tên và danh sách trạng thái đúng đặc tả', () => {
    expect(DEFAULT_WORKFLOWS.STANDARD.name).toBe('Standard Workflow');
    expect(DEFAULT_WORKFLOWS.BUG.name).toBe('Bug Workflow');
    expect(DEFAULT_WORKFLOWS.EPIC.name).toBe('Epic Workflow');
    const view = (k: (typeof KEYS)[number]) =>
      DEFAULT_WORKFLOWS[k].statuses.map((s) => `${s.name}:${s.category}`);
    expect(view('STANDARD')).toEqual([
      'To Do:TODO',
      'Ready:TODO',
      'In Progress:IN_PROGRESS',
      'In Review:IN_PROGRESS',
      'Rework:IN_PROGRESS',
      'Pending:IN_PROGRESS',
      'Done:DONE',
      'Cancelled:DONE',
    ]);
    expect(view('BUG')).toEqual([
      'New:TODO',
      'To Do:TODO',
      'In Progress:IN_PROGRESS',
      'Ready for Retest:IN_PROGRESS',
      'Reopened:IN_PROGRESS',
      'Pending:IN_PROGRESS',
      'Done:DONE',
      'Closed:DONE',
      'Cancelled:DONE',
    ]);
    expect(view('EPIC')).toEqual([
      'Not Started:TODO',
      'In Progress:IN_PROGRESS',
      'Awaiting Acceptance:IN_PROGRESS',
      'Pending:IN_PROGRESS',
      'Done:DONE',
      'Cancelled:DONE',
    ]);
  });

  it.each(KEYS)('%s: đúng một trạng thái khởi tạo, tên trạng thái không trùng', (k) => {
    const def = DEFAULT_WORKFLOWS[k];
    expect(def.statuses.filter((s) => s.isInitial)).toHaveLength(1);
    const names = def.statuses.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('trạng thái khởi tạo: To Do / New / Not Started', () => {
    const initial = (k: (typeof KEYS)[number]) =>
      DEFAULT_WORKFLOWS[k].statuses.find((s) => s.isInitial)?.name;
    expect(initial('STANDARD')).toBe('To Do');
    expect(initial('BUG')).toBe('New');
    expect(initial('EPIC')).toBe('Not Started');
  });

  it.each(KEYS)('%s: mọi đầu mút của bước chuyển đều là trạng thái có thật', (k) => {
    const def = DEFAULT_WORKFLOWS[k];
    const names = new Set(def.statuses.map((s) => s.name));
    for (const t of def.transitions) {
      expect(names.has(t.to), `${k}: to "${t.to}"`).toBe(true);
      if (t.from !== null && t.from !== WORKFLOW_OPEN_FROM) {
        expect(names.has(t.from), `${k}: from "${t.from}"`).toBe(true);
      }
    }
  });

  it.each(KEYS)('%s: khai báo Pending/Cancelled và bước chuyển nhóm mở', (k) => {
    const flat = expandWorkflowTransitions(DEFAULT_WORKFLOWS[k]);
    const open = DEFAULT_WORKFLOWS[k].statuses
      .filter((s) => s.category !== 'DONE' && s.name !== 'Pending')
      .map((s) => s.name);
    for (const o of open) {
      expect(
        flat.some((t) => t.from === o && t.to === 'Pending'),
        `${o}→Pending`,
      ).toBe(true);
      expect(
        flat.some((t) => t.from === o && t.to === 'Cancelled'),
        `${o}→Cancelled`,
      ).toBe(true);
      expect(
        flat.some((t) => t.from === 'Pending' && t.to === o),
        `Pending→${o}`,
      ).toBe(true);
    }
    // Trạng thái đóng không có đường ra (riêng Bug: Done→Closed).
    expect(flat.filter((t) => t.from === 'Done').map((t) => t.to)).toEqual(
      k === 'BUG' ? ['Closed'] : [],
    );
    expect(flat.some((t) => t.from === 'Cancelled')).toBe(false);
    expect(flat.some((t) => t.from === 'Pending' && t.to === 'Pending')).toBe(false);
    expect(flat.some((t) => t.from === t.to)).toBe(false);
  });

  it('luồng chính đúng đặc tả', () => {
    const has = (k: (typeof KEYS)[number], from: string, to: string) =>
      expandWorkflowTransitions(DEFAULT_WORKFLOWS[k]).some((t) => t.from === from && t.to === to);
    for (const [f, t] of [
      ['To Do', 'Ready'],
      ['Ready', 'In Progress'],
      ['In Progress', 'In Review'],
      ['In Review', 'Done'],
      ['In Review', 'Rework'],
      ['Rework', 'In Progress'],
    ] as const) {
      expect(has('STANDARD', f, t), `STANDARD ${f}→${t}`).toBe(true);
    }
    for (const [f, t] of [
      ['New', 'To Do'],
      ['To Do', 'In Progress'],
      ['In Progress', 'Ready for Retest'],
      ['Ready for Retest', 'Done'],
      ['Done', 'Closed'],
      ['Ready for Retest', 'Reopened'],
      ['Reopened', 'In Progress'],
    ] as const) {
      expect(has('BUG', f, t), `BUG ${f}→${t}`).toBe(true);
    }
    for (const [f, t] of [
      ['Not Started', 'In Progress'],
      ['In Progress', 'Awaiting Acceptance'],
      ['Awaiting Acceptance', 'Done'],
    ] as const) {
      expect(has('EPIC', f, t), `EPIC ${f}→${t}`).toBe(true);
    }
  });

  it('expandWorkflowTransitions không sinh bước trùng', () => {
    for (const k of KEYS) {
      const flat = expandWorkflowTransitions(DEFAULT_WORKFLOWS[k]).map(
        (t) => `${t.from ?? '*'}>${t.to}`,
      );
      expect(new Set(flat).size).toBe(flat.length);
    }
  });
});

describe('DEFAULT_SCHEME', () => {
  it('Epic→Epic, Bug→Bug, còn lại → Standard', () => {
    expect(DEFAULT_SCHEME).toEqual({
      EPIC: 'EPIC',
      STORY: 'STANDARD',
      TASK: 'STANDARD',
      BUG: 'BUG',
      SUBTASK: 'STANDARD',
      CUSTOM: 'STANDARD',
    });
  });
});

describe('LEGACY_STATUS_MAP', () => {
  it('phủ đủ 9 tên cũ cho cả 3 quy trình đích, đích là trạng thái có thật', () => {
    expect(Object.keys(LEGACY_STATUS_MAP).sort()).toEqual([...OLD_NAMES].sort());
    for (const old of OLD_NAMES) {
      for (const k of KEYS) {
        const target = LEGACY_STATUS_MAP[old]![k];
        expect(
          DEFAULT_WORKFLOWS[k].statuses.some((s) => s.name === target),
          `${old} → ${k}: "${target}"`,
        ).toBe(true);
      }
    }
  });

  it('khớp bảng trong đặc tả', () => {
    const row = (old: string) => {
      const m = LEGACY_STATUS_MAP[old]!;
      return [m.STANDARD, m.BUG, m.EPIC];
    };
    expect(row('Cần làm')).toEqual(['To Do', 'New', 'Not Started']);
    expect(row('Đang phân tích')).toEqual(['To Do', 'To Do', 'Not Started']);
    expect(row('Sẵn sàng phát triển')).toEqual(['Ready', 'To Do', 'Not Started']);
    expect(row('Đang làm')).toEqual(['In Progress', 'In Progress', 'In Progress']);
    expect(row('Review code')).toEqual(['In Review', 'In Progress', 'In Progress']);
    expect(row('Chờ test')).toEqual(['In Review', 'Ready for Retest', 'In Progress']);
    expect(row('Đang test')).toEqual(['In Review', 'Ready for Retest', 'In Progress']);
    expect(row('Hoàn thành')).toEqual(['Done', 'Done', 'Done']);
    expect(row('Không xử lý')).toEqual(['Cancelled', 'Cancelled', 'Cancelled']);
  });
});

describe('mapStatusByCategory', () => {
  it('TODO → trạng thái khởi tạo; IN_PROGRESS → In Progress; DONE → Done', () => {
    expect(mapStatusByCategory('TODO', 'STANDARD')).toBe('To Do');
    expect(mapStatusByCategory('TODO', 'BUG')).toBe('New');
    expect(mapStatusByCategory('TODO', 'EPIC')).toBe('Not Started');
    for (const k of KEYS) {
      expect(mapStatusByCategory('IN_PROGRESS', k)).toBe('In Progress');
      expect(mapStatusByCategory('DONE', k)).toBe('Done');
    }
  });
});

describe('setWorkspaceSchemeSchema', () => {
  it('nhận danh sách ánh xạ hợp lệ', () => {
    const r = setWorkspaceSchemeSchema.safeParse({
      items: [
        { issueTypeId: 't1', workflowId: 'w1' },
        { issueTypeId: 't2', workflowId: 'w2' },
      ],
    });
    expect(r.success).toBe(true);
  });
  it('từ chối danh sách rỗng, thiếu workflowId, loại việc trùng', () => {
    expect(setWorkspaceSchemeSchema.safeParse({ items: [] }).success).toBe(false);
    expect(setWorkspaceSchemeSchema.safeParse({ items: [{ issueTypeId: 't1' }] }).success).toBe(
      false,
    );
    expect(
      setWorkspaceSchemeSchema.safeParse({
        items: [
          { issueTypeId: 't1', workflowId: 'w1' },
          { issueTypeId: 't1', workflowId: 'w2' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('setProjectOverrideSchema', () => {
  it('nhận workflowId + statusMap, hoặc workflowId null để về dùng chung', () => {
    expect(
      setProjectOverrideSchema.safeParse({ issueTypeId: 't1', workflowId: 'w1', statusMap: {} })
        .success,
    ).toBe(true);
    const back = setProjectOverrideSchema.safeParse({
      issueTypeId: 't1',
      workflowId: null,
      statusMap: { s1: 's9' },
    });
    expect(back.success).toBe(true);
  });
  it('statusMap mặc định {} khi bỏ trống; từ chối issueTypeId rỗng và giá trị không phải chuỗi', () => {
    const r = setProjectOverrideSchema.parse({ issueTypeId: 't1', workflowId: 'w1' });
    expect(r.statusMap).toEqual({});
    expect(
      setProjectOverrideSchema.safeParse({ issueTypeId: '', workflowId: null, statusMap: {} })
        .success,
    ).toBe(false);
    expect(
      setProjectOverrideSchema.safeParse({
        issueTypeId: 't1',
        workflowId: null,
        statusMap: { s1: 5 },
      }).success,
    ).toBe(false);
  });
});
