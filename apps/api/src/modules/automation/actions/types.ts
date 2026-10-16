import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AutomationEventMeta, IssueDto, RuleTrigger } from '@tirapro/types';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { CommentsService } from '../../comments/comments.service';
import type { IssuesService } from '../../issues/issues.service';
import type { NotificationsService } from '../../notifications/notifications.service';

/** Phụ thuộc mà các action dùng — engine truyền xuống để action là hàm thuần dễ test. */
export interface ActionDeps {
  prisma: PrismaService;
  issues: IssuesService;
  comments: CommentsService;
  /** Chốt tạo thông báo trung tâm (lọc người nhận xem được việc, cài đặt, gộp 60s, realtime, email). */
  notifications: NotificationsService;
  events: EventEmitter2;
  /** Giải mã khoá bí mật webhook đã lưu; null = không giải mã được. */
  openSecret(stored: string): string | null;
}

/** Ngữ cảnh một lần chạy quy tắc trên MỘT issue. */
export interface ActionContext {
  deps: ActionDeps;
  workspaceId: string;
  /** Người dùng hệ thống (automation@tirapro.local) — tác giả mọi thay đổi do quy tắc gây ra. */
  actorId: string;
  rule: { id: string; name: string };
  trigger: RuleTrigger;
  /** Người gây ra sự kiện gốc (null khi chạy theo lịch). */
  triggerActorId: string | null;
  /** Chạy thử: action chỉ mô tả việc SẼ làm, tuyệt đối không ghi/gửi gì. */
  dryRun: boolean;
  /** Metadata truyền vào IssuesService/CommentsService để sự kiện phát ra mang độ sâu + chuỗi quy tắc. */
  meta: AutomationEventMeta;
  /** Issue ở trạng thái mới nhất mà quy tắc biết (cập nhật sau mỗi action ghi). */
  issue: IssueDto;
  /** Đọc lại issue từ DB (lấy version mới nhất trước khi ghi theo OCC). */
  reload(): Promise<IssueDto>;
  /** Tên người gây ra sự kiện, dùng cho `{{actor.displayName}}`. */
  actorName(): Promise<string>;
}

/** Action ném lỗi (BusinessRule/NotFound/…) khi không thực hiện được; trả chuỗi mô tả khi xong. */
export type ActionResult = string;
