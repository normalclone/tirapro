import { LEADERSHIP_EMPTY } from '@/features/dashboard/leadershipText';
import { GoalRow } from '@/features/dashboard/LeadershipCards';
import { LeadershipWidgetFrame } from './LeadershipWidgetFrame';
import type { WidgetProps } from './types';

/** OKR đang chạy chậm hơn thời gian đã trôi. */
export function SlowGoalsWidget({ title }: WidgetProps) {
  return (
    <LeadershipWidgetFrame
      title={title}
      card="slowGoals"
      to={{ href: '/manage/goals', label: 'Xem tất cả →' }}
      empty={LEADERSHIP_EMPTY.goals}
      render={(d) =>
        d.slowGoals.map((g) => (
          <li key={g.id}>
            <GoalRow goal={g} />
          </li>
        ))
      }
    />
  );
}
