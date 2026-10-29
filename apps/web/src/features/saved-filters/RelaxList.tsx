import { fmtNumber } from '@/lib/locale';
import type { RelaxPlan } from './relaxPlan';

const ROW_CLS =
  'flex w-full items-baseline gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm text-ink transition-colors ' +
  'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ' +
  '[@media(pointer:coarse)]:min-h-11';

/**
 * Danh sách "Bỏ <điều kiện> → N việc" cho trạng thái trống của bộ lọc (092). Chỉ trình bày: điều kiện là chữ thuần
 * (React text node, không HTML); tên truy cập của nút là "Bỏ <điều kiện> → N việc" (có cả điều kiện lẫn số).
 */
export function RelaxList({
  plan,
  loaded,
  onApply,
}: {
  plan: RelaxPlan;
  /** Đã có phản hồi của máy chủ (chưa có = đang đếm). */
  loaded: boolean;
  onApply: (jqlWithout: string) => void;
}) {
  if (!loaded) {
    return <p className="text-xs text-muted">Đang thử bỏ từng điều kiện…</p>;
  }
  const noneWorked = plan.rows.length === 0 && plan.timedOut === 0 && plan.counted > 0;
  return (
    <div className="flex w-full max-w-md flex-col gap-2 text-left">
      {plan.rows.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted">Thử bỏ một điều kiện</p>
          <ul className="flex flex-col gap-1.5">
            {plan.rows.map((row, i) => (
              <li key={`${i}:${row.jqlWithout}`}>
                <button type="button" onClick={() => onApply(row.jqlWithout)} className={ROW_CLS}>
                  <span className="min-w-0 flex-1 break-words">
                    Bỏ <span className="font-mono text-[13px] text-ink-strong">{row.text}</span>
                  </span>{' '}
                  <span className="shrink-0 tabular-nums text-muted">
                    → {fmtNumber(row.count)} việc
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {noneWorked && (
        <p className="text-xs text-muted">
          Bỏ riêng từng điều kiện vẫn không có việc nào — thử nới nhiều điều kiện cùng lúc.
        </p>
      )}
      {plan.timedOut > 0 && (
        <p className="text-xs text-muted">{plan.timedOut} điều kiện không đếm kịp.</p>
      )}
      {plan.remaining > 0 && (
        <p className="text-xs text-muted">Còn {plan.remaining} điều kiện khác chưa thử.</p>
      )}
    </div>
  );
}
