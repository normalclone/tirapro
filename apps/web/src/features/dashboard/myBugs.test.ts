import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/features/workflow-settings/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { splitMyBugs, verifyStageStatusIds } from './myBugs';

const st = (id: string, order: number, category: 'TODO' | 'IN_PROGRESS' | 'DONE') => ({
  id,
  name: id,
  category,
  color: null,
  order,
  isInitial: order === 0,
});
const wf = (statuses: ReturnType<typeof st>[]): Workflow => ({
  id: 'w',
  name: 'w',
  description: null,
  isTemplate: false,
  isDefault: true,
  projectId: null,
  statuses,
  transitions: [],
});

describe('verifyStageStatusIds', () => {
  it('Scrum: In Review (IN_PROGRESS có order cao nhất, workflow có ≥2 IN_PROGRESS)', () => {
    const w = wf([
      st('todo', 0, 'TODO'),
      st('doing', 1, 'IN_PROGRESS'),
      st('review', 2, 'IN_PROGRESS'),
      st('done', 3, 'DONE'),
    ]);
    expect([...verifyStageStatusIds([w])]).toEqual(['review']);
  });
  it('Kanban chỉ một trạng thái đang làm => không có bước xác nhận', () => {
    const w = wf([st('todo', 0, 'TODO'), st('doing', 1, 'IN_PROGRESS'), st('done', 2, 'DONE')]);
    expect(verifyStageStatusIds([w]).size).toBe(0);
  });
  it('chưa tải workflow => rỗng; nhiều workflow => gộp bước cuối của từng cái', () => {
    expect(verifyStageStatusIds(undefined).size).toBe(0);
    const a = wf([st('a1', 0, 'IN_PROGRESS'), st('a2', 1, 'IN_PROGRESS')]);
    const b = wf([
      st('b1', 0, 'IN_PROGRESS'),
      st('b2', 5, 'IN_PROGRESS'),
      st('b3', 2, 'IN_PROGRESS'),
    ]);
    expect([...verifyStageStatusIds([a, b])].sort()).toEqual(['a2', 'b2']);
  });
});

describe('splitMyBugs', () => {
  const issue = (id: string, statusId: string) => ({ id, status: { id: statusId } });
  it('tách danh sách chờ xác nhận khỏi danh sách còn mở, giữ thứ tự', () => {
    const out = splitMyBugs(
      [issue('a', 'review'), issue('b', 'doing'), issue('c', 'review')],
      new Set(['review']),
    );
    expect(out.awaiting.map((i) => i.id)).toEqual(['a', 'c']);
    expect(out.open.map((i) => i.id)).toEqual(['b']);
  });
});

describe('verifyStageStatusIds — quy trình mặc định theo loại việc', () => {
  const standard = defaultWorkflow('STANDARD');
  const bug = defaultWorkflow('BUG');
  const epic = defaultWorkflow('EPIC');

  it('Bug chờ xác nhận ở Ready for Retest (không phải Reopened hay Pending)', () => {
    expect([...verifyStageStatusIds([bug])]).toEqual([statusIdOf('BUG', 'Ready for Retest')]);
  });
  it('Task (Standard) ở In Review, Epic ở Awaiting Acceptance — mỗi loại một bước, không lẫn nhau', () => {
    expect([...verifyStageStatusIds([standard, bug, epic])].sort()).toEqual(
      [
        statusIdOf('STANDARD', 'In Review'),
        statusIdOf('BUG', 'Ready for Retest'),
        statusIdOf('EPIC', 'Awaiting Acceptance'),
      ].sort(),
    );
  });
  it('bug đang Reopened hoặc Pending vẫn nằm ở "còn mở"; Bug ở Ready for Retest vào "chờ tôi xác nhận"', () => {
    const ids = verifyStageStatusIds([standard, bug]);
    const issue = (id: string, key: 'STANDARD' | 'BUG', name: string) => ({
      id,
      status: { id: statusIdOf(key, name) },
    });
    const out = splitMyBugs(
      [
        issue('retest', 'BUG', 'Ready for Retest'),
        issue('reopened', 'BUG', 'Reopened'),
        issue('pending', 'BUG', 'Pending'),
        issue('task-review', 'STANDARD', 'In Review'),
      ],
      ids,
    );
    expect(out.awaiting.map((i) => i.id)).toEqual(['retest', 'task-review']);
    expect(out.open.map((i) => i.id)).toEqual(['reopened', 'pending']);
  });
});

describe('verifyStageStatusIds — bước dẫn tới "Không xử lý"/Cancelled không phải bước chờ xác nhận', () => {
  it('quy trình tuỳ chỉnh: Review → Done và Triage → "Không xử lý" (cùng nhóm xong): chỉ Review là bước chờ', () => {
    const w: Workflow = {
      ...wf([
        st('todo', 0, 'TODO'),
        st('doing', 1, 'IN_PROGRESS'),
        st('review', 2, 'IN_PROGRESS'),
        st('triage', 3, 'IN_PROGRESS'),
        st('done', 4, 'DONE'),
        { ...st('wontfix', 5, 'DONE'), name: 'Không xử lý' },
      ]),
      transitions: [
        { id: 't1', name: 'Xong', fromStatusId: 'review', toStatusId: 'done', order: 0 },
        { id: 't2', name: 'Bỏ qua', fromStatusId: 'triage', toStatusId: 'wontfix', order: 1 },
      ],
    };
    expect([...verifyStageStatusIds([w])]).toEqual(['review']);
  });
});
