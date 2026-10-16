import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Archive, Lock, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useProjects } from './api';
import { CreateProjectModal } from './CreateProjectModal';
import { useShowArchived } from './showArchived';
import { railAutoKey, railStorageKey, resolveRailCollapsed } from '@/lib/railPref';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

const iconBtn =
  'grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

/** Đọc trạng thái thu/mở đã lưu của người dùng ('1' | '0' | null = chưa từng chọn). */
function readRailPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Rail dự án (submenu trái) — danh sách dự án + nút tạo dự án.
 * Dùng chung cho ProjectLayout và trang chi tiết issue để luôn giữ ngữ cảnh dự án.
 * Hai chế độ: mở (224px) / thu thành dải khoá 3 chữ (56px), nhớ theo người dùng; chưa chọn thì
 * tự thu khi workspace có ≤ 3 dự án để Bảng việc thấy đủ cột.
 *
 *  activeKey — key dự án đang xem (tô sáng).
 *  view      — segment view để link sang (board/backlog/…); mặc định "board".
 */
export function ProjectRail(props: { activeKey: string; view?: string }) {
  const userId = useAuth((s) => s.user?.id);
  // `key` theo người dùng → đổi tài khoản thì rail dựng lại và đọc đúng lựa chọn của người đó.
  return <RailInner key={userId ?? 'anon'} userId={userId} {...props} />;
}

function RailInner({
  userId,
  activeKey,
  view = 'board',
}: {
  userId: string | undefined;
  activeKey: string;
  view?: string;
}) {
  const [showArchived, toggleArchived] = useShowArchived();
  const { data: projects } = useProjects(showArchived);
  const [createProject, setCreateProject] = useState(false);
  const canCreate = useAuth((s) => s.can('project:create'));
  const storageKey = railStorageKey(userId);
  const autoKey = railAutoKey(userId);
  // Đọc đồng bộ trước lần vẽ đầu: lựa chọn của người dùng + kết quả tự động lần trước (cache trống vẫn vẽ đúng, không nháy).
  const [pref, setPref] = useState<string | null>(() => readRailPref(storageKey));
  const [lastAuto] = useState(() => readRailPref(autoKey) === '1');
  // Ngưỡng tự thu chỉ đếm dự án đang hoạt động → đổi ô "Hiện đã lưu trữ" không làm rail tự đổi dưới con trỏ.
  const activeCount = projects ? projects.filter((p) => !p.archivedAt).length : undefined;
  const collapsed = resolveRailCollapsed(pref, activeCount, lastAuto);
  useEffect(() => {
    if (pref !== null || activeCount === undefined) return;
    try {
      localStorage.setItem(autoKey, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [pref, activeCount, collapsed, autoKey]);
  const toggleCollapsed = () => {
    const next = collapsed ? '0' : '1';
    setPref(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <aside
        aria-label="Danh sách dự án"
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-surface print:hidden lg:flex',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 py-3',
            collapsed ? 'flex-col px-2' : 'justify-between px-3',
          )}
        >
          {!collapsed && <span className="text-sm font-semibold text-ink-strong">Dự án</span>}
          <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreateProject(true)}
                aria-label="Tạo dự án"
                title="Tạo dự án"
                className={iconBtn}
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            {collapsed && (
              <button
                type="button"
                onClick={() => toggleArchived(!showArchived)}
                aria-pressed={showArchived}
                aria-label="Hiện dự án đã lưu trữ"
                title={showArchived ? 'Đang hiện dự án đã lưu trữ' : 'Hiện dự án đã lưu trữ'}
                className={cn(iconBtn, showArchived && 'bg-primary-subtle text-primary')}
              >
                <Archive className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Mở rộng danh sách dự án' : 'Thu gọn danh sách dự án'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Mở rộng' : 'Thu gọn'}
              className={iconBtn}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <nav
          className={cn('flex-1 space-y-0.5 overflow-y-auto pb-2', collapsed ? 'px-1.5' : 'px-2')}
        >
          {(projects ?? []).map((p) => (
            <NavLink
              key={p.id}
              to={`/p/${p.key}/${view}`}
              title={collapsed ? `${p.name}${p.archivedAt ? ' (đã lưu trữ)' : ''}` : undefined}
              aria-label={collapsed ? `${p.name}${p.archivedAt ? ' (đã lưu trữ)' : ''}` : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md text-sm transition-colors',
                collapsed ? 'justify-center px-1 py-1.5' : 'px-2.5 py-2',
                p.key === activeKey
                  ? 'bg-primary-subtle font-medium text-primary'
                  : 'text-ink hover:bg-surface-2',
              )}
            >
              <span
                className={cn(
                  'relative grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-2 font-mono text-[10px] font-bold text-muted',
                  collapsed &&
                    p.archivedAt &&
                    'border border-dashed border-border-strong opacity-60',
                )}
              >
                {p.key.slice(0, 3)}
                {collapsed && p.archivedAt && (
                  <Archive
                    className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-surface text-faint"
                    aria-hidden
                  />
                )}
              </span>
              {!collapsed && <span className="min-w-0 flex-1 truncate">{p.name}</span>}
              {!collapsed && p.isPrivate && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Dự án riêng tư" />
              )}
              {!collapsed && p.archivedAt && (
                <Archive className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Đã lưu trữ" />
              )}
            </NavLink>
          ))}
          {projects && projects.length === 0 && !collapsed && (
            <p className="px-2 py-4 text-xs text-faint">Chưa có dự án.</p>
          )}
        </nav>
        {!collapsed && (
          <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => toggleArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            Hiện đã lưu trữ
          </label>
        )}
      </aside>

      <CreateProjectModal open={createProject} onClose={() => setCreateProject(false)} />
    </>
  );
}
