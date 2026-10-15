import { describe, expect, it, vi } from 'vitest';
import { DevLinksService } from './dev-links.service';

const LIVE_ISSUE = { workspaceId: 'w1', deletedAt: null, project: { deletedAt: null } };

describe('DevLinksService — bỏ issue của dự án xoá mềm', () => {
  it('listIssueDevLinks: tra issue với project.deletedAt:null; dự án đã xoá => 404', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const service = new DevLinksService({ issue: { findFirst } } as never);
    await expect(service.listIssueDevLinks('w1', 'i1')).rejects.toMatchObject({ status: 404 });
    const { where } = (findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0];
    expect(where).toMatchObject({ id: 'i1', ...LIVE_ISSUE });
  });

  it('findIssue (smart commit qua webhook): tra theo key với project.deletedAt:null', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const service = new DevLinksService({ issue: { findFirst } } as never);
    const find = (
      service as unknown as { findIssue(w: string, k: string): Promise<{ id: string } | null> }
    ).findIssue.bind(service);
    await expect(find('w1', 'ABC-1')).resolves.toBeNull();
    const { where } = (findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0];
    expect(where).toMatchObject({ key: 'ABC-1', ...LIVE_ISSUE });
  });
});
