import { LEADERSHIP_EMPTY } from '@/features/dashboard/leadershipText';
import { RiskRow } from '@/features/dashboard/LeadershipCards';
import { LeadershipWidgetFrame } from './LeadershipWidgetFrame';
import type { WidgetProps } from './types';

/** 5 rủi ro mở điểm cao nhất (đã lọc theo dự án người xem thấy). */
export function TopRisksWidget({ title }: WidgetProps) {
  return (
    <LeadershipWidgetFrame
      title={title}
      card="topRisks"
      to={{ href: '/manage/risks', label: 'Xem tất cả →' }}
      empty={LEADERSHIP_EMPTY.risks}
      render={(d) =>
        d.topRisks.map((r) => (
          <li key={r.id}>
            <RiskRow risk={r} />
          </li>
        ))
      }
    />
  );
}
