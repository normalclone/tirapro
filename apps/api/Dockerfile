# syntax=docker/dockerfile:1
# Tirapro API (NestJS) — image production nhiều tầng.
# Build từ GỐC repo (cần cả packages/*):  docker build -f apps/api/Dockerfile -t tirapro-api .
# Khi chạy cần truyền DATABASE_URL, DIRECT_URL, REDIS_URL, JWT_*_SECRET, INTEGRATION_ENCRYPTION_KEY, CORS_ORIGIN (xem .env.example).

# ---------- Tầng 1: build ----------
FROM node:22-alpine AS build
# openssl: Prisma engine trên Alpine cần thư viện này để generate/chạy.
RUN apk add --no-cache openssl
# Đúng phiên bản pnpm khoá trong package.json (packageManager).
RUN corepack enable
WORKDIR /repo
# HUSKY=0: script `prepare` của husky không có .git trong image, bỏ qua cho khỏi ồn.
ENV HUSKY=0 CI=true

# Chỉ copy manifest trước để lớp `pnpm install` được cache khi chỉ đổi mã nguồn.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# Thứ tự bắt buộc: types -> shared -> prisma client -> api (api import cả ba).
RUN pnpm --filter @tirapro/types build \
 && pnpm --filter @tirapro/shared build \
 && pnpm --filter @tirapro/api db:generate \
 && pnpm --filter @tirapro/api build
# Gói riêng API + chỉ dependency production (kèm @tirapro/types, @tirapro/shared đã build).
# --legacy: pnpm 10 mặc định đòi `inject-workspace-packages`; repo không bật nên dùng chế độ legacy.
RUN pnpm --filter @tirapro/api deploy --legacy --prod /out
# `deploy` cài lại node_modules từ đầu nên Prisma Client đã generate ở trên không đi theo → generate lại trong /out.
RUN cd /out && ./node_modules/.bin/prisma generate

# ---------- Tầng 2: runtime ----------
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
# Chỉ lấy dist + node_modules + prisma (migrations/schema/sql) + 3 script vận hành — không có mã nguồn, devDependencies hay web.
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/prisma ./prisma
# Script vận hành một lần (không phải một phần server): `docker run --rm --env-file … <image> node scripts/seal-webhook-secrets.mjs --dry-run`.
# Chỉ cần node:crypto + @prisma/client (đã có trong node_modules production). Xem docs/DEPLOY.md mục "Checklist triển khai".
# `check-system-roles.mjs` kiểm bộ quyền vai trò hệ thống (docker run … node scripts/check-system-roles.mjs) — cùng cách chạy với hai script trên.
COPY --from=build --chown=node:node /repo/apps/api/scripts/rekey-integrations.mjs /repo/apps/api/scripts/seal-webhook-secrets.mjs /repo/apps/api/scripts/check-system-roles.mjs /repo/apps/api/scripts/storage-migrate-local-to-s3.mjs ./scripts/
# `storage-migrate-local-to-s3.mjs` chuyển tệp local → S3/MinIO (dùng dist/ + @prisma/client; xem docs/DEPLOY.md mục "Lưu tệp trên S3/MinIO").
# Thư mục upload (STORAGE_DRIVER=local) — mount volume vào đây nếu cần giữ file.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrate deploy + db:raw (extension, searchVector, chỉ mục trigram; idempotent, tuần tự hoá bằng advisory lock) rồi mới chạy server — giống startCommand ở render.yaml.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma db execute --file ./prisma/sql/01_pgvector_fts.sql --schema ./prisma/schema.prisma && exec node dist/main.js"]
