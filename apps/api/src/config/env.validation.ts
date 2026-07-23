import { z } from 'zod';

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
  AI_MODEL_FAST: z.string().default('claude-sonnet-4-6'),
  AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE: z.coerce.number().int().default(5_000_000),

  EMBEDDING_PROVIDER: z.enum(['voyage', 'openai', 'none']).default('none'),
  EMBEDDING_DIM: z.coerce.number().int().default(1024),
  VOYAGE_API_KEY: z.string().optional().default(''),
  VOYAGE_MODEL: z.string().default('voyage-3'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),

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
    .default('dev_integration_encryption_key_change_me_0001'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => ` - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Biến môi trường không hợp lệ:\n${msg}`);
  }
  return parsed.data;
}
