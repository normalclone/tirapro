import { describe, expect, it } from 'vitest';
import type { IssueDto, ProjectSubTeamDto } from '@tirapro/types';
import { applyTeamFilter } from './TeamFilter';
import { buildTeamLanes, NO_TEAM_LANE, parseBoardPrefs } from './teamLanes';

const issue = (id: string, assigneeId: string | null) =>
  ({ id, assigneeId }) as unknown as IssueDto;
const team = (id: string, name: string, members: string[]): ProjectSubTeamDto => ({
  id,
  projectId: 'p',
  name,
  color: null,
  members: members.map((m) => ({ id: m, displayName: m, avatarUrl: null })),
  memberCount: members.length,
  createdAt: '2026-01-01',
});
const QA = team('qa', 'QA', ['a', 'b']);
const DEV = team('dev', 'Dev', ['b', 'c']);

describe('buildTeamLanes', () => {
  const issues = [
    issue('1', 'a'),
    issue('2', 'b'),
    issue('3', 'c'),
    issue('4', null),
    issue('5', 'z'),
  ];
  it('mỗi việc một làn: team đầu theo tên; chưa gán / không team → "Chưa thuộc team nào" ở cuối', () => {
    const lanes = buildTeamLanes(issues, [QA, DEV]);
    expect(lanes.map((l) => [l.name, l.issues.map((i) => i.id)])).toEqual([
      ['Dev', ['2', '3']], // b thuộc cả hai team: "Dev" đứng trước "QA" theo tên
      ['QA', ['1']],
      ['Chưa thuộc team nào', ['4', '5']],
    ]);
  });
  it('người ở nhiều team vào làn của team đầu theo tên (Dev trước QA)', () => {
    const lanes = buildTeamLanes([issue('2', 'b')], [QA, DEV]);
    expect(lanes.map((l) => l.name)).toEqual(['Dev']);
  });
  it('team đang lọc được ưu tiên cho người ở nhiều team', () => {
    const lanes = buildTeamLanes([issue('2', 'b')], [QA, DEV], ['qa']);
    expect(lanes.map((l) => l.name)).toEqual(['QA']);
  });
  it('chỉ trả làn có việc; không có việc nào ngoài team thì không có làn "Chưa thuộc team"', () => {
    const lanes = buildTeamLanes([issue('1', 'a')], [QA, DEV]);
    expect(lanes.map((l) => l.key)).toEqual(['qa']);
    expect(lanes.some((l) => l.key === NO_TEAM_LANE)).toBe(false);
  });
});

describe('applyTeamFilter', () => {
  const list = [issue('1', 'a'), issue('2', 'c'), issue('3', null)];
  it('không chọn → không lọc; chọn → hợp thành viên các team; việc chưa gán bị loại', () => {
    expect(applyTeamFilter(list, [], [QA, DEV])).toHaveLength(3);
    expect(applyTeamFilter(list, ['qa'], [QA, DEV]).map((i) => i.id)).toEqual(['1']);
    expect(applyTeamFilter(list, ['qa', 'dev'], [QA, DEV]).map((i) => i.id)).toEqual(['1', '2']);
  });
  it('team đã xoá (id còn trong lựa chọn đã lưu) bị bỏ qua; không còn team hợp lệ → không lọc', () => {
    expect(applyTeamFilter(list, ['da-xoa'], [QA, DEV])).toHaveLength(3);
    expect(applyTeamFilter(list, ['da-xoa', 'qa'], [QA, DEV]).map((i) => i.id)).toEqual(['1']);
  });
});

describe('parseBoardPrefs', () => {
  it('đọc cả người phụ trách lẫn team; thiếu/sai → mặc định', () => {
    expect(parseBoardPrefs('{"assignee":"u1","teams":["qa",3]}')).toEqual({
      assignee: 'u1',
      teams: ['qa'],
    });
    expect(parseBoardPrefs('{"assignee":"u1"}')).toEqual({ assignee: 'u1', teams: [] });
    expect(parseBoardPrefs('khong-phai-json')).toEqual({ assignee: '', teams: [] });
    expect(parseBoardPrefs(null)).toEqual({ assignee: '', teams: [] });
  });
});
