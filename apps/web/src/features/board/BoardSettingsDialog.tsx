import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { SWIMLANE_BY, type BoardDto, type BoardType, type SwimlaneBy } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { DelayedSpinner } from '@/components/ui/primitives';
import { QueryBuilder } from '@/features/saved-filters/QueryBuilder';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { apiErrorMessage } from '@/lib/api';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';
import { boardMetaPatch } from './boardPatch';
import {
  useProjectStatuses,
  useSetBoardColumns,
  useUpdateBoard,
  type BoardColumnInput,
} from './api';
import { SearchSelect } from '@/components/ui/SearchSelect';

export const SWIMLANE_LABEL: Record<SwimlaneBy, string> = {
  none: 'Không chia hàng',
  assignee: 'Theo người phụ trách',
  epic: 'Theo epic',
  priority: 'Theo mức ưu tiên',
  parent: 'Theo việc cha',
};

const SWIMLANE_HINT: Record<SwimlaneBy, string> = {
  none: 'Một bảng phẳng, mỗi cột là một trạng thái.',
  assignee: 'Mỗi người một hàng. Kéo việc sang hàng khác để giao cho người đó.',
  epic: 'Gom việc theo epic để thấy tiến độ từng mảng lớn.',
  priority: 'Việc quan trọng nằm hàng trên cùng.',
  parent: 'Việc con nằm cùng hàng với việc cha.',
};

const BOARD_TYPE_LABEL: Record<BoardType, string> = {
  SCRUM: 'Scrum',
  KANBAN: 'Kanban',
};

const BOARD_TYPE_HINT: Record<BoardType, string> = {
  SCRUM:
    'Chỉ hiện việc của sprint đang chạy; không có sprint đang chạy thì bảng trống. Giới hạn WIP cũng chỉ đếm việc của sprint đó.',
  KANBAN:
    'Hiện mọi việc của dự án, không phụ thuộc sprint. Giới hạn WIP đếm tất cả việc trong cột.',
};

type Tab = 'columns' | 'filter' | 'swimlane' | 'type';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'columns', label: 'Cột' },
  { id: 'filter', label: 'Bộ lọc' },
  { id: 'swimlane', label: 'Swimlane' },
  { id: 'type', label: 'Loại bảng' },
];

interface DraftColumn {
  /** Khoá React ổn định (id thật với cột cũ, `new-n` với cột mới). */
  key: string;
  id?: string;
  name: string;
  statusIds: string[];
  /** Chuỗi để gõ dở được; rỗng = không giới hạn. */
  wip: string;
}

function toDraft(board: BoardDto): DraftColumn[] {
  return [...board.columns]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      statusIds: [...c.statusIds],
      wip: c.wipLimit != null ? String(c.wipLimit) : '',
    }));
}

const sameColumns = (a: DraftColumn[], b: DraftColumn[]) =>
  JSON.stringify(a.map(({ id, name, statusIds, wip }) => [id, name, statusIds, wip])) ===
  JSON.stringify(b.map(({ id, name, statusIds, wip }) => [id, name, statusIds, wip]));

/**
 * Cài đặt bảng: cột (đổi tên, sắp xếp bằng nút lên/xuống, gán trạng thái, giới hạn WIP), bộ lọc JQL, swimlane.
 * Mọi trạng thái của quy trình phải nằm đúng một cột — dialog chặn Lưu và chỉ rõ trạng thái còn thiếu.
 * Mount mới mỗi lần mở (state khởi tạo từ `board`).
 */
export function BoardSettingsDialog({
  open,
  onClose,
  projectId,
  board,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  board: BoardDto;
}) {
  const statusesQ = useProjectStatuses(projectId);
  const updateBoard = useUpdateBoard(projectId, board.id);
  const setColumns = useSetBoardColumns(projectId, board.id);

  const initialColumns = useMemo(() => toDraft(board), [board]);
  const [tab, setTab] = useState<Tab>('columns');
  const [name, setName] = useState(board.name);
  const [columns, setColumnsDraft] = useState<DraftColumn[]>(initialColumns);
  const [jql, setJql] = useState(board.filterJql ?? '');
  const [jqlMode, setJqlMode] = useState<'simple' | 'jql'>('simple');
  const [swimlane, setSwimlane] = useState<SwimlaneBy>(board.swimlaneBy);
  const [type, setType] = useState<BoardType>(board.type);
  const [jqlError, setJqlError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const saving = updateBoard.isPending || setColumns.isPending;

  const statuses = useMemo(() => statusesQ.data ?? [], [statusesQ.data]);
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const assigned = new Set(columns.flatMap((c) => c.statusIds));
  const unassigned = statuses.filter((s) => !assigned.has(s.id));

  // ----- kiểm tra trước khi lưu -----
  const names = columns.map((c) => c.name.trim().toLowerCase());
  const problems: string[] = [];
  if (statusesQ.data) {
    if (unassigned.length)
      problems.push(
        `Trạng thái chưa nằm trong cột nào: ${unassigned.map((s) => s.name).join(', ')}`,
      );
  }
  if (columns.some((c) => !c.name.trim())) problems.push('Có cột chưa đặt tên');
  if (new Set(names).size !== names.length) problems.push('Tên cột bị trùng nhau');
  if (columns.some((c) => c.statusIds.length === 0))
    problems.push('Mỗi cột cần ít nhất một trạng thái');
  if (columns.some((c) => c.wip !== '' && !/^[1-9]\d{0,2}$/.test(c.wip)))
    problems.push('Giới hạn WIP phải là số nguyên từ 1 trở lên (bỏ trống nếu không giới hạn)');
  if (columns.length === 0) problems.push('Bảng cần ít nhất một cột');

  const columnsDirty = !sameColumns(columns, initialColumns);
  const metaPatch = boardMetaPatch(board, { name, jql, swimlane, type });
  const metaDirty = Object.keys(metaPatch).length > 0;
  const dirty = columnsDirty || metaDirty;
  const canSave = dirty && !saving && !!name.trim() && (!columnsDirty || problems.length === 0);

  // ----- thao tác trên bản nháp cột -----
  const patchColumn = (key: string, patch: Partial<DraftColumn>) =>
    setColumnsDraft((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const moveColumn = (idx: number, dir: -1 | 1) =>
    setColumnsDraft((cs) => {
      const j = idx + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  const removeColumn = (key: string) => setColumnsDraft((cs) => cs.filter((c) => c.key !== key));
  const addColumn = () => {
    setColumnsDraft((cs) => [...cs, { key: `new-${seq}`, name: '', statusIds: [], wip: '' }]);
    setSeq((n) => n + 1);
  };
  /** Gán trạng thái vào cột; nếu đang ở cột khác thì chuyển sang (một trạng thái chỉ ở một cột). */
  const assignStatus = (key: string, statusId: string) =>
    setColumnsDraft((cs) =>
      cs.map((c) => {
        if (c.key === key) return { ...c, statusIds: [...c.statusIds, statusId] };
        return { ...c, statusIds: c.statusIds.filter((s) => s !== statusId) };
      }),
    );
  const unassignStatus = (key: string, statusId: string) =>
    patchColumn(key, {
      statusIds: columns.find((c) => c.key === key)!.statusIds.filter((s) => s !== statusId),
    });

  async function save() {
    setJqlError(null);
    try {
      if (metaDirty) {
        await updateBoard.mutateAsync(metaPatch);
      }
      if (columnsDirty) {
        const payload: BoardColumnInput[] = columns.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          name: c.name.trim(),
          statusIds: c.statusIds,
          wipLimit: c.wip === '' ? null : Number(c.wip),
        }));
        await setColumns.mutateAsync(payload);
      }
      toast.success('Đã lưu cài đặt bảng');
      onClose();
    } catch (e) {
      const msg = apiErrorMessage(e);
      if (msg.startsWith('Bộ lọc JQL')) {
        setJqlError(msg);
        setTab('filter');
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      title="Cài đặt bảng"
      description="Chọn cột, giới hạn việc đang làm (WIP), bộ lọc và cách chia hàng cho bảng này."
      size="lg"
      footer={
        <>
          {columnsDirty && problems.length > 0 && (
            <p className="min-w-0 flex-1 text-xs text-danger" role="alert">
              {problems[0]}
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!canSave}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="board-name" className="mb-1.5 block text-sm font-medium text-muted">
            Tên bảng
          </label>
          <Input
            id="board-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="text-sm"
          />
        </div>

        <SegmentedControl
          ariaLabel="Mục cài đặt bảng"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ value: t.id, label: t.label }))}
        />

        {tab === 'columns' && (
          <ColumnsTab
            statusesQ={statusesQ}
            statuses={statuses}
            statusById={statusById}
            columns={columns}
            unassigned={unassigned}
            ops={{ patchColumn, moveColumn, removeColumn, addColumn, assignStatus, unassignStatus }}
          />
        )}

        {tab === 'filter' && (
          <FilterTab
            jql={jql}
            setJql={setJql}
            jqlMode={jqlMode}
            setJqlMode={setJqlMode}
            jqlError={jqlError}
            setJqlError={setJqlError}
          />
        )}

        {tab === 'swimlane' && <SwimlaneTab swimlane={swimlane} setSwimlane={setSwimlane} />}

        {tab === 'type' && <TypeTab type={type} setType={setType} />}
      </div>
    </Dialog>
  );
}

type StatusList = NonNullable<ReturnType<typeof useProjectStatuses>['data']>;
interface ColumnOps {
  patchColumn: (key: string, patch: Partial<DraftColumn>) => void;
  moveColumn: (idx: number, dir: -1 | 1) => void;
  removeColumn: (key: string) => void;
  addColumn: () => void;
  assignStatus: (key: string, statusId: string) => void;
  unassignStatus: (key: string, statusId: string) => void;
}

function ColumnsTab({
  statusesQ,
  statuses,
  statusById,
  columns,
  unassigned,
  ops,
}: {
  statusesQ: ReturnType<typeof useProjectStatuses>;
  statuses: StatusList;
  statusById: Map<string, StatusList[number]>;
  columns: DraftColumn[];
  unassigned: StatusList;
  ops: ColumnOps;
}) {
  const { patchColumn, moveColumn, removeColumn, addColumn, assignStatus, unassignStatus } = ops;
  return (
    <div className="space-y-3">
      {statusesQ.isLoading && <DelayedSpinner />}
      {statusesQ.isError && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          Không tải được danh sách trạng thái của dự án. Đóng hộp thoại và thử lại.
        </p>
      )}
      {columns.map((c, idx) => {
        const addable = statuses.filter((s) => !c.statusIds.includes(s.id));
        return (
          <div key={c.key} className="rounded-lg border border-border bg-bg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Tên cột ${idx + 1}`}
                value={c.name}
                maxLength={60}
                placeholder="Tên cột"
                onChange={(e) => patchColumn(c.key, { name: e.target.value })}
                className="h-8 min-w-[9rem] flex-1 text-sm"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Giới hạn WIP
                <Input
                  aria-label={`Giới hạn WIP của cột ${c.name || idx + 1}`}
                  inputMode="numeric"
                  value={c.wip}
                  placeholder="∞"
                  onChange={(e) => patchColumn(c.key, { wip: e.target.value.trim() })}
                  className="h-8 w-16 px-2 text-center text-sm"
                />
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Đưa cột ${c.name || idx + 1} lên trước`}
                disabled={idx === 0}
                onClick={() => moveColumn(idx, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Đưa cột ${c.name || idx + 1} ra sau`}
                disabled={idx === columns.length - 1}
                onClick={() => moveColumn(idx, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-danger"
                aria-label={`Xoá cột ${c.name || idx + 1}`}
                onClick={() => removeColumn(c.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.statusIds.map((sid) => {
                const s = statusById.get(sid);
                return (
                  <span
                    key={sid}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2 pr-1 text-xs text-ink"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: s ? categoryColor(s.category) : 'var(--faint)' }}
                      aria-hidden
                    />
                    {s?.name ?? 'Trạng thái đã xoá'}
                    <button
                      type="button"
                      aria-label={`Bỏ trạng thái ${s?.name ?? ''} khỏi cột ${c.name || idx + 1}`}
                      onClick={() => unassignStatus(c.key, sid)}
                      className="grid h-4 w-4 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {c.statusIds.length === 0 && (
                <span className="text-xs text-danger">
                  Chưa có trạng thái nào — thêm ít nhất một.
                </span>
              )}
              {addable.length > 0 && (
                <SearchSelect
                  ariaLabel={`Thêm trạng thái vào cột ${c.name || idx + 1}`}
                  value=""
                  onChange={(v) => {
                    if (v) assignStatus(c.key, v);
                  }}
                  options={addable.map((s) => {
                    const owner = columns.find(
                      (o) => o.key !== c.key && o.statusIds.includes(s.id),
                    );
                    return {
                      value: s.id,
                      label: s.name,
                      color: categoryColor(s.category),
                      description: owner
                        ? `Chuyển từ “${owner.name || 'cột chưa đặt tên'}”`
                        : undefined,
                    };
                  })}
                  searchPlaceholder="Tìm trạng thái…"
                  hideChevron
                  className="h-7 w-auto border-dashed bg-surface px-2 text-xs"
                  renderTrigger={() => <span className="text-muted">+ Thêm trạng thái…</span>}
                />
              )}
            </div>
          </div>
        );
      })}

      <Button variant="secondary" size="sm" onClick={addColumn}>
        <Plus className="h-4 w-4" /> Thêm cột
      </Button>

      {statusesQ.data && unassigned.length > 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-ink" role="status">
          Chưa nằm trong cột nào:{' '}
          <span className="font-medium">{unassigned.map((s) => s.name).join(', ')}</span>. Việc ở
          các trạng thái này sẽ không hiện trên bảng — hãy thêm chúng vào một cột.
        </p>
      )}
      <p className="text-xs text-faint">
        Giới hạn WIP là số việc tối đa nên có cùng lúc trong cột (bảng Scrum chỉ đếm việc của sprint
        đang chạy). Khi cột đầy, chỉ quản trị dự án mới được chọn “Vẫn chuyển”.
      </p>
    </div>
  );
}

function FilterTab({
  jql,
  setJql,
  jqlMode,
  setJqlMode,
  jqlError,
  setJqlError,
}: {
  jql: string;
  setJql: (v: string) => void;
  jqlMode: 'simple' | 'jql';
  setJqlMode: (m: 'simple' | 'jql') => void;
  jqlError: string | null;
  setJqlError: (e: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Chỉ hiện trên bảng những việc khớp bộ lọc (trong phạm vi dự án này). Để trống để hiện tất
        cả.
      </p>
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="Chế độ bộ lọc bảng"
          fullWidth={false}
          value={jqlMode}
          onChange={setJqlMode}
          options={[
            { value: 'simple', label: 'Đơn giản' },
            { value: 'jql', label: 'JQL' },
          ]}
        />
        {jql.trim() && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setJql('');
              setJqlError(null);
            }}
          >
            Bỏ bộ lọc
          </Button>
        )}
      </div>
      {jqlMode === 'simple' ? (
        <QueryBuilder
          value={jql}
          onChange={(v) => {
            setJql(v);
            setJqlError(null);
          }}
          onEditAsJql={() => setJqlMode('jql')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="board-jql" className="text-sm font-medium text-muted">
            Truy vấn JQL
          </label>
          <textarea
            id="board-jql"
            value={jql}
            onChange={(e) => {
              setJql(e.target.value);
              setJqlError(null);
            }}
            rows={3}
            spellCheck={false}
            placeholder="assignee = currentUser() AND priority = High"
            className={cn(
              'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-ink',
              'placeholder:text-faint focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            )}
          />
        </div>
      )}
      {jqlError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {jqlError}
        </p>
      )}
    </div>
  );
}

function SwimlaneTab({
  swimlane,
  setSwimlane,
}: {
  swimlane: SwimlaneBy;
  setSwimlane: (v: SwimlaneBy) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm text-muted">Chia bảng thành các hàng (swimlane) theo:</legend>
      {SWIMLANE_BY.map((opt) => (
        <label
          key={opt}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
            swimlane === opt
              ? 'border-primary bg-primary-subtle'
              : 'border-border hover:bg-surface-2',
          )}
        >
          <input
            type="radio"
            name="swimlane"
            checked={swimlane === opt}
            onChange={() => setSwimlane(opt)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{SWIMLANE_LABEL[opt]}</span>
            <span className="block text-xs text-muted">{SWIMLANE_HINT[opt]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function TypeTab({ type, setType }: { type: BoardType; setType: (v: BoardType) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm text-muted">Loại bảng:</legend>
      {(Object.keys(BOARD_TYPE_LABEL) as BoardType[]).map((opt) => (
        <label
          key={opt}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
            type === opt ? 'border-primary bg-primary-subtle' : 'border-border hover:bg-surface-2',
          )}
        >
          <input
            type="radio"
            name="board-type"
            checked={type === opt}
            onChange={() => setType(opt)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{BOARD_TYPE_LABEL[opt]}</span>
            <span className="block text-xs text-muted">{BOARD_TYPE_HINT[opt]}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-faint">
        Đổi loại không xoá hay di chuyển việc nào; có thể đổi lại bất cứ lúc nào.
      </p>
    </fieldset>
  );
}
