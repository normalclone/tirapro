import { z } from 'zod';

/** Giá trị mặc định của khoá mã hoá — chỉ để chạy dev, tuyệt đối không dùng ở production. */
export const DEFAULT_INTEGRATION_ENCRYPTION_KEY = 'dev_integration_encryption_key_change_me_0001';

/** Bool từ chuỗi env: "true"/"1" => true, còn lại false. */
const boolEnv = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(def);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional().default(''), // direct (bypass pooler) cho prisma migrate; dev = trùng DATABASE_URL

  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_GLOBAL_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET tối thiểu 16 ký tự'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET tối thiểu 16 ký tự'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().default(12),

  WS_PATH: z.string().default('/realtime'),
  WS_USE_REDIS_ADAPTER: boolEnv(true),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().default(25),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().optional().default('us-east-1'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: boolEnv(true),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_FEATURES_ENABLED: boolEnv(true),
  AI_MODEL_PRIMARY: z.string().default('claude-opus-4-8'),
  // Model rẻ/nhanh cho tác vụ ngắn (tóm tắt, gợi ý). Giá trị này đi qua configuration.ts → ClaudeService, không còn default thứ hai.
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5'),
  AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE: z.coerce.number().int().default(5_000_000),

  EMBEDDING_PROVIDER: z.enum(['voyage', 'openai', 'none']).default('none'),
  EMBEDDING_DIM: z.coerce.number().int().default(1024),
  VOYAGE_API_KEY: z.string().optional().default(''),
  VOYAGE_MODEL: z.string().default('voyage-3'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),

  // ---- Email ----
  // console = ghi thư ra log (dev, chưa gửi thật); smtp = khung, chưa gửi được (chưa cài nodemailer).
  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Tirapro <no-reply@tirapro.local>'),
  // Gốc URL của web — dùng dựng liên kết trong thư (mời, đặt lại mật khẩu). Không có dấu "/" cuối.
  APP_WEB_URL: z.string().url('APP_WEB_URL phải là URL hợp lệ, vd http://localhost:5173').default('http://localhost:5173'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),

  THROTTLE_TTL: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(100),

  // ---- Integrations ----
  // Bot Telegram toàn cục (optional). Workspace có thể BYO token riêng (lưu trong Integration.config).
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_DOMAIN: z.string().optional().default(''), // rỗng => long polling
  // Khóa mã hóa secret tích hợp (AES-256-GCM) — tối thiểu 32 ký tự.
  INTEGRATION_ENCRYPTION_KEY: z
    .string()
    .min(32, 'INTEGRATION_ENCRYPTION_KEY tối thiểu 32 ký tự')
    .default(DEFAULT_INTEGRATION_ENCRYPTION_KEY),
  // Khoá CŨ (optional) để vẫn giải mã được token đã mã hoá trước khi đổi khoá — xem docs/DEPLOY.md, mục "Nâng cấp / đổi khoá".
  INTEGRATION_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || v.length >= 32, 'INTEGRATION_ENCRYPTION_KEY_PREVIOUS để trống hoặc tối thiểu 32 ký tự'),
});

export type Env = z.infer<typeof envSchema>;

/** Lỗi cấu hình chỉ áp dụng ở production (fail-fast khi khởi động). Trả danh sách thông báo. */
export function productionConfigProblems(env: Pick<Env, 'NODE_ENV' | 'INTEGRATION_ENCRYPTION_KEY'>): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const key = env.INTEGRATION_ENCRYPTION_KEY;
  if (key === DEFAULT_INTEGRATION_ENCRYPTION_KEY || key.length < 32) {
    problems.push(
      'INTEGRATION_ENCRYPTION_KEY: ở production phải đặt khoá riêng (tối thiểu 32 ký tự, khác giá trị mặc định) — ví dụ `openssl rand -hex 32`',
    );
  }
  return problems;
}

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => ` - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Biến môi trường không hợp lệ:\n${msg}`);
  }
  const problems = productionConfigProblems(parsed.data);
  if (problems.length) {
    throw new Error(`❌ Cấu hình production không an toàn:\n${problems.map((p) => ` - ${p}`).join('\n')}`);
  }
  return parsed.data;
}
