import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { createSprintSchema } from '@tirapro/shared';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { SprintsController } from './sprints.controller';

describe('SprintsController.create — projectId nằm trong body', () => {
  it('guard đọc projectId từ body (khớp nơi web gửi)', () => {
    const ref: unknown = Reflect.getMetadata(PROJECT_REF_KEY, SprintsController.prototype.create);
    expect(ref).toEqual({ kind: 'body', param: 'projectId' });
  });

  it('schema giữ lại projectId (không bị strip) và bắt buộc có', () => {
    const parsed = createSprintSchema.parse({ projectId: 'p1', name: 'Sprint 1' });
    expect(parsed.projectId).toBe('p1');
    expect(createSprintSchema.safeParse({ name: 'Sprint 1' }).success).toBe(false);
  });

  it('chuyển dto.projectId xuống service', async () => {
    const create = vi.fn().mockResolvedValue({ id: 's1' });
    const controller = new SprintsController({ create } as never);
    const dto = createSprintSchema.parse({ projectId: 'p1', name: 'Sprint 1' });
    await controller.create('w1', dto);
    expect(create).toHaveBeenCalledWith('w1', 'p1', dto);
  });
});
