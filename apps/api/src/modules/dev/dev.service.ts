import { Injectable, Logger } from '@nestjs/common';
import { Prisma, DevLinkType, DevLinkState, IntegrationType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

/** Regex bắt issue key kiểu "DEMO-1", "PROJ2-123" trong message commit / tiêu đề PR. */
const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** Input tạo repo (đã validate bằng zod ở controller). */
export interface CreateRepositoryInput {
  integrationId: string;
  provider: 'GITHUB' | 'GITLAB';
  externalId: string;
  name: string;
  url: string;
  defaultBranch?: string;
  projectId?: string;
  webhookSecret?: string;
}

/** DTO repo trả về (ẩn webhookSecret). */
export interface RepositoryDto {
  id: string;
  workspaceId: string;
  integrationId: string;
  provider: IntegrationType;
  externalId: string;
  name: string;
  url: string;
  defaultBranch: string | null;
  projectId: string | null;
  hasWebhookSecret: boolean;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** DTO dev-link cho panel issue (kèm tên/url repo). */
export interface DevLinkDto {
  id: string;
  issueId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryUrl: string;
  type: DevLinkType;
  state: DevLinkState | null;
  externalId: string;
  title: string | null;
  url: string;
  branch: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  mergedAt: string | null;
  externalCreatedAt: string | null;
  isSuspect: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Payload webhook (loose; GitHub + GitLab) ----------
interface CommitPayload {
  id?: string;
  sha?: string; // một số provider dùng "sha"
  message?: string;
  title?: string; // GitLab commit dùng "title"
  url?: string;
  author?: { name?: string; username?: string } | null;
}

interface PrUserPayload {
  login?: string;
  username?: string; // GitLab
  name?: string;
  avatar_url?: string;
  avatarUrl?: string;
}

interface PrPayload {
  number?: number;
  iid?: number; // GitLab merge request id
  id?: number;
  title?: string;
  html_url?: string;
  url?: string;
  web_url?: string; // GitLab
  state?: string;
  merged?: boolean;
  merged_at?: string;
  created_at?: string;
  user?: PrUserPayload | null;
  author?: PrUserPayload | null; // GitLab
  head?: { ref?: string; branch?: string } | null;
  source_branch?: string; // GitLab
}

interface WebhookPayload {
  ref?: string;
  commits?: CommitPayload[];
  // GitHub PR
  action?: string;
  pull_request?: PrPayload;
  // GitLab merge request
  object_kind?: string;
  object_attributes?: PrPayload;
}

const devLinkSelect = {
  id: true,
  issueId: true,
  repositoryId: true,
  type: true,
  state: true,
  externalId: true,
  title: true,
  url: true,
  branch: true,
  authorName: true,
  authorAvatarUrl: true,
  mergedAt: true,
  externalCreatedAt: true,
  isSuspect: true,
  createdAt: true,
  updatedAt: true,
  repository: { select: { name: true, url: true } },
} satisfies Prisma.IssueDevLinkSelect;

type DevLinkRow = Prisma.IssueDevLinkGetPayload<{ select: typeof devLinkSelect }>;

@Injectable()
export class DevService {
  private readonly logger = new Logger(DevService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------- Repositories ----------------------------

  async createRepository(workspaceId: string, input: CreateRepositoryInput): Promise<RepositoryDto> {
    // Integration phải thuộc workspace của user.
    const integration = await this.prisma.integration.findFirst({
      where: { id: input.integrationId, workspaceId },
      select: { id: true },
    });
    if (!integration) throw new NotFoundAppException('Tích hợp');

    // Nếu có gắn project, project cũng phải thuộc workspace.
    if (input.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: input.projectId, workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundAppException('Project');
    }

    try {
      const repo = await this.prisma.codeRepository.create({
        data: {
          workspaceId,
          integrationId: input.integrationId,
          provider: input.provider as IntegrationType,
          externalId: input.externalId,
          name: input.name,
          url: input.url,
          defaultBranch: input.defaultBranch ?? null,
          projectId: input.projectId ?? null,
          webhookSecret: input.webhookSecret ?? null,
        },
      });
      return this.toRepoDto(repo);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Repository đã được kết nối với tích hợp này');
      }
      throw e;
    }
  }

  async listRepositories(workspaceId: string, projectId?: string): Promise<RepositoryDto[]> {
    const repos = await this.prisma.codeRepository.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return repos.map((r) => this.toRepoDto(r));
  }

  async removeRepository(workspaceId: string, id: string): Promise<{ success: true }> {
    const repo = await this.prisma.codeRepository.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!repo) throw new NotFoundAppException('Repository');
    await this.prisma.codeRepository.delete({ where: { id } });
    return { success: true };
  }

  // ----------------------------- Dev links ------------------------------

  async listIssueDevLinks(workspaceId: string, issueId: string): Promise<DevLinkDto[]> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');

    const rows = await this.prisma.issueDevLink.findMany({
      where: { issueId },
      select: devLinkSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDevLinkDto(r));
  }

  // ------------------------------ Webhook -------------------------------

  /**
   * Xử lý webhook provider (push commit / pull request).
   * Smart commits: trích issue key từ message commit / tiêu đề PR, gắn IssueDevLink.
   * Phòng thủ tuyệt đối: payload lạ → không 500, trả { linked: 0 }.
   */
  async handleWebhook(
    repositoryId: string,
    secret: string | undefined,
    payload: WebhookPayload,
  ): Promise<{ linked: number; matched: string[] }> {
    const repo = await this.prisma.codeRepository.findUnique({
      where: { id: repositoryId },
      select: { id: true, workspaceId: true, webhookSecret: true, isEnabled: true },
    });
    if (!repo) throw new NotFoundAppException('Repository');

    // Xác thực shared secret nếu repo có cấu hình.
    // TODO: real HMAC X-Hub-Signature-256 verification requires rawBody in main.ts
    if (repo.webhookSecret && repo.webhookSecret !== secret) {
      throw new BusinessRuleException('Chữ ký webhook không hợp lệ');
    }

    if (!repo.isEnabled) return { linked: 0, matched: [] };

    try {
      const matched = new Set<string>();
      let linked = 0;

      const branchFromRef = this.refToBranch(payload.ref);

      // ---- Commits (push) ----
      const commits = Array.isArray(payload.commits) ? payload.commits : [];
      for (const commit of commits) {
        const sha = commit.id ?? commit.sha;
        const message = commit.message ?? commit.title ?? '';
        if (!sha) continue;
        const keys = this.extractKeys(message);
        if (!keys.length) continue;
        const firstLine = message.split('\n')[0]?.trim() || message.trim() || sha;
        for (const key of keys) {
          matched.add(key);
          const issue = await this.findIssue(repo.workspaceId, key);
          if (!issue) continue;
          const created = await this.upsertDevLink(issue.id, repo.id, {
            type: DevLinkType.COMMIT,
            externalId: sha,
            title: firstLine.slice(0, 500),
            url: commit.url ?? '',
            branch: branchFromRef,
            authorName: commit.author?.name ?? commit.author?.username ?? null,
            metadata: { provider: 'push' },
          });
          if (created) linked += 1;
        }
      }

      // ---- Pull request / Merge request ----
      const pr = payload.pull_request ?? payload.object_attributes;
      if (pr) {
        const number = pr.number ?? pr.iid ?? pr.id;
        const title = pr.title ?? '';
        const keys = this.extractKeys(title);
        if (number != null && keys.length) {
          const merged = pr.merged === true || (pr.state ?? '').toLowerCase() === 'merged';
          const state = this.mapPrState(pr.state, merged);
          const user = pr.user ?? pr.author ?? null;
          const url = pr.html_url ?? pr.url ?? pr.web_url ?? '';
          const branch = pr.head?.ref ?? pr.head?.branch ?? pr.source_branch ?? null;
          const mergedAt = this.toDate(pr.merged_at) ?? (merged ? new Date() : null);
          const externalCreatedAt = this.toDate(pr.created_at);
          for (const key of keys) {
            matched.add(key);
            const issue = await this.findIssue(repo.workspaceId, key);
            if (!issue) continue;
            const created = await this.upsertDevLink(issue.id, repo.id, {
              type: DevLinkType.PULL_REQUEST,
              externalId: String(number),
              title: title.slice(0, 500) || null,
              url,
              branch,
              authorName: user?.login ?? user?.username ?? user?.name ?? null,
              authorAvatarUrl: user?.avatar_url ?? user?.avatarUrl ?? null,
              state,
              mergedAt,
              externalCreatedAt,
              metadata: { action: payload.action ?? null, providerState: pr.state ?? null },
            });
            if (created) linked += 1;
          }
        }
      }

      return { linked, matched: [...matched] };
    } catch (e) {
      // Không bao giờ 500 trên payload lạ.
      this.logger.warn(`Webhook repo=${repositoryId} parse error: ${(e as Error).message}`);
      return { linked: 0, matched: [] };
    }
  }

  // ------------------------------ helpers -------------------------------

  private extractKeys(text: string): string[] {
    if (!text) return [];
    const found = text.match(ISSUE_KEY_RE);
    return found ? [...new Set(found)] : [];
  }

  private async findIssue(workspaceId: string, key: string): Promise<{ id: string } | null> {
    return this.prisma.issue.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * Dedupe theo (issueId, repositoryId, externalId): tìm trước, chỉ tạo nếu chưa có.
   * (Không có unique constraint trên bộ ba này nên dùng findFirst + create.)
   * Trả về true nếu vừa tạo mới.
   */
  private async upsertDevLink(
    issueId: string,
    repositoryId: string,
    data: {
      type: DevLinkType;
      externalId: string;
      title?: string | null;
      url: string;
      branch?: string | null;
      authorName?: string | null;
      authorAvatarUrl?: string | null;
      state?: DevLinkState | null;
      mergedAt?: Date | null;
      externalCreatedAt?: Date | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const existing = await this.prisma.issueDevLink.findFirst({
      where: { issueId, repositoryId, externalId: data.externalId },
      select: { id: true },
    });

    const metadata =
      data.metadata !== undefined
        ? (data.metadata as unknown as Prisma.InputJsonValue)
        : undefined;

    if (existing) {
      // Cập nhật trạng thái/title nếu PR đổi (merged, đổi tên...). Không tính là "linked" mới.
      await this.prisma.issueDevLink.update({
        where: { id: existing.id },
        data: {
          title: data.title ?? undefined,
          url: data.url || undefined,
          branch: data.branch ?? undefined,
          authorName: data.authorName ?? undefined,
          authorAvatarUrl: data.authorAvatarUrl ?? undefined,
          state: data.state ?? undefined,
          mergedAt: data.mergedAt ?? undefined,
          ...(metadata !== undefined ? { metadata } : {}),
        },
      });
      return false;
    }

    await this.prisma.issueDevLink.create({
      data: {
        issueId,
        repositoryId,
        type: data.type,
        externalId: data.externalId,
        title: data.title ?? null,
        url: data.url,
        branch: data.branch ?? null,
        authorName: data.authorName ?? null,
        authorAvatarUrl: data.authorAvatarUrl ?? null,
        state: data.state ?? null,
        mergedAt: data.mergedAt ?? null,
        externalCreatedAt: data.externalCreatedAt ?? null,
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });
    return true;
  }

  /** Map state provider (open/closed/merged/draft) → DevLinkState; null nếu không khớp. */
  private mapPrState(state: string | undefined, merged: boolean): DevLinkState | null {
    if (merged) return DevLinkState.MERGED;
    switch ((state ?? '').toLowerCase()) {
      case 'open':
      case 'opened':
      case 'reopened':
        return DevLinkState.OPEN;
      case 'draft':
        return DevLinkState.DRAFT;
      case 'closed':
        return DevLinkState.CLOSED;
      case 'merged':
        return DevLinkState.MERGED;
      default:
        return null;
    }
  }

  private refToBranch(ref: string | undefined): string | null {
    if (!ref) return null;
    return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '') || null;
  }

  private toDate(value: string | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private toRepoDto(r: Prisma.CodeRepositoryGetPayload<object>): RepositoryDto {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      integrationId: r.integrationId,
      provider: r.provider,
      externalId: r.externalId,
      name: r.name,
      url: r.url,
      defaultBranch: r.defaultBranch,
      projectId: r.projectId,
      hasWebhookSecret: r.webhookSecret != null,
      isEnabled: r.isEnabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toDevLinkDto(r: DevLinkRow): DevLinkDto {
    return {
      id: r.id,
      issueId: r.issueId,
      repositoryId: r.repositoryId,
      repositoryName: r.repository.name,
      repositoryUrl: r.repository.url,
      type: r.type,
      state: r.state,
      externalId: r.externalId,
      title: r.title,
      url: r.url,
      branch: r.branch,
      authorName: r.authorName,
      authorAvatarUrl: r.authorAvatarUrl,
      mergedAt: r.mergedAt?.toISOString() ?? null,
      externalCreatedAt: r.externalCreatedAt?.toISOString() ?? null,
      isSuspect: r.isSuspect,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
