import { Injectable } from '@nestjs/common';
import { GuideProgressState, GuideType, Prisma } from '@prisma/client';
import type { GuideContent } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/types/request';

/** Item trả về từ GET /guides — guide đã merge với tiến độ của user hiện tại. */
export interface GuideListItemDto {
  id: string;
  key: string;
  type: GuideType;
  screen: string;
  title: string;
  description: string | null;
  content: GuideContent;
  order: number;
  /** Đã từng xem/hoàn thành (có UserGuideState). */
  seen: boolean;
  /** Trạng thái tiến độ; null nếu chưa từng tương tác. */
  state: GuideProgressState | null;
}

/** Tiến độ guide của user — trả về từ GET /guides/state. */
export interface GuideStateDto {
  guideKey: string;
  state: GuideProgressState;
  completedAt: string | null;
}

@Injectable()
export class GuidesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guide đã publish cho một màn (hoặc toàn bộ workspace nếu bỏ `screen`).
   * Hiển thị guide của workspace hiện tại hoặc guide toàn cục (workspaceId = null).
   */
  async listForScreen(user: AuthUser, screen?: string): Promise<GuideListItemDto[]> {
    const where: Prisma.GuideWhereInput = {
      isPublished: true,
      OR: [{ workspaceId: user.workspaceId }, { workspaceId: null }],
      ...(screen ? { screen } : {}),
    };

    const guides = await this.prisma.guide.findMany({
      where,
      orderBy: { order: 'asc' },
    });

    if (guides.length === 0) return [];

    // TODO audience filter by role — AuthUser hiện chưa mang role keys; coi audience
    // không rỗng là hiển thị cho mọi người cho tới khi có roles. Hiện không lọc.
    const visible = guides;

    const states = await this.prisma.userGuideState.findMany({
      where: { userId: user.id, guideKey: { in: visible.map((g) => g.key) } },
      select: { guideKey: true, state: true },
    });
    const stateByKey = new Map(states.map((s) => [s.guideKey, s.state]));

    return visible.map((g) => {
      const state = stateByKey.get(g.key) ?? null;
      return {
        id: g.id,
        key: g.key,
        type: g.type,
        screen: g.screen,
        title: g.title,
        description: g.description,
        content: g.content as unknown as GuideContent,
        order: g.order,
        seen: state !== null,
        state,
      };
    });
  }

  /** Tiến độ guide của user hiện tại. */
  async listState(user: AuthUser): Promise<GuideStateDto[]> {
    const rows = await this.prisma.userGuideState.findMany({
      where: { userId: user.id },
      select: { guideKey: true, state: true, completedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({
      guideKey: r.guideKey,
      state: r.state,
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Đánh dấu đã xem. Không hạ cấp COMPLETED → SEEN: nếu đã COMPLETED thì giữ nguyên.
   */
  async markSeen(user: AuthUser, guideKey: string): Promise<{ ok: true }> {
    const existing = await this.prisma.userGuideState.findUnique({
      where: { userId_guideKey: { userId: user.id, guideKey } },
      select: { state: true },
    });

    if (existing?.state === GuideProgressState.COMPLETED) {
      return { ok: true };
    }

    await this.prisma.userGuideState.upsert({
      where: { userId_guideKey: { userId: user.id, guideKey } },
      create: { userId: user.id, guideKey, state: GuideProgressState.SEEN },
      update: { state: GuideProgressState.SEEN },
    });
    return { ok: true };
  }

  /** Đánh dấu hoàn thành guide. */
  async markComplete(user: AuthUser, guideKey: string): Promise<{ ok: true }> {
    const now = new Date();
    await this.prisma.userGuideState.upsert({
      where: { userId_guideKey: { userId: user.id, guideKey } },
      create: { userId: user.id, guideKey, state: GuideProgressState.COMPLETED, completedAt: now },
      update: { state: GuideProgressState.COMPLETED, completedAt: now },
    });
    return { ok: true };
  }

  /** Danh sách toàn bộ guide của workspace (quản trị). */
  async listAdmin(user: AuthUser): Promise<GuideListItemDto[]> {
    const guides = await this.prisma.guide.findMany({
      where: { OR: [{ workspaceId: user.workspaceId }, { workspaceId: null }] },
      orderBy: [{ screen: 'asc' }, { order: 'asc' }],
    });
    return guides.map((g) => ({
      id: g.id,
      key: g.key,
      type: g.type,
      screen: g.screen,
      title: g.title,
      description: g.description,
      content: g.content as unknown as GuideContent,
      order: g.order,
      seen: false,
      state: null,
    }));
  }
}
