import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { RadioCard } from '@/components/ui/RadioCard';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import type { Block } from './blocks';
import {
  MODE_LABEL,
  SKIP,
  computeAssign,
  computeMembers,
  initialAssignState,
  initialMemberState,
  type AssignCard,
  type AssignComputed,
  type AssignMode,
  type AssignState,
  type MemberCard,
  type MemberComputed,
  type MemberState,
  type OutcomeRow,
  type PersonSlot,
} from './bulkPreview';
import { apiExecutor, runConfirm, runUndo, type BulkExecutor } from './bulkRun';
import type { ConversationAction } from './conversation';
import { useAssistantPanel } from './panelStore';

export type BulkBlock = Extract<Block, { type: 'bulk' }>;

const personLine = (p: { name: string; email: string | null }): string =>
  p.email ? `${p.name} (${p.email})` : p.name;

const MODE_HINT: Record<AssignMode, string> = {
  one: 'Mọi việc cho đúng một người bạn chọn.',
  'round-robin': 'Lần lượt từng người theo thứ tự mã việc.',
  points:
    'Cân tổng điểm mỗi người, tính cả việc chưa xong họ đang giữ (việc chưa ước lượng tính 1 điểm).',
  pairs: 'Mỗi việc cho đúng người đã nêu trong lệnh.',
};

const MODE_SHORT: Record<AssignMode, string> = {
  one: 'Một người',
  'round-robin': 'Lần lượt',
  points: 'Theo điểm',
  pairs: 'Theo cặp',
};

/** Trạng thái một dòng: luôn có chữ (không chỉ màu). */
function Chip({ tone, children }: { tone: 'ok' | 'muted' | 'bad'; children: string }) {
  const cls = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] font-medium ${cls}`}>
      {tone === 'ok' ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      {tone === 'bad' ? <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Danh sách "chọn người" cho từng tên mơ hồ — luôn kèm email để phân biệt. */
function Choices({
  slots,
  picks,
  onPick,
}: {
  slots: PersonSlot[];
  picks: Record<string, string>;
  onPick: (query: string, id: string) => void;
}) {
  const ambiguous = slots.filter((s) => !s.person && s.options);
  if (ambiguous.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {ambiguous.map((s) => (
        <div key={s.query}>
          <p className="mb-1.5 text-sm font-medium text-ink-strong">
            “{s.query}” khớp {s.options!.length} người — chọn một:
          </p>
          <RadioCard
            size="sm"
            ariaLabel={`Chọn người cho ${s.query}`}
            value={picks[s.query] ?? null}
            onChange={(id) => onPick(s.query, id)}
            options={s.options!.map((o) => ({
              value: o.id,
              label: o.name,
              description: o.email ?? 'Không có email',
            }))}
          />
        </div>
      ))}
    </div>
  );
}

function Blocking({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label="Chưa xác nhận được vì"
      className="mt-3 flex flex-col gap-1 text-[13px] text-warning-ink"
    >
      {items.map((t) => (
        <li key={t} className="flex gap-1.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Notes({ lines, tone = 'muted' }: { lines: string[]; tone?: 'muted' | 'warn' }) {
  if (lines.length === 0) return null;
  return (
    <ul
      className={`mt-2 flex flex-col gap-0.5 text-[13px] ${tone === 'warn' ? 'text-warning-ink' : 'text-muted'}`}
    >
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

/** Danh sách kết quả từng dòng (sau khi chạy / hoàn tác). */
function OutcomeList({ rows }: { rows: OutcomeRow[] }) {
  return (
    <ul className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
      {rows.map((r, i) => (
        <li
          key={`${r.label}-${i}`}
          className="border-b border-border px-2.5 py-1.5 text-[13px] last:border-b-0"
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 break-words text-ink-strong">{r.label}</span>
            <span className="text-muted">{r.detail}</span>
            <Chip tone={r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'bad' : 'muted'}>
              {r.status === 'ok' ? 'Đã làm' : r.status === 'failed' ? 'Lỗi' : 'Bỏ qua'}
            </Chip>
          </div>
          {r.reason ? <p className="mt-0.5 text-muted">{r.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ giao việc ------------------------------ */

function AssignEditor({
  card,
  state,
  computed,
  onState,
}: {
  card: AssignCard;
  state: AssignState;
  computed: AssignComputed;
  onState: (s: AssignState) => void;
}) {
  const pool = computed.pool;
  const personOptions: SearchSelectOption[] = pool.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.email ?? undefined,
  }));
  const rowOptions: SearchSelectOption[] = [
    ...personOptions,
    { value: SKIP, label: 'Bỏ dòng này' },
    { value: 'auto', label: 'Theo cách chia' },
  ];
  return (
    <>
      <Choices
        slots={card.slots}
        picks={state.picks}
        onPick={(q, id) => onState({ ...state, picks: { ...state.picks, [q]: id } })}
      />
      <div className="mt-3">
        <p id="bulk-mode-label" className="mb-1.5 text-sm font-medium text-ink-strong">
          Cách chia
        </p>
        <SegmentedControl<AssignMode>
          ariaLabelledby="bulk-mode-label"
          size="sm"
          fullWidth
          value={state.mode}
          onChange={(mode) => onState({ ...state, mode })}
          options={card.modes.map((m) => ({
            value: m,
            label: MODE_SHORT[m],
            title: MODE_LABEL[m],
          }))}
        />
        <p className="mt-1.5 text-[13px] text-muted">{MODE_HINT[state.mode]}</p>
        {state.mode === 'one' && pool.length > 0 ? (
          <div className="mt-2 max-w-xs">
            <SearchSelect
              ariaLabel="Người nhận"
              value={state.oneId ?? pool[0]!.id}
              onChange={(oneId) => onState({ ...state, oneId })}
              options={personOptions}
            />
          </div>
        ) : null}
      </div>
      {computed.perPerson.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-0.5 text-[13px]" aria-label="Tóm tắt người nhận">
          {computed.perPerson.map(({ person, count, points }) => (
            <li key={person.id} className="text-ink">
              <span className="font-medium text-ink-strong">{personLine(person)}</span>
              {card.slots.find((s) => s.person?.id === person.id)?.approx ? (
                <span className="text-warning-ink"> (gần đúng — kiểm tra lại)</span>
              ) : null}
              <span className="text-muted">
                {' '}
                — {count} việc · {points} điểm
                {card.loads[person.id] ? ` · đang giữ ${card.loads[person.id]} điểm` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul
        className="mt-3 max-h-80 overflow-auto rounded-md border border-border"
        aria-label="Các việc sẽ giao"
      >
        {computed.rows.map((r) => {
          const value = state.overrides[r.src.issueId] ?? 'auto';
          const shown = value === 'auto' ? (r.target?.id ?? '') : value;
          return (
            <li key={r.src.issueId} className="border-b border-border px-2.5 py-2 last:border-b-0">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs text-muted">{r.src.key}</span>
                <span className="min-w-0 break-words text-sm text-ink-strong">{r.src.summary}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="text-muted">
                  Hiện: {r.src.current ? personLine(r.src.current) : 'Chưa giao'}
                </span>
                <div className="w-44">
                  <SearchSelect
                    ariaLabel={`Người nhận của ${r.src.key}`}
                    value={shown}
                    placeholder="Chưa có người nhận"
                    onChange={(v) => {
                      const next = { ...state.overrides };
                      if (v === 'auto') delete next[r.src.issueId];
                      else next[r.src.issueId] = v;
                      onState({ ...state, overrides: next });
                    }}
                    options={rowOptions}
                  />
                </div>
                {r.status === 'ok' ? (
                  <Chip tone="ok">Sẽ giao</Chip>
                ) : r.status === 'skip' ? (
                  <Chip tone="muted">Bỏ dòng</Chip>
                ) : r.status === 'same' ? (
                  <Chip tone="muted">Đã là người phụ trách</Chip>
                ) : r.status === 'no-perm' ? (
                  <Chip tone="bad">Không đủ quyền</Chip>
                ) : (
                  <Chip tone="bad">Chưa có người nhận</Chip>
                )}
              </div>
              {r.status === 'no-perm' && r.note ? (
                <p className="mt-0.5 text-[13px] text-muted">{r.note}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------ thành viên ------------------------------ */

function MemberEditor({
  card,
  state,
  computed,
  onState,
}: {
  card: MemberCard;
  state: MemberState;
  computed: MemberComputed;
  onState: (s: MemberState) => void;
}) {
  const adding = card.kind === 'add-member';
  const role = card.defaultRole;
  return (
    <>
      <Choices
        slots={card.slots}
        picks={state.picks}
        onPick={(q, id) => onState({ ...state, picks: { ...state.picks, [q]: id } })}
      />
      {adding ? (
        <div className="mt-3 max-w-xs">
          <p id="bulk-role-label" className="mb-1.5 text-sm font-medium text-ink-strong">
            Vai trò trong dự án
          </p>
          <SearchSelect
            ariaLabel="Vai trò trong dự án"
            value={state.roleId ?? ''}
            placeholder="Chọn vai trò"
            onChange={(roleId) => onState({ ...state, roleId })}
            options={card.roles.map((r) => ({ value: r.id, label: r.name }))}
          />
          <p className="mt-1 text-[13px] text-muted">
            {role.source === 'parsed'
              ? role.approx
                ? `Lấy từ lệnh “${role.query}” — gần đúng, kiểm tra lại.`
                : `Lấy từ lệnh “${role.query}”.`
              : role.source === 'default'
                ? 'Lệnh không nêu vai trò — mặc định Developer (đổi được).'
                : 'Lệnh không nêu vai trò — hãy chọn.'}
          </p>
        </div>
      ) : null}
      <ul
        className="mt-3 max-h-80 overflow-auto rounded-md border border-border"
        aria-label="Các dòng người và dự án"
      >
        {computed.rows.map((r) => {
          const dropped = state.dropped.includes(r.key);
          return (
            <li key={r.key} className="border-b border-border px-2.5 py-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-ink-strong">{personLine(r.person)}</span>
                <span className="font-mono text-xs text-muted">{r.project.key}</span>
                {r.via ? <span className="text-[13px] text-muted">qua team {r.via}</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="text-muted">
                  {r.current} → {r.after}
                </span>
                {r.status === 'ok' ? (
                  <Chip tone="ok">{adding ? 'Sẽ đặt vai trò' : 'Sẽ gỡ'}</Chip>
                ) : r.status === 'already' ? (
                  <Chip tone="muted">Đã có vai trò này</Chip>
                ) : r.status === 'no-perm' ? (
                  <Chip tone="bad">Không đủ quyền</Chip>
                ) : r.status === 'skip' ? (
                  <Chip tone="muted">Bỏ dòng</Chip>
                ) : (
                  <Chip tone="muted">{adding ? 'Chưa chọn vai trò' : 'Không có gì để gỡ'}</Chip>
                )}
                {r.status === 'ok' || dropped ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${dropped ? 'Lấy lại' : 'Bỏ'} dòng ${r.person.name} ${r.project.key}`}
                    onClick={() =>
                      onState({
                        ...state,
                        dropped: dropped
                          ? state.dropped.filter((k) => k !== r.key)
                          : [...state.dropped, r.key],
                      })
                    }
                  >
                    {dropped ? 'Lấy lại' : 'Bỏ dòng'}
                  </Button>
                ) : null}
              </div>
              {r.note ? <p className="mt-0.5 text-[13px] text-muted">{r.note}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------ thẻ ------------------------------ */

export interface BulkCardViewProps {
  block: BulkBlock;
  assign: { state: AssignState; set: (s: AssignState) => void } | null;
  member: { state: MemberState; set: (s: MemberState) => void } | null;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
}

const editable = (s: BulkBlock['status']): boolean => s === 'pending' || s === 'failed';

/**
 * Thẻ XEM TRƯỚC lệnh hàng loạt (thuần hiển thị). Không ghi gì cho tới khi bấm Xác nhận (`onConfirm`); Xác nhận bị khoá khi còn
 * tên mơ hồ, lỗi chặn hay không có dòng nào để ghi. Sau khi chạy: kết quả từng dòng + Hoàn tác (chỉ phần đã đổi thật).
 */
export function BulkCardView({
  block,
  assign,
  member,
  onConfirm,
  onCancel,
  onUndo,
}: BulkCardViewProps) {
  const { card, status } = block;
  const isAssign = card.kind === 'assign';
  const computedA = isAssign && assign ? computeAssign(card, assign.state) : null;
  const computedM = !isAssign && member ? computeMembers(card, member.state) : null;
  const computed = computedA ?? computedM;
  const canConfirm = computed?.canConfirm === true;
  const okCount = computedA?.counts.ok ?? computedM?.counts.ok ?? 0;
  const title = isAssign
    ? `Giao việc hàng loạt · ${card.rows.length} việc`
    : card.kind === 'add-member'
      ? `Thêm thành viên hàng loạt · ${card.projects.length} dự án`
      : `Gỡ vai trò riêng hàng loạt · ${card.projects.length} dự án`;
  const confirmLabel = isAssign
    ? `Giao ${okCount} việc`
    : card.kind === 'add-member'
      ? `Đặt vai trò cho ${okCount} dòng`
      : `Gỡ ${okCount} dòng`;
  const open = editable(status);
  const infoLines = isAssign
    ? [
        ...card.filterNotes.map((n) => `Bộ lọc: ${n}`),
        ...(card.filterJql ? [`JQL: ${card.filterJql}`] : []),
      ]
    : card.info;
  const warnLines = isAssign
    ? [
        ...(card.truncated
          ? ['Còn nhiều việc hơn trang kết quả đầu tiên — mình mới lấy phần đầu.']
          : []),
        ...(card.missingKeys.length
          ? [`Không thấy (sai mã hoặc bạn không có quyền xem): ${card.missingKeys.join(', ')}.`]
          : []),
      ]
    : [];
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface px-3.5 py-3">
      <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
      <Notes lines={infoLines} />
      <Notes lines={warnLines} tone="warn" />
      <Notes lines={card.notes} />
      {open || status === 'running' ? (
        <>
          {isAssign && assign && computedA ? (
            <AssignEditor
              card={card}
              state={assign.state}
              computed={computedA}
              onState={assign.set}
            />
          ) : null}
          {!isAssign && member && computedM ? (
            <MemberEditor
              card={card}
              state={member.state}
              computed={computedM}
              onState={member.set}
            />
          ) : null}
          <Blocking items={computed?.blocking ?? []} />
        </>
      ) : null}
      {status === 'failed' && block.error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          Chưa thực hiện được: {block.error} Có thể bấm Xác nhận lại — dòng đã đổi sẽ tự được bỏ
          qua.
        </p>
      ) : null}
      {status === 'running' ? <p className="mt-3 text-sm text-muted">Đang thực hiện…</p> : null}
      {(status === 'done' || status === 'undoing' || status === 'undone') && block.outcome ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-strong">
            <Check className="h-4 w-4 text-success" aria-hidden />
            {block.outcome.title}
          </p>
          <OutcomeList rows={block.outcome.rows} />
        </div>
      ) : null}
      {status === 'undone' && block.undoOutcome ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink-strong">{block.undoOutcome.title}</p>
          {block.undoOutcome.rows.some((r) => r.status !== 'ok') ? (
            <OutcomeList rows={block.undoOutcome.rows.filter((r) => r.status !== 'ok')} />
          ) : null}
        </div>
      ) : null}
      {status === 'cancelled' ? <p className="mt-3 text-sm text-muted">Đã bỏ lệnh này.</p> : null}
      {status === 'interrupted' ? (
        <p className="mt-3 text-[13px] text-warning-ink">
          Phiên bị ngắt lúc đang thực hiện nên mình không rõ kết quả — hãy kiểm tra lại trên trang
          dự án. Mình không tự chạy lại.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {open ? (
          <>
            <Button size="sm" onClick={onConfirm} disabled={!canConfirm}>
              {confirmLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Bỏ
            </Button>
          </>
        ) : null}
        {(status === 'done' || status === 'undoing') && block.outcome?.undo ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onUndo}
            loading={status === 'undoing'}
            disabled={status === 'undoing'}
          >
            Hoàn tác
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Thẻ trong hội thoại: giữ lựa chọn của người dùng trong state, gọi máy chủ khi Xác nhận / Hoàn tác. */
export function BulkCard({
  messageId,
  block,
  patch,
  executor = apiExecutor,
}: {
  messageId: string;
  block: BulkBlock;
  patch: (a: Extract<ConversationAction, { type: 'patch-bulk' }>) => void;
  executor?: BulkExecutor;
}) {
  const qc = useQueryClient();
  const { card } = block;
  const [assignState, setAssignState] = useState<AssignState | null>(() =>
    card.kind === 'assign' ? initialAssignState(card) : null,
  );
  const [memberState, setMemberState] = useState<MemberState | null>(() =>
    card.kind !== 'assign' ? initialMemberState(card) : null,
  );
  // Ref chặn bấm đúp trước khi React kịp vẽ lại trạng thái "running".
  const inFlight = useRef(false);

  const refresh = () => {
    if (card.kind === 'assign') void qc.invalidateQueries({ queryKey: keys.issues.all });
    else {
      void qc.invalidateQueries({ queryKey: keys.members.projectRoot });
      void qc.invalidateQueries({ queryKey: keys.projects.permissionsAll });
    }
  };
  const announce = (text: string) => {
    // Cửa sổ chat đang mở thì kết quả đã hiện ngay trong thẻ; toast chỉ khi ô chat thu nhỏ/đóng.
    const ui = useAssistantPanel.getState();
    if (!ui.open || ui.minimized) toast.success(text);
  };

  async function onConfirm() {
    const state = card.kind === 'assign' ? assignState : memberState;
    if (inFlight.current || !state || !editable(block.status)) return;
    inFlight.current = true;
    patch({ type: 'patch-bulk', messageId, status: 'running' });
    try {
      const outcome = await runConfirm(card, state, executor);
      patch({ type: 'patch-bulk', messageId, status: 'done', outcome });
      refresh();
      announce(outcome.title);
    } catch (e) {
      patch({ type: 'patch-bulk', messageId, status: 'failed', error: apiErrorMessage(e) });
    } finally {
      inFlight.current = false;
    }
  }

  async function onUndo() {
    const undo = block.outcome?.undo;
    if (inFlight.current || !undo || block.status !== 'done') return;
    inFlight.current = true;
    patch({ type: 'patch-bulk', messageId, status: 'undoing' });
    try {
      const undoOutcome = await runUndo(undo, executor);
      patch({ type: 'patch-bulk', messageId, status: 'undone', undoOutcome });
      refresh();
      announce(undoOutcome.title);
    } catch (e) {
      // Không rõ đã hoàn tác tới đâu: quay về "done" để bấm lại được (máy chủ bỏ qua dòng đã hoàn tác).
      patch({ type: 'patch-bulk', messageId, status: 'done', error: apiErrorMessage(e) });
      toast.error(`Chưa hoàn tác được: ${apiErrorMessage(e)}`);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <BulkCardView
      block={block}
      assign={assignState ? { state: assignState, set: setAssignState } : null}
      member={memberState ? { state: memberState, set: setMemberState } : null}
      onConfirm={() => void onConfirm()}
      onCancel={() => patch({ type: 'patch-bulk', messageId, status: 'cancelled' })}
      onUndo={() => void onUndo()}
    />
  );
}
