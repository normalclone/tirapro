import { describe, expect, it, vi } from 'vitest';
import { LabelsService } from './labels.service';

function make(archivedAt: Date | null) {
  const attachCreate = vi.fn().mockResolvedValue({});
  const attachDelete = vi.fn().mockResolvedValue({});
  const prisma = {
    issue: {
      findFirst: vi.fn().mockResolvedValue({ id: 'i1', projectId: 'p1' }),
      findUnique: vi.fn().mockResolvedValue({ project: { archivedAt } }),
    },
    label: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }) },
    issueLabel: { create: attachCreate, delete: attachDelete },
  };
  return { service: new LabelsService(prisma as never), attachCreate, attachDelete };
}

describe('LabelsService — dự án đã lưu trữ là chỉ đọc', () => {
  const archived = new Date('2026-10-01T00:00:00Z');

  it('attach(): dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, attachCreate } = make(archived);
    await expect(service.attach('w1', 'i1', 'l1')).rejects.toMatchObject({ status: 422 });
    expect(attachCreate).not.toHaveBeenCalled();
  });

  it('detach(): dự án đã lưu trữ => 422, không xoá', async () => {
    const { service, attachDelete } = make(archived);
    await expect(service.detach('w1', 'i1', 'l1')).rejects.toMatchObject({ status: 422 });
    expect(attachDelete).not.toHaveBeenCalled();
  });

  it('attach(): dự án đang hoạt động => ghi bình thường', async () => {
    const { service, attachCreate } = make(null);
    await expect(service.attach('w1', 'i1', 'l1')).resolves.toEqual({ ok: true });
    expect(attachCreate).toHaveBeenCalledOnce();
  });
});
