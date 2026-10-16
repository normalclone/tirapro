import { Injectable } from '@nestjs/common';
import { GuideProgressState } from '@prisma/client';
import { DEFAULT_GUIDES, type ChecklistContent } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Khoá của guide checklist "Bắt đầu" (Guide toàn cục nạp bởi GuidesBootstrapService; workspace có thể ghi đè bản riêng). */
export const ONBOARDING_GUIDE_KEY = 'onboarding-start';

/** Bốn mục có logic tính tiến độ; khoá lạ trong bản ghi Guide bị bỏ qua. */
export type OnboardingItemKey =
  | 'create_project'
  | 'add_members'
  | 'start_sprint'
  | 'connect_telegram';

export interface OnboardingItemDto {
  key: OnboardingItemKey;
  label: string;
  done: boolean;
  href: string | null;
}

export interface OnboardingDto {
  items: OnboardingItemDto[];
  doneCount: number;
  total: number;
  /** Người dùng đã bấm "Ẩn khối này". */
  dismissed: boolean;
  /** Hiện khối: chưa ẩn, chưa xong cả bốn, và workspace dưới 30 ngày tuổi. */
  visible: boolean;
}

/** Workspace cũ hơn mốc này không bị nhắc "Bắt đầu" nữa. */
const VISIBLE_DAYS = 30;

const KNOWN_KEYS: readonly OnboardingItemKey[] = [
  'create_project',
  'add_members',
  'start_sprint',
  'connect_telegram',
];

/** Nội dung mặc định trong mã — dùng khi bản ghi Guide chưa được nạp (API vừa khởi động lỗi nạp). */
const FALLBACK_ITEMS: ChecklistContent['items'] = (() => {
  const g = DEFAULT_GUIDES.find((x) => x.key === ONBOARDING_GUIDE_KEY);
  return (g?.content as ChecklistContent | undefined)?.items ?? [];
})();

/**
 * Checklist "Bắt đầu" cho quản trị workspace mới. Tiến độ TÍNH TỪ DỮ LIỆU THẬT (luôn đúng kể cả khi người khác làm hộ);
 * chỉ việc ẩn lưu theo người (`UserGuideState`). Chỉ đọc + trạng thái người dùng.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, workspaceId: string): Promise<OnboardingDto> {
    const [guide, project, members, sprint, telegram, state, ws] = await Promise.all([
      this.prisma.guide.findFirst({
        where: {
          key: ONBOARDING_GUIDE_KEY,
          isPublished: true,
          OR: [{ workspaceId }, { workspaceId: null }],
        },
        // Bản của workspace trước: Postgres đặt NULL TRƯỚC khi DESC nên phải ép `nulls: 'last'` (bản toàn cục xuống cuối).
        orderBy: { workspaceId: { sort: 'desc', nulls: 'last' } },
        select: { key: true, content: true },
      }),
      this.prisma.project.count({ where: { workspaceId, deletedAt: null } }),
      // Không tính tài khoản đã vô hiệu hoá (chỉ người còn dùng được mới là "đã thêm thành viên").
      this.prisma.workspaceMembership.count({
        where: { workspaceId, user: { status: { not: 'DEACTIVATED' } } },
      }),
      this.prisma.sprint.count({
        where: {
          project: { workspaceId, deletedAt: null },
          deletedAt: null,
          state: { in: ['ACTIVE', 'CLOSED'] },
        },
      }),
      // Chỉ tính khi CÓ kênh bật — tích hợp "Hoạt động" mà chưa có kênh thì chưa gửi được gì.
      this.prisma.integration.count({
        where: {
          workspaceId,
          type: 'TELEGRAM',
          status: 'ACTIVE',
          channels: { some: { isEnabled: true } },
        },
      }),
      this.prisma.userGuideState.findUnique({
        where: { userId_guideKey: { userId, guideKey: ONBOARDING_GUIDE_KEY } },
        select: { state: true },
      }),
      this.prisma.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: { createdAt: true },
      }),
    ]);

    const done: Record<OnboardingItemKey, boolean> = {
      create_project: project > 0,
      add_members: members > 1,
      start_sprint: sprint > 0,
      connect_telegram: telegram > 0,
    };
    const defs =
      (guide?.content as unknown as ChecklistContent | undefined)?.items ?? FALLBACK_ITEMS;
    const items: OnboardingItemDto[] = defs
      .filter((d): d is typeof d & { key: OnboardingItemKey } =>
        (KNOWN_KEYS as readonly string[]).includes(d.key),
      )
      .map((d) => ({ key: d.key, label: d.label, done: done[d.key], href: d.href ?? null }));

    const doneCount = items.filter((i) => i.done).length;
    const dismissed = state?.state === GuideProgressState.DISMISSED;
    const fresh = !!ws && Date.now() - ws.createdAt.getTime() < VISIBLE_DAYS * 86_400_000;
    return {
      items,
      doneCount,
      total: items.length,
      dismissed,
      visible: !dismissed && doneCount < items.length && fresh,
    };
  }

  /** Ẩn khối của chính người dùng (không ảnh hưởng người khác). */
  async dismiss(userId: string): Promise<{ ok: true }> {
    await this.prisma.userGuideState.upsert({
      where: { userId_guideKey: { userId, guideKey: ONBOARDING_GUIDE_KEY } },
      create: { userId, guideKey: ONBOARDING_GUIDE_KEY, state: GuideProgressState.DISMISSED },
      update: { state: GuideProgressState.DISMISSED },
    });
    return { ok: true };
  }
}
