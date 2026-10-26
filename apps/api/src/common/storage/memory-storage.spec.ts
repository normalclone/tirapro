import { runObjectStorageContract } from './object-storage.contract.testutil';
import { MemoryStorage } from './memory-storage.testutil';

// Bản giả dùng ở test điểm chạm cũng phải tuân hợp đồng — nếu không test điểm chạm không đáng tin.
runObjectStorageContract('MemoryStorage (bản giả cho test)', () =>
  Promise.resolve({ storage: new MemoryStorage(), cleanup: () => Promise.resolve() }),
);
