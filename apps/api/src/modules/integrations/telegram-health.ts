export type TelegramHealthState =
  | 'READY'
  | 'NO_CHANNEL'
  | 'NO_BOT'
  | 'TOKEN_ERROR'
  | 'PLATFORM_OFF';

export interface TelegramHealth {
  state: TelegramHealthState;
  label: string;
  hint: string;
}

export interface TelegramHealthInput {
  status: string;
  /** Kết nối có token bot riêng (đã lưu) hay không. */
  hasOwnToken: boolean;
  /** Hệ thống có bot chung (TELEGRAM_BOT_TOKEN) không. */
  globalAvailable: boolean;
  /** Cờ hệ thống `integrationsEnabled`. */
  platformEnabled: boolean;
  /** Số kênh đang bật. */
  channelCount: number;
}

/** Trạng thái thật của một kết nối Telegram — thuần, tính lúc đọc (không lưu). Thứ tự ưu tiên cố định. */
export function telegramHealth(i: TelegramHealthInput): TelegramHealth {
  if (!i.platformEnabled) {
    return {
      state: 'PLATFORM_OFF',
      label: 'Đang tắt toàn hệ thống',
      hint: 'Tích hợp đang bị tắt toàn hệ thống — nhờ quản trị hệ thống bật lại.',
    };
  }
  if (i.status === 'ERROR') {
    return {
      state: 'TOKEN_ERROR',
      label: 'Lỗi token',
      hint: 'Token bot không dùng được — xoá kết nối rồi kết nối lại với token mới từ @BotFather.',
    };
  }
  if (!i.hasOwnToken && !i.globalAvailable) {
    return {
      state: 'NO_BOT',
      label: 'Chưa có bot',
      hint: 'Kết nối này chưa có bot để gửi tin — xoá rồi kết nối lại bằng token bot của bạn (tạo ở @BotFather).',
    };
  }
  if (i.channelCount === 0) {
    return {
      state: 'NO_CHANNEL',
      label: 'Chưa có kênh nhận tin',
      hint: 'Thêm bot vào một nhóm Telegram rồi liên kết nhóm đó để bắt đầu nhận thông báo.',
    };
  }
  return {
    state: 'READY',
    label: 'Sẵn sàng',
    hint: 'Bot và kênh nhận tin đã sẵn sàng — bấm "Kiểm tra" để gửi tin thử.',
  };
}
