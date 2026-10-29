import { Fragment } from 'react';
import type { RuleCondition } from '@tirapro/shared';
import {
  CONDITION_JOINER,
  NO_CONDITIONS_TEXT,
  OR_HINT,
  conditionClauses,
  type NameOf,
} from './describeConditions';

/**
 * Điều kiện của quy tắc đọc thành MỘT câu ("Loại công việc là Bug **và** Mức ưu tiên là High") — chữ để đọc, không sửa
 * ở đây. Từ nối luôn là "và" in đậm (engine chỉ VÀ), kèm gợi ý dùng điều kiện JQL khi cần HOẶC.
 */
export function ConditionSentence({
  conditions,
  nameOf,
}: {
  conditions: readonly RuleCondition[];
  nameOf: NameOf;
}) {
  const clauses = conditionClauses(conditions, nameOf);
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="break-words text-sm text-ink [overflow-wrap:anywhere]">
        {clauses.length === 0 ? (
          <span className="text-muted">{NO_CONDITIONS_TEXT}</span>
        ) : (
          <Fragment>
            <span className="text-muted">Chỉ chạy khi </span>
            {clauses.map((text, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <Fragment>
                    {' '}
                    <strong className="font-semibold text-ink-strong">
                      {CONDITION_JOINER}
                    </strong>{' '}
                  </Fragment>
                )}
                <span>{text}</span>
              </Fragment>
            ))}
            <span className="text-muted">.</span>
          </Fragment>
        )}
      </p>
      <p className="mt-1 text-xs text-faint">{OR_HINT}</p>
    </div>
  );
}
