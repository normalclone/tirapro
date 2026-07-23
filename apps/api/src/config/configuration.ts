import { validateEnv, type Env } from './env.validation';

/** Cấu hình có cấu trúc, type-safe — nạp qua ConfigModule.load. */
export function configuration() {
  const e: Env = validateEnv(process.env);
  return {
    nodeEnv: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    api: {
      port: e.API_PORT,
      host: e.API_HOST,
      globalPrefix: e.API_GLOBAL_PREFIX,
      version: e.API_VERSION,
      corsOrigin: e.CORS_ORIGIN.split(',').map((s) => s.trim()),
    },
    db: { url: e.DATABASE_URL },
    redis: {
      url: e.REDIS_URL,
      host: e.REDIS_HOST,
      port: e.REDIS_PORT,
      password: e.REDIS_PASSWORD || undefined,
    },
    jwt: {
      accessSecret: e.JWT_ACCESS_SECRET,
      accessExpiresIn: e.JWT_ACCESS_EXPIRES_IN,
      refreshSecret: e.JWT_REFRESH_SECRET,
      refreshExpiresIn: e.JWT_REFRESH_EXPIRES_IN,
      bcryptRounds: e.BCRYPT_ROUNDS,
    },
    ws: { path: e.WS_PATH, useRedisAdapter: e.WS_USE_REDIS_ADAPTER },
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: e.STORAGE_LOCAL_DIR,
      maxFileSizeMb: e.MAX_FILE_SIZE_MB,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKey: e.S3_ACCESS_KEY,
        secretKey: e.S3_SECRET_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
    },
    ai: {
      enabled: e.AI_FEATURES_ENABLED,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      modelPrimary: e.AI_MODEL_PRIMARY,
      modelFast: e.AI_MODEL_FAST,
      monthlyQuotaPerWorkspace: e.AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE,
    },
    embedding: {
      provider: e.EMBEDDING_PROVIDER,
      dim: e.EMBEDDING_DIM,
      voyageApiKey: e.VOYAGE_API_KEY,
      voyageModel: e.VOYAGE_MODEL,
      openaiApiKey: e.OPENAI_API_KEY,
      openaiModel: e.OPENAI_EMBEDDINGS_MODEL,
    },
    throttle: { ttl: e.THROTTLE_TTL, limit: e.THROTTLE_LIMIT },
    integrations: {
      encryptionKey: e.INTEGRATION_ENCRYPTION_KEY,
      telegram: {
        globalBotToken: e.TELEGRAM_BOT_TOKEN,
        webhookDomain: e.TELEGRAM_WEBHOOK_DOMAIN,
        enabled: e.TELEGRAM_BOT_TOKEN.length > 0,
      },
    },
  };
}

export type AppConfig = ReturnType<typeof configuration>;
