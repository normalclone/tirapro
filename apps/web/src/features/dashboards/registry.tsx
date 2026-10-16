import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  Flame,
  Hash,
  ListChecks,
  PieChart,
  Target,
  TrendingDown,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardWidgetType } from '@tirapro/shared';
import { BurndownWidget } from './widgets/BurndownWidget';
import { CreatedResolvedWidget } from './widgets/CreatedResolvedWidget';
import { IssueListWidget } from './widgets/IssueListWidget';
import { OverloadWidget } from './widgets/OverloadWidget';
import { PieByFieldWidget } from './widgets/PieByFieldWidget';
import { SlowGoalsWidget } from './widgets/SlowGoalsWidget';
import { StatNumberWidget } from './widgets/StatNumberWidget';
import { TopRisksWidget } from './widgets/TopRisksWidget';
import type { WidgetProps } from './widgets/types';
import { VelocityWidget } from './widgets/VelocityWidget';
import type { WidgetWidth } from './widgetLayout';

type ProjectNeed = 'none' | 'optional' | 'required';

export interface WidgetDef {
  label: string;
  description: string;
  icon: LucideIcon;
  defaultTitle: string;
  /**
   * Cấu hình ban đầu. Loại BẮT BUỘC dự án để `projectId: ''` — buộc người dùng chọn (máy chủ từ chối chuỗi rỗng),
   * ô hiện lời nhắc "Chọn dự án" thay vì lấy bừa một dự án.
   */
  defaultConfig: Record<string, unknown>;
  defaultW: WidgetWidth;
  /** Cấu hình có cần/cho phép chọn dự án không (hộp cấu hình dựa vào đây). */
  project: ProjectNeed;
  Component: ComponentType<WidgetProps>;
}

/** Danh mục 9 loại ô đã hỗ trợ (khớp `DASHBOARD_WIDGET_TYPES` của shared; test kiểm mỗi loại qua được schema). */
export const WIDGET_REGISTRY: Record<DashboardWidgetType, WidgetDef> = {
  STAT_NUMBER: {
    label: 'Chỉ số',
    description: 'Một con số lớn: việc đang mở, quá hạn, bug, xong 14 ngày qua hoặc số dự án.',
    icon: Hash,
    defaultTitle: 'Việc đang mở',
    defaultConfig: { metric: 'open' },
    defaultW: 1,
    project: 'optional',
    Component: StatNumberWidget,
  },
  PIE_BY_FIELD: {
    label: 'Phân bố',
    description: 'Biểu đồ tròn công việc theo trạng thái, loại hoặc mức ưu tiên.',
    icon: PieChart,
    defaultTitle: 'Phân bố theo trạng thái',
    defaultConfig: { field: 'status' },
    defaultW: 1,
    project: 'optional',
    Component: PieByFieldWidget,
  },
  ISSUE_LIST: {
    label: 'Danh sách việc (JQL)',
    description: 'Các công việc khớp một câu lọc JQL, mới nhất trước.',
    icon: ListChecks,
    defaultTitle: 'Việc của tôi chưa xong',
    defaultConfig: {
      jql: 'assignee = currentUser() AND statusCategory != DONE ORDER BY updated DESC',
      limit: 10,
    },
    defaultW: 2,
    project: 'none',
    Component: IssueListWidget,
  },
  BURNDOWN: {
    label: 'Burndown',
    description: 'Điểm còn lại theo ngày của sprint đang chạy so với đường lý tưởng.',
    icon: TrendingDown,
    defaultTitle: 'Burndown sprint',
    defaultConfig: { projectId: '' },
    defaultW: 2,
    project: 'required',
    Component: BurndownWidget,
  },
  VELOCITY: {
    label: 'Velocity',
    description: 'Cam kết và hoàn thành của các sprint đã kết thúc.',
    icon: BarChart3,
    defaultTitle: 'Velocity',
    defaultConfig: { projectId: '' },
    defaultW: 2,
    project: 'required',
    Component: VelocityWidget,
  },
  CREATED_VS_RESOLVED: {
    label: 'Tạo mới vs Đã xử lý',
    description: 'Đường xu hướng việc được tạo và việc được xử lý theo thời gian.',
    icon: Activity,
    defaultTitle: 'Tạo mới vs Đã xử lý',
    defaultConfig: {},
    defaultW: 2,
    project: 'optional',
    Component: CreatedResolvedWidget,
  },
  TOP_RISKS: {
    label: 'Top rủi ro',
    description: '5 rủi ro mở có điểm cao nhất.',
    icon: Flame,
    defaultTitle: 'Top rủi ro',
    defaultConfig: {},
    defaultW: 1,
    project: 'none',
    Component: TopRisksWidget,
  },
  SLOW_GOALS: {
    label: 'OKR chậm',
    description: 'Mục tiêu đang chạy chậm hơn thời gian đã trôi.',
    icon: Target,
    defaultTitle: 'OKR chậm',
    defaultConfig: {},
    defaultW: 1,
    project: 'none',
    Component: SlowGoalsWidget,
  },
  OVERLOAD: {
    label: 'Người quá tải',
    description: 'Người được giao nhiều giờ hơn năng lực trong 2 tuần tới.',
    icon: Users,
    defaultTitle: 'Người quá tải',
    defaultConfig: {},
    defaultW: 1,
    project: 'none',
    Component: OverloadWidget,
  },
};

export const WIDGET_TYPE_ORDER = Object.keys(WIDGET_REGISTRY) as DashboardWidgetType[];

/** Loại ô trong DTO là `string` (máy chủ có thể có loại mới hơn FE) — tra danh mục an toàn. */
export function widgetDefOf(type: string): WidgetDef | undefined {
  return (WIDGET_REGISTRY as Record<string, WidgetDef | undefined>)[type];
}
