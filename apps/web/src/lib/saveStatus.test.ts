import { describe, expect, it } from 'vitest';
import { deriveSaveStatus, saveStatusText, saveTrackReducer, type SaveTrack } from './saveStatus';

const T0: SaveTrack = { inFlight: 0, last: 'none', savedAt: null };

describe('saveTrackReducer / deriveSaveStatus', () => {
  it('chưa làm gì → idle', () => {
    expect(deriveSaveStatus(T0)).toEqual({ state: 'idle' });
  });
  it('đang gửi → saving (mọi lần gửi chồng nhau đều tính)', () => {
    const a = saveTrackReducer(T0, { type: 'start' });
    expect(deriveSaveStatus(a)).toEqual({ state: 'saving' });
    const b = saveTrackReducer(a, { type: 'start' });
    expect(b.inFlight).toBe(2);
    const c = saveTrackReducer(b, { type: 'ok', at: 1000 });
    expect(deriveSaveStatus(c)).toEqual({ state: 'saving' }); // còn một lần chưa xong
    const d = saveTrackReducer(c, { type: 'ok', at: 2000 });
    expect(deriveSaveStatus(d)).toEqual({ state: 'saved', at: 2000 });
  });
  it('lần lưu cuối thất bại → error, giữ mốc lưu thành công gần nhất', () => {
    let s = saveTrackReducer(T0, { type: 'start' });
    s = saveTrackReducer(s, { type: 'ok', at: 500 });
    s = saveTrackReducer(s, { type: 'start' });
    s = saveTrackReducer(s, { type: 'fail' });
    expect(deriveSaveStatus(s)).toEqual({ state: 'error' });
    expect(s.savedAt).toBe(500);
  });
  it('sau lỗi, một lần lưu thành công kế tiếp → saved (hết lỗi)', () => {
    let s = saveTrackReducer(T0, { type: 'start' });
    s = saveTrackReducer(s, { type: 'fail' });
    s = saveTrackReducer(s, { type: 'start' });
    expect(deriveSaveStatus(s)).toEqual({ state: 'saving' });
    s = saveTrackReducer(s, { type: 'ok', at: 9 });
    expect(deriveSaveStatus(s)).toEqual({ state: 'saved', at: 9 });
  });
  it('inFlight không âm khi có sự kiện kết thúc thừa', () => {
    expect(saveTrackReducer(T0, { type: 'fail' }).inFlight).toBe(0);
  });
});

describe('saveStatusText', () => {
  it('đúng câu của brief; giờ HH:mm 24h có đệm số 0 qua dateFormat', () => {
    expect(saveStatusText({ state: 'idle' })).toBe('');
    expect(saveStatusText({ state: 'saving' })).toBe('Đang lưu…');
    expect(saveStatusText({ state: 'saved', at: new Date(2026, 9, 19, 9, 7).getTime() })).toBe(
      'Đã lưu lúc 09:07',
    );
    expect(saveStatusText({ state: 'error' })).toBe('Lỗi · Thử lại');
  });
});
