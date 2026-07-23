/**
 * Hình dạng content cho Guide (config-driven onboarding). Dùng chung BE (validate/seed)
 * và FE (driver.js tour + help panel). Lưu vào Guide.content (JSON).
 */
import type { GuideType } from '@tirapro/types';

/** Một bước tour driver.js. selector trỏ tới phần tử cần highlight (data-tour attr). */
export interface TourStepDef {
  /** CSS selector, ưu tiên dạng [data-tour="..."]. Bỏ trống = popover giữa màn. */
  selector?: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'over' | 'auto';
  order: number;
  /** Nếu bước cần điều hướng tới route khác trước khi hiện. */
  route?: string;
}

export interface TourContent {
  steps: TourStepDef[];
}

/** Một mục trong panel "Hướng dẫn sử dụng" của màn (body là markdown). */
export interface HelpSection {
  heading: string;
  body: string;
}

export interface HelpContent {
  sections: HelpSection[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  /** Hành động hoàn thành (vd 'create_project'); FE đánh dấu khi event xảy ra. */
  completeOn?: string;
  href?: string;
}

export interface ChecklistContent {
  items: ChecklistItem[];
}

export type GuideContent = TourContent | HelpContent | ChecklistContent;

export interface GuideDto {
  id: string;
  type: GuideType;
  key: string;
  screen: string;
  title: string;
  description: string | null;
  content: GuideContent;
  audience: string[];
  version: number;
  order: number;
}
