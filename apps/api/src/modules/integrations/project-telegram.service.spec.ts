import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { IntegrationsService } from './integrations.service';
import { LinkCodesService } from './link-codes.service';
import { updateProjectChannelSchema } from './project-telegram.controller';
import { ProjectTelegramService } from './project-telegram.service';
import { TelegramPersonalService } from './telegram-personal.service';

describe('ProjectTelegramService — Nest DI', () => {
  it('dựng được qua Nest DI', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ProjectTelegramService,
        ...[
          PrismaService,
          RbacService,
          ProjectAccessService,
          AuditService,
          IntegrationsService,
          LinkCodesService,
          TelegramPersonalService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    expect(mod.get(ProjectTelegramService)).toBeInstanceOf(ProjectTelegramService);
  });
});

const P = (id: string) => ({ id, key: id.toUpperCase(), name: `Dự án ${id}` });

function setup(
  opts: {
    projects?: unknown[];
    orgAdmin?: boolean;
    perms?: Record<string, string[]>;
    bot?: boolean;
    channel?: unknown;
    token?: unknown;
  } = {},
) {
  const prisma = {
    project: { findMany: vi.fn(() => Promise.resolve(opts.projects ?? [P('a'), P('b'), P('c')])) },
    integrationChannel: {
      findMany: vi.fn(() =>
        Promise.resolve([{ id: 'c1', title: 'Nhóm dev', events: [], isEnabled: true }]),
      ),
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.channel === undefined
            ? { id: 'c1', title: 'Nhóm dev', externalId: '-100', integrationId: 'g1' }
            : opts.channel,
        ),
      ),
      update: vi.fn((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'c1', title: 'Nhóm dev', events: [], isEnabled: true, ...a.data }),
      ),
    },
    channelLinkToken: {
      findFirst: vi.fn(() =>
        Promise.resolve(opts.token === undefined ? { integrationId: 'g1' } : opts.token),
      ),
    },
  };
  const rbac = {
    holdsOrganizationAdmin: vi.fn(() => Promise.resolve(opts.orgAdmin ?? false)),
    getEffectivePermissions: vi.fn((_u: string, _o: string, projectId: string) =>
      Promise.resolve(new Set(opts.perms?.[projectId] ?? ['project:view'])),
    ),
  };
  const access = { visibleWhere: vi.fn(() => Promise.resolve({ isPrivate: false })) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const integrations = { removeChannel: vi.fn(() => Promise.resolve({ success: true })) };
  const linkCodes = {
    createCode: vi.fn(() => Promise.resolve({ code: 'K7M2QX' })),
    poll: vi.fn(() => Promise.resolve({ status: 'waiting' })),
  };
  const personal = {
    resolveBot: vi.fn(() =>
      Promise.resolve(
        opts.bot === false
          ? { reason: 'NO_BOT' }
          : { bot: { integration: { id: 'g1' }, token: 'T', botUsername: 'TiraBot' } },
      ),
    ),
  };
  const service = new ProjectTelegramService(
    prisma as never,
    rbac as never,
    access as never,
    audit as never,
    integrations as never,
    linkCodes as never,
    personal as never,
  );
  return { service, prisma, rbac, access, audit, integrations, linkCodes, personal };
}

describe('managedProjects', () => {
  it('chỉ các dự án có project:admin (theo quyền hiệu lực của TỪNG dự án)', async () => {
    const { service, rbac } = setup({ perms: { a: ['project:admin'], c: ['project:admin'] } });
    expect((await service.managedProjects('u1', 'w1')).map((p) => p.id)).toEqual(['a', 'c']);
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'b');
  });

  it('không quản trị dự án nào → rỗng (FE ẩn mục)', async () => {
    expect(await setup().service.managedProjects('u1', 'w1')).toEqual([]);
  });

  it('quản trị tổ chức → mọi dự án, không tính quyền từng dự án', async () => {
    const { service, rbac } = setup({ orgAdmin: true });
    expect(await service.managedProjects('u1', 'w1')).toHaveLength(3);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('chỉ xét dự án người này THẤY, chưa xoá / chưa lưu trữ', async () => {
    const { service, prisma, access } = setup();
    await service.managedProjects('u1', 'w1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'w1', deletedAt: null, archivedAt: null, isPrivate: false },
      }),
    );
  });
});

describe('overview', () => {
  it('kênh của CHÍNH dự án (lọc theo organizationId + projectId, chỉ Telegram); báo bot sẵn sàng', async () => {
    const { service, prisma } = setup();
    const r = await service.overview('w1', 'p1');
    expect(prisma.integrationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'w1', projectId: 'p1', integration: { type: 'TELEGRAM' } },
      }),
    );
    expect(r).toMatchObject({ botReady: true, botUsername: 'TiraBot', reason: null });
    expect(r.eventTypes).toEqual(['STATUS_CHANGED', 'ISSUE_UPDATED', 'COMMENT_ADDED']);
    expect(r.channels[0]).not.toHaveProperty('externalId');
  });

  it('chưa có bot → botReady=false kèm lý do', async () => {
    const r = await setup({ bot: false }).service.overview('w1', 'p1');
    expect(r).toMatchObject({ botReady: false, reason: 'NO_BOT', botUsername: null });
  });
});

describe('createCode / poll', () => {
  it('tạo mã gắn ĐÚNG dự án qua LinkCodesService', async () => {
    const { service, linkCodes } = setup();
    await service.createCode('w1', 'p1', 'u1');
    expect(linkCodes.createCode).toHaveBeenCalledWith('w1', 'g1', 'u1', 'p1');
  });

  it('chưa có bot → từ chối, không tạo mã', async () => {
    const { service, linkCodes } = setup({ bot: false });
    await expect(service.createCode('w1', 'p1', 'u1')).rejects.toThrow(/cài bot Telegram/);
    expect(linkCodes.createCode).not.toHaveBeenCalled();
  });

  it('poll: tra mã theo (mã, tổ chức, dự án, người tạo); khớp → poll kèm expectProjectId', async () => {
    const { service, prisma, linkCodes } = setup();
    await service.poll('w1', 'p1', 'u1', ' k7m2qx ');
    expect(prisma.channelLinkToken.findFirst).toHaveBeenCalledWith({
      where: { token: 'K7M2QX', organizationId: 'w1', projectId: 'p1', createdById: 'u1' },
      select: { integrationId: true },
    });
    expect(linkCodes.poll).toHaveBeenCalledWith('w1', 'g1', 'K7M2QX', 'p1');
  });

  it('poll: mã của dự án khác / người khác / không có → expired, không đọc Telegram', async () => {
    const { service, linkCodes } = setup({ token: null });
    expect(await service.poll('w1', 'p1', 'u1', 'K7M2QX')).toEqual({ status: 'expired' });
    expect(linkCodes.poll).not.toHaveBeenCalled();
  });
});

describe('updateChannel / removeChannel', () => {
  it('chỉ kênh có projectId = dự án của route (kênh dự án khác / cấp tổ chức → 404, không sửa)', async () => {
    const { service, prisma } = setup({ channel: null });
    await expect(
      service.updateChannel('w1', 'p1', 'c1', { isEnabled: false }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.integrationChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', organizationId: 'w1', projectId: 'p1' } }),
    );
    expect(prisma.integrationChannel.update).not.toHaveBeenCalled();
    const rm = setup({ channel: null });
    await expect(rm.service.removeChannel('w1', 'p1', 'c1', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(rm.integrations.removeChannel).not.toHaveBeenCalled();
  });

  it('đổi sự kiện (khử trùng) + bật tắt, ghi nhật ký', async () => {
    const { service, prisma, audit } = setup();
    const r = await service.updateChannel(
      'w1',
      'p1',
      'c1',
      { events: ['COMMENT_ADDED', 'COMMENT_ADDED'], isEnabled: false },
      'u1',
    );
    expect(prisma.integrationChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { events: ['COMMENT_ADDED'], isEnabled: false },
      }),
    );
    expect(r).toMatchObject({ events: ['COMMENT_ADDED'], isEnabled: false });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.channel_updated', actorId: 'u1' }),
    );
  });

  it('chỉ bật tắt → không đụng events; events rỗng ([]) = tất cả sự kiện, được ghi', async () => {
    const a = setup();
    await a.service.updateChannel('w1', 'p1', 'c1', { isEnabled: true }, 'u1');
    expect(a.prisma.integrationChannel.update.mock.calls[0]![0].data).toEqual({ isEnabled: true });
    const b = setup();
    await b.service.updateChannel('w1', 'p1', 'c1', { events: [] }, 'u1');
    expect(b.prisma.integrationChannel.update.mock.calls[0]![0].data).toEqual({ events: [] });
  });

  it('gỡ kênh dự án → dùng removeChannel hiện có (kèm nhật ký) với actor', async () => {
    const { service, integrations } = setup();
    expect(await service.removeChannel('w1', 'p1', 'c1', 'u1')).toEqual({ success: true });
    expect(integrations.removeChannel).toHaveBeenCalledWith('w1', 'c1', 'u1');
  });
});

describe('updateProjectChannelSchema', () => {
  it('chỉ nhận loại sự kiện kênh thật sự gửi; trường lạ / body rỗng bị từ chối', () => {
    expect(updateProjectChannelSchema.safeParse({ events: ['COMMENT_ADDED'] }).success).toBe(true);
    expect(updateProjectChannelSchema.safeParse({ isEnabled: false }).success).toBe(true);
    expect(updateProjectChannelSchema.safeParse({ events: ['SPRINT_STARTED'] }).success).toBe(
      false,
    );
    expect(updateProjectChannelSchema.safeParse({}).success).toBe(false);
    expect(updateProjectChannelSchema.safeParse({ projectId: 'x', isEnabled: true }).success).toBe(
      false,
    );
  });
});
