import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { ArrowRight, BookOpen, History, LayoutDashboard, LayoutGrid, ListTodo, Moon, Plus, Search, Sparkles, Sun } from 'lucide-react';
import { useProjects } from '@/features/projects/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useTheme } from '@/stores/theme';
import { useRecents } from '@/stores/recentIssues';
import { LAST_VIEW_KEY } from '@/features/projects/ProjectLayout';
import { useQuickSearch } from './api';

/** Nhận dạng mã issue người dùng gõ (vd `DEMO-BUG-1`) để nhảy thẳng tới issue. */
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

/** Dự án hiện tại cho các hành động điều hướng: URL `/p/:key` → view gần nhất → dự án đầu. */
function currentProjectKey(projects: { key: string }[] | undefined): string | null {
  const m = /^\/p\/([^/]+)/.exec(window.location.pathname);
  if (m) return decodeURIComponent(m[1]);
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) || '{}') as { key?: string };
    if (saved.key && (projects ?? []).some((p) => p.key === saved.key)) return saved.key;
  } catch {
    /* ignore */
  }
  return projects?.[0]?.key ?? null;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const recents = useRecents((s) => s.items);

  const { data: projects } = useProjects();
  const trimmed = q.trim();
  const { data: issues, isFetching } = useQuickSearch(q);

  // Chạy một hành động rồi đóng bảng lệnh.
  const runAction = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  // Người dùng gõ đúng dạng mã issue → gợi ý nhảy thẳng.
  const issueKeyGuess = ISSUE_KEY_RE.test(trimmed.toUpperCase()) ? trimmed.toUpperCase() : null;

  // ⌘K / Ctrl+K bật/tắt bảng lệnh ở mọi nơi; sự kiện 'tirapro:command' mở từ nút nổi.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('tirapro:command', onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('tirapro:command', onOpen);
    };
  }, []);

  // Reset truy vấn khi đóng để lần mở sau luôn sạch.
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const showIssues = trimmed.length >= 2;
  const issueResults = issues ?? [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Lệnh nhanh"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-backdrop bg-black/30"
      contentClassName="fixed left-1/2 top-24 z-modal w-full max-w-lg -translate-x-1/2 rounded-xl border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="Tìm issue, điều hướng… (gõ để tìm)"
          className="w-full bg-transparent py-3 text-sm text-ink outline-none placeholder:text-faint"
        />
      </div>

      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-faint">
          {showIssues && isFetching ? 'Đang tìm…' : 'Không có kết quả.'}
        </Command.Empty>

        {/* Nhảy thẳng tới issue khi gõ đúng mã (vd DEMO-BUG-1) */}
        {issueKeyGuess && (
          <Command.Group
            heading="Đi tới issue"
            className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            <Command.Item
              value={`di toi issue ${issueKeyGuess}`}
              onSelect={() => runAction(() => navigate(`/issue/${issueKeyGuess}`))}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
            >
              <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span>
                Mở issue <span className="font-mono text-xs text-muted">{issueKeyGuess}</span>
              </span>
            </Command.Item>
          </Command.Group>
        )}

        {!trimmed && recents.length > 0 && (
          <Command.Group
            heading="Gần đây"
            className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            {recents.map((r) => (
              <Command.Item
                key={r.key}
                value={`gan day ${r.key} ${r.summary}`}
                onSelect={() => runAction(() => navigate(`/issue/${r.key}`))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
              >
                <History className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
                <span className="truncate">{r.summary}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group
          heading="Hành động"
          className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
        >
          <ActionItem
            value="tao issue create"
            icon={<Plus className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            label="Tạo issue"
            onSelect={() => runAction(() => openCreate({ projectKey: currentProjectKey(projects) ?? undefined }))}
          />
          <ActionItem
            value="doi giao dien theme sang toi"
            icon={theme === 'dark'
              ? <Sun className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              : <Moon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            label={theme === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}
            onSelect={() => runAction(toggleTheme)}
          />
          <ActionItem
            value="bat dau tour huong dan man nay"
            icon={<Sparkles className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            label="Bắt đầu tour màn này"
            onSelect={() => runAction(() => window.dispatchEvent(new Event('tirapro:tour')))}
          />
          <ActionItem
            value="mo tai lieu documentation huong dan"
            icon={<BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            label="Mở tài liệu"
            onSelect={() => runAction(() => navigate('/documentation'))}
          />
        </Command.Group>

        <Command.Group
          heading="Điều hướng"
          className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
        >
          <ActionItem
            value="tong quan dashboard home"
            icon={<LayoutDashboard className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            label="Tổng quan"
            onSelect={() => runAction(() => navigate('/'))}
          />
          {currentProjectKey(projects) && (
            <>
              <ActionItem
                value="di board bang hien tai"
                icon={<LayoutGrid className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                label="Board dự án hiện tại"
                onSelect={() => runAction(() => navigate(`/p/${currentProjectKey(projects)}/board`))}
              />
              <ActionItem
                value="di backlog hien tai"
                icon={<ListTodo className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                label="Backlog dự án hiện tại"
                onSelect={() => runAction(() => navigate(`/p/${currentProjectKey(projects)}/backlog`))}
              />
            </>
          )}
          <Command.Item
            value="trang du an projects home"
            onSelect={() => {
              navigate('/');
              setOpen(false);
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
          >
            <LayoutGrid className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <span>Trang dự án</span>
          </Command.Item>

          {(projects ?? []).map((p) => (
            <Command.Item
              key={p.id}
              value={`bang board ${p.key} ${p.name}`}
              onSelect={() => {
                navigate(`/p/${p.key}/board`);
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
            >
              <LayoutGrid className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">Bảng {p.name}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {showIssues && (
          <Command.Group
            heading="Issue"
            className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            {issueResults.map((issue) => (
              <Command.Item
                key={issue.id}
                value={`${issue.key} ${issue.summary}`}
                onSelect={() => {
                  navigate(`/issue/${issue.key}`);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
              >
                <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
                <span className="truncate">{issue.summary}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-faint">
        <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">↵</kbd> mở ·{' '}
        <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">esc</kbd> đóng
      </div>
    </Command.Dialog>
  );
}

/** Một dòng hành động/điều hướng trong bảng lệnh (icon + nhãn), style dùng chung. */
function ActionItem({
  value,
  icon,
  label,
  onSelect,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Command.Item>
  );
}
