import { describe, expect, it } from 'vitest';
import { assertParityDatabase, parityDatabaseName } from './parity-db-guard';

const url = (db: string, q = '?schema=public') =>
  `postgresql://projira:projira@localhost:5433/${db}${q}`;

describe('parityDatabaseName', () => {
  it('lấy tên DB, bỏ query', () => {
    expect(parityDatabaseName(url('projira_w2c'))).toBe('projira_w2c');
    expect(parityDatabaseName(url('projira_w2c', ''))).toBe('projira_w2c');
    expect(parityDatabaseName('postgres://u:p@h/db_x?a=b&c=d')).toBe('db_x');
  });
  it('URL hỏng hoặc không có tên DB → chuỗi rỗng (sẽ bị từ chối)', () => {
    expect(parityDatabaseName('không phải url')).toBe('');
    expect(parityDatabaseName('postgresql://u:p@h:5433/')).toBe('');
  });
});

describe('assertParityDatabase — chỉ DB nháp, từ chối DB thật/demo', () => {
  it.each(['projira_w2c', 'projira_parity', 'x_scratch', 'projira_final_w2c'])(
    'cho phép %s',
    (db) => {
      expect(() => assertParityDatabase(url(db))).not.toThrow();
    },
  );
  it.each([
    'projira',
    'projira_ux',
    'projira_final',
    'projira_integ',
    'projira_integ_2',
    'projira_integ_e2e',
  ])('TỪ CHỐI %s bằng lỗi to, nói rõ đây là DB thật/dùng chung', (db) => {
    expect(() => assertParityDatabase(url(db))).toThrow(/DB thật|dùng chung/);
    expect(() => assertParityDatabase(url(db))).toThrow(db);
  });
  it('tên không nằm trong danh sách cho phép cũng bị từ chối (mặc định là từ chối)', () => {
    expect(() => assertParityDatabase(url('prod'))).toThrow(/_w2c|_parity|_scratch/);
    expect(() => assertParityDatabase(url('w2c_projira'))).toThrow();
    expect(() => assertParityDatabase(url('projira_w2c_old'))).toThrow();
    expect(() => assertParityDatabase('không phải url')).toThrow();
    expect(() => assertParityDatabase('')).toThrow();
  });
  it('chỉ khớp ở CUỐI tên, và không bị lừa bằng query/đường dẫn', () => {
    expect(() => assertParityDatabase('postgresql://u:p@h/projira_ux?x=_w2c')).toThrow();
    expect(() => assertParityDatabase('postgresql://u:p@h/projira_w2c/projira')).toThrow();
  });
});
