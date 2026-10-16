import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { ExportController } from './export.controller';
import type { ExportService } from './export.service';

describe('ExportController.exportIssuesCsv', () => {
  const h = ExportController.prototype.exportIssuesCsv;

  it('quyền project:view theo dự án (cùng luật GET /search), KHÔNG đòi import:run', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.PROJECT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'query', param: 'projectId' });
  });

  function run(truncated: boolean) {
    const svc = {
      exportIssuesCsv: vi.fn().mockResolvedValue({
        csv: 'Mã\r\n',
        truncated,
        filename: 'tirapro-DEMO-sprint-ra-mắt-20261016.csv',
        rows: 7,
      }),
    };
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
    const controller = new ExportController(svc as unknown as ExportService);
    const out = controller.exportIssuesCsv(
      'w1',
      { id: 'u1' } as never,
      { projectId: 'p1', preset: 'bugs' },
      res as never,
    );
    return { svc, headers, out };
  }

  it('truyền người xuất xuống service, đặt header CSV + tên file UTF-8', async () => {
    const { svc, headers, out } = run(false);
    expect(await out).toBe('Mã\r\n');
    expect(svc.exportIssuesCsv).toHaveBeenCalledWith('w1', 'u1', {
      projectId: 'p1',
      preset: 'bugs',
    });
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toBe(
      "attachment; filename*=UTF-8''tirapro-DEMO-sprint-ra-m%E1%BA%AFt-20261016.csv",
    );
    expect(headers['X-Export-Rows']).toBe('7');
    expect(headers['X-Export-Truncated']).toBeUndefined();
  });

  it('chạm trần → X-Export-Truncated: true', async () => {
    const { headers, out } = run(true);
    await out;
    expect(headers['X-Export-Truncated']).toBe('true');
  });
});
