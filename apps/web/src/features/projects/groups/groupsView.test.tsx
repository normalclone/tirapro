// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseView, useProjectsView } from './groupsView';

const wrap = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { initialEntries: [initial] }, children);
  };

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('parseView', () => {
  it('chỉ nhận list/groups', () => {
    expect(parseView('list')).toBe('list');
    expect(parseView('groups')).toBe('groups');
    expect(parseView('tree')).toBeNull();
    expect(parseView(null)).toBeNull();
  });
});

describe('useProjectsView', () => {
  it('mặc định "Danh sách"; đổi chế độ được NHỚ (localStorage) và ghi vào ?view=', () => {
    const { result } = renderHook(
      () => {
        const [view, setView] = useProjectsView();
        return { view, setView, search: useLocation().search };
      },
      { wrapper: wrap('/projects') },
    );
    expect(result.current.view).toBe('list');
    act(() => result.current.setView('groups'));
    expect(result.current.view).toBe('groups');
    expect(result.current.search).toBe('?view=groups');
    expect(localStorage.getItem('tirapro:projectsView')).toBe('groups');
  });

  it('lần sau vào lại dùng lựa chọn đã nhớ', () => {
    localStorage.setItem('tirapro:projectsView', 'groups');
    const { result } = renderHook(() => useProjectsView()[0], { wrapper: wrap('/projects') });
    expect(result.current).toBe('groups');
  });

  it('?view= trên đường dẫn thắng lựa chọn đã nhớ (chuyển hướng cũ /projects?view=groups)', () => {
    localStorage.setItem('tirapro:projectsView', 'list');
    const { result } = renderHook(() => useProjectsView()[0], {
      wrapper: wrap('/projects?view=groups'),
    });
    expect(result.current).toBe('groups');
    const bad = renderHook(() => useProjectsView()[0], { wrapper: wrap('/projects?view=xyz') });
    expect(bad.result.current).toBe('list'); // giá trị lạ bị bỏ qua, rơi về lựa chọn đã nhớ
  });

  it('localStorage hỏng/bị chặn: không vỡ, vẫn đổi được trong phiên', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(
      () => {
        const [view, setView] = useProjectsView();
        return { view, setView };
      },
      { wrapper: wrap('/projects') },
    );
    expect(result.current.view).toBe('list');
    act(() => result.current.setView('groups'));
    expect(result.current.view).toBe('groups');
  });
});
