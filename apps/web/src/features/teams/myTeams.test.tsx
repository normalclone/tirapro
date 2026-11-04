// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TeamDto, UserDto } from '@tirapro/types';
import { MyTeamsPage, teamsOf } from './MyTeamsPage';

const u = (id: string, name: string) => ({ id, displayName: name, email: `${id}@x.vn` }) as UserDto;
const team = (id: string, name: string, members: UserDto[], lead?: UserDto): TeamDto => ({
  id,
  workspaceId: 'w',
  name,
  key: id,
  members,
  memberCount: members.length,
  lead: lead ?? null,
  createdAt: '2026-11-04',
});

const me = u('me', 'Tôi');
const a = u('a', 'An');
const b = u('b', 'Bình');
const TEAMS = [
  team('t1', 'Nhóm Test', [me, a]),
  team('t2', 'Nhóm Dev', [b]),
  team('t3', 'Nhóm BA', [a], me),
];

vi.mock('./api', () => ({
  useTeams: () => ({ data: TEAMS, isError: false, error: null, refetch: () => {} }),
}));
vi.mock('@/stores/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ user: me }),
}));
vi.mock('@/components/layout/PageFrame', () => ({
  PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Nhóm của tôi', () => {
  it('teamsOf: chỉ nhóm mình là thành viên hoặc trưởng nhóm', () => {
    expect(teamsOf(TEAMS, 'me').map((t) => t.id)).toEqual(['t1', 't3']);
    expect(teamsOf(TEAMS, undefined)).toEqual([]);
  });
  it('liệt kê nhóm của tôi, bấm nhóm thì hiện thành viên', () => {
    render(<MyTeamsPage />);
    expect(screen.getByText('Nhóm Test')).toBeTruthy();
    expect(screen.getByText('Nhóm BA')).toBeTruthy();
    expect(screen.queryByText('Nhóm Dev')).toBeNull();
    const btn = screen.getByRole('button', { name: /Nhóm Test/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Thành viên nhóm Nhóm Test' })).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Thành viên nhóm Nhóm Test' });
    expect(list.textContent).toContain('An');
    expect(list.textContent).toContain('(bạn)');
  });
});
