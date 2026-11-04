import { describe, expect, it } from 'vitest';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import {
  buildGroupTree,
  groupCountLabel,
  groupCounts,
  groupKey,
  UNGROUPED_LABEL,
} from './groupModel';

const G = (id: string, name: string, color: string | null = null): ProjectProgramRefDto => ({
  id,
  name,
  color,
});
const P = (key: string, programs: ProjectProgramRefDto[], over: Partial<ProjectDto> = {}) =>
  ({ id: `id-${key}`, key, name: key, programs, archivedAt: null, ...over }) as ProjectDto;

const A = G('a', 'Hạ tầng', '#111');
const B = G('b', 'Khách hàng');
const E = G('e', 'Nhóm rỗng');

describe('buildGroupTree', () => {
  it('dự án thuộc nhiều nhóm hiện dưới TỪNG nhóm; không nhóm nào → nút cuối `id === null`', () => {
    const tree = buildGroupTree([P('X', [A, B]), P('Y', [A]), P('Z', [])], [A, B], {
      hideEmpty: false,
    });
    expect(tree.map((g) => [g.id, g.projects.map((p) => p.key)])).toEqual([
      ['a', ['X', 'Y']],
      ['b', ['X']],
      [null, ['Z']],
    ]);
    expect(tree.at(-1)).toMatchObject({ id: null, name: UNGROUPED_LABEL, color: null });
  });

  it('nhận biết nút "Chưa thuộc nhóm" bằng id, không bằng chữ: một nhóm THẬT tên "Chưa thuộc nhóm" vẫn là nhóm', () => {
    const fake = G('real', UNGROUPED_LABEL);
    const tree = buildGroupTree([P('X', [fake]), P('Z', [])], [fake], { hideEmpty: false });
    expect(tree.map((g) => g.id)).toEqual(['real', null]);
    expect(groupKey(tree[0]!)).toBe('real');
    expect(groupKey(tree[1]!)).toBe('__ungrouped__');
  });

  it('giữ thứ tự dự án của đầu vào; nhóm xếp theo tên tiếng Việt', () => {
    const tree = buildGroupTree([P('B2', [A]), P('A1', [A])], [B, A], { hideEmpty: false });
    expect(tree.map((g) => g.name)).toEqual(['Hạ tầng', 'Khách hàng']);
    expect(tree[0]!.projects.map((p) => p.key)).toEqual(['B2', 'A1']);
  });

  it('nhóm rỗng: hiện khi không lọc, ẩn khi đang lọc (hideEmpty); nút "Chưa thuộc nhóm" chỉ có khi có dự án', () => {
    const projects = [P('X', [A])];
    expect(buildGroupTree(projects, [A, E], { hideEmpty: false }).map((g) => g.id)).toEqual([
      'a',
      'e',
    ]);
    expect(buildGroupTree(projects, [A, E], { hideEmpty: true }).map((g) => g.id)).toEqual(['a']);
    expect(buildGroupTree([], [A], { hideEmpty: false }).map((g) => g.id)).toEqual(['a']);
  });

  it('nhóm có trên dự án nhưng chưa có trong danh mục (cache lệch) vẫn được dựng; id trùng trên một dự án không đếm đôi', () => {
    const tree = buildGroupTree([P('X', [A, A])], [], { hideEmpty: false });
    expect(tree).toHaveLength(1);
    expect(tree[0]!.projects).toHaveLength(1);
  });

  it('dự án đã lưu trữ chỉ có mặt nếu đầu vào có (bộ lọc "Hiện đã lưu trữ" áp trước khi dựng cây): số dự án theo đúng đầu vào', () => {
    const live = P('L', [A]);
    const arch = P('R', [A], { archivedAt: '2026-10-01T00:00:00Z' });
    expect(buildGroupTree([live], [A], { hideEmpty: false })[0]!.projects).toHaveLength(1);
    expect(buildGroupTree([live, arch], [A], { hideEmpty: false })[0]!.projects).toHaveLength(2);
  });
});

describe('groupCounts / groupCountLabel', () => {
  it('đếm dự án đang hiện theo nhóm (không đếm đôi), nhóm không dự án không có khoá', () => {
    const c = groupCounts([P('X', [A, B]), P('Y', [A]), P('Z', [])]);
    expect(c.get('a')).toBe(2);
    expect(c.get('b')).toBe(1);
    expect(c.has('e')).toBe(false);
  });
  it('cột Nhóm: "N nhóm", 0 → "—"', () => {
    expect(groupCountLabel(0)).toBe('—');
    expect(groupCountLabel(1)).toBe('1 nhóm');
    expect(groupCountLabel(3)).toBe('3 nhóm');
  });
});
