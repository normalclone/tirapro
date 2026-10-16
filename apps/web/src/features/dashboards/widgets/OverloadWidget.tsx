import { LEADERSHIP_EMPTY } from '@/features/dashboard/leadershipText';
import { OverloadRow } from '@/features/dashboard/LeadershipCards';
import { LeadershipWidgetFrame } from './LeadershipWidgetFrame';
import type { WidgetProps } from './types';

/** Người được giao nhiều giờ hơn năng lực trong 2 tuần tới. */
export function OverloadWidget({ title }: WidgetProps) {
  return (
    <LeadershipWidgetFrame
      title={title}
      card="overloaded"
      to={{ href: '/manage/resources', label: 'Xem tất cả →' }}
      empty={LEADERSHIP_EMPTY.overloaded}
      render={(d) =>
        d.overloaded.map((o) => (
          <li key={o.user.id}>
            <OverloadRow item={o} />
          </li>
        ))
      }
    />
  );
}
