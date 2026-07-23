# DevOps, Infra & Tooling

# Tirapro — Đặc tả Thiết kế Subsystem: DevOps, Infra & Tooling

> Phạm vi tài liệu: Cấu trúc monorepo pnpm workspaces, Docker Compose (Postgres + Redis + Adminer), `.env.example`, scripts root, Prisma migrate/seed workflow, TypeScript config chung + path aliases, ESLint + Prettier, Husky + lint-staged, package shared types, gợi ý CI (GitHub Actions), README quickstart, và quyết định Turborepo vs concurrently. Mục tiêu: chạy được bằng `docker compose up` + `pnpm dev`, production-grade, có seed data.

---

## 1. Tổng quan kiến trúc Infra

```
tirapro/                          # repo root (pnpm workspace + turborepo)
├── apps/
│   ├── api/                      # NestJS 10 + Prisma + Socket.io (port 4000)
│   └── web/                      # React 18 + Vite + Tailwind + shadcn/ui (port 5173)
├── packages/
│   ├── types/                    # @tirapro/types  — interfaces/enums dùng chung FE↔BE (zero-dep)
│   ├── shared/                   # @tirapro/shared — JQL grammar, Zod schemas, constants, utils (dùng chung)
│   ├── eslint-config/            # @tirapro/eslint-config — config ESLint chia sẻ
│   └── tsconfig/                 # @tirapro/tsconfig — base tsconfig dùng chung
├── docker/
│   └── postgres/initdb/          # script init (extensions: uuid-ossp, pg_trgm cho JQL search)
├── .github/workflows/ci.yml      # GitHub Actions CI
├── docker-compose.yml            # postgres + redis + adminer
├── docker-compose.override.yml   # (optional) dev tweaks, không commit production
├── turbo.json                    # Turborepo pipeline
├── pnpm-workspace.yaml
├── package.json                  # root scripts + devDeps
├── tsconfig.json                 # tsconfig solution gốc (references)
├── tsconfig.base.json            # compilerOptions + path aliases dùng chung
├── .env.example
├── .env                          # (gitignored) sao từ .env.example
├── .nvmrc                        # pin Node version
├── .npmrc                        # cấu hình pnpm
├── .prettierrc.json
├── .prettierignore
├── .eslintignore
├── .gitignore
├── .husky/
│   ├── pre-commit                # lint-staged
│   └── commit-msg                # commitlint (optional)
├── commitlint.config.cjs
└── README.md
```

**Sơ đồ phụ thuộc build (Turborepo dependency graph):**

```
@tirapro/types ──┐
                 ├──> @tirapro/shared ──┐
                 │                      ├──> apps/api  (NestJS)
                 └──────────────────────┤
                                        └──> apps/web  (Vite)
```

`types` là gốc (không phụ thuộc gì), `shared` phụ thuộc `types`, hai app phụ thuộc cả hai.

---

## 2. Quyết định: Turborepo vs concurrently

| Tiêu chí | `concurrently` | **Turborepo (chọn)** |
|---|---|---|
| Chạy song song dev | Có | Có (`turbo run dev --parallel`) |
| Caching build/lint/test | Không | Có (local + remote cache) |
| Tôn trọng dependency graph (build `types`→`shared`→apps đúng thứ tự) | Không (phải tự xâu chuỗi) | Có (`dependsOn: ["^build"]`) |
| Incremental: chỉ rebuild package đổi | Không | Có (`--filter`, hash-based) |
| Cấu hình | Tối thiểu | 1 file `turbo.json` |
| Overhead | Gần như 0 | Thấp (1 devDep) |

**Kết luận:** Dùng **Turborepo** làm task orchestrator chính (tận dụng caching + dependency graph cho monorepo có 4 packages + 2 apps). Vẫn giữ `concurrently` như một devDependency dự phòng cho các script ad-hoc nếu cần, nhưng `pnpm dev` mặc định gọi qua Turbo. Lý do quyết định: build order giữa `types → shared → apps` là bắt buộc đúng, và CI hưởng lợi lớn từ caching.

> Giao tiếp với subsystem khác: các kiến trúc sư của `apps/api` và `apps/web` chỉ cần khai báo task `dev`/`build`/`lint`/`test`/`typecheck` trong `package.json` của họ; Turbo tự lo điều phối. Họ KHÔNG cần biết chi tiết Turbo.

---

## 3. Cấu hình pnpm workspace

### 3.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 3.2 `.npmrc`

```ini
# Bắt buộc dependency khai báo tường minh — không cho phép "phantom dependency"
# (NestJS/Prisma đôi khi cần nới lỏng; bật engine-strict để pin Node)
engine-strict=true
auto-install-peers=true
# Prisma + một số native deps cần hoisting có chọn lọc:
public-hoist-pattern[]=*prisma*
public-hoist-pattern[]=@prisma/*
# Cho phép build script của các package native (Prisma engine, esbuild...)
# pnpm v9+: cần approve, có thể khai báo sẵn:
```

> Lưu ý pnpm v9+: lần đầu chạy có thể yêu cầu `pnpm approve-builds` cho `@prisma/engines`, `esbuild`, `@nestjs/core`. Đã ghi rõ trong README.

### 3.3 `.nvmrc`

```
20.18.0
```

Pin Node 20 LTS (NestJS 10 + Vite 5 + Prisma 5 đều tương thích). Root `package.json` khai báo `engines`.

---

## 4. `package.json` gốc

```json
{
  "name": "tirapro",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.18.0",
    "pnpm": ">=9.0.0"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev --parallel",
    "dev:api": "turbo run dev --filter=@tirapro/api",
    "dev:web": "turbo run dev --filter=@tirapro/web",
    "build": "turbo run build",
    "build:packages": "turbo run build --filter=./packages/*",
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint -- --fix",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yml,yaml}\" --cache",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md,yml,yaml}\" --cache",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e",
    "clean": "turbo run clean && rimraf node_modules .turbo",

    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:reset": "docker compose down -v && docker compose up -d",
    "docker:logs": "docker compose logs -f",

    "db:generate": "pnpm --filter @tirapro/api prisma:generate",
    "db:migrate": "pnpm --filter @tirapro/api prisma:migrate",
    "db:migrate:deploy": "pnpm --filter @tirapro/api prisma:migrate:deploy",
    "db:seed": "pnpm --filter @tirapro/api prisma:seed",
    "db:reset": "pnpm --filter @tirapro/api prisma:reset",
    "db:studio": "pnpm --filter @tirapro/api prisma:studio",

    "setup": "pnpm install && pnpm docker:up && wait-on tcp:5432 && pnpm db:generate && pnpm db:migrate && pnpm db:seed",

    "prepare": "husky"
  },
  "devDependencies": {
    "@tirapro/eslint-config": "workspace:*",
    "@tirapro/tsconfig": "workspace:*",
    "turbo": "^2.1.0",
    "prettier": "^3.3.3",
    "eslint": "^8.57.0",
    "husky": "^9.1.6",
    "lint-staged": "^15.2.10",
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "concurrently": "^9.0.1",
    "wait-on": "^8.0.1",
    "rimraf": "^6.0.1",
    "typescript": "^5.6.2"
  }
}
```

> **Điểm giao tiếp:** Script `db:*` đều ủy quyền (`--filter`) sang `apps/api` (nơi sở hữu `schema.prisma` và seed). `setup` là one-shot: cài deps → bật Docker → chờ Postgres sẵn sàng (`wait-on tcp:5432`) → generate client → migrate → seed.

---

## 5. Docker Compose

### 5.1 `docker-compose.yml`

```yaml
name: tirapro

services:
  postgres:
    image: postgres:16-alpine
    container_name: tirapro-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-tirapro}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tirapro_dev_pwd}
      POSTGRES_DB: ${POSTGRES_DB:-tirapro}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-tirapro} -d ${POSTGRES_DB:-tirapro}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: tirapro-redis
    restart: unless-stopped
    command: redis-server --appendonly yes ${REDIS_PASSWORD:+--requirepass $REDIS_PASSWORD}
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  adminer:
    image: adminer:4
    container_name: tirapro-adminer
    restart: unless-stopped
    profiles: ["tools"]          # chỉ chạy khi: docker compose --profile tools up
    ports:
      - "${ADMINER_PORT:-8080}:8080"
    environment:
      ADMINER_DEFAULT_SERVER: postgres
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

**Ghi chú thiết kế:**
- `adminer` đặt sau `profiles: ["tools"]` → mặc định `docker compose up` chỉ bật `postgres` + `redis` (gọn nhẹ); muốn dùng Adminer: `docker compose --profile tools up -d`.
- Healthcheck Postgres dùng `pg_isready` để `wait-on`/`depends_on` hoạt động chính xác.
- Redis bật AOF persistence + optional password (chỉ thêm `--requirepass` khi `REDIS_PASSWORD` set).
- Volume đặt tên (`postgres_data`, `redis_data`) → dữ liệu sống qua `docker compose down`; `docker:reset` (`down -v`) mới xóa sạch.

### 5.2 `docker/postgres/initdb/01-extensions.sql`

```sql
-- Extensions cần cho Tirapro: UUID + full-text/fuzzy search (JQL-like) của subsystem Search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
```

> **Điểm giao tiếp với subsystem Search/Issues:** `pg_trgm` + `btree_gin` được tạo sẵn ở DB init để subsystem JQL-like search có thể tạo GIN index trên text columns mà không cần superuser ở migration. Subsystem DB chỉ cần dùng `@db.*` và `@@index` trong Prisma.

---

## 6. `.env.example`

```dotenv
# =========================================================================
# Tirapro — Environment Variables (sao file này thành .env rồi điền giá trị)
# =========================================================================

# ---------- Node ----------
NODE_ENV=development

# ---------- PostgreSQL (Docker Compose) ----------
POSTGRES_USER=tirapro
POSTGRES_PASSWORD=tirapro_dev_pwd
POSTGRES_DB=tirapro
POSTGRES_PORT=5432

# Prisma connection string (api dùng biến này). schema=public.
# Lưu ý: connection_limit + pool_timeout tốt cho dev; chỉnh ở production.
DATABASE_URL="postgresql://tirapro:tirapro_dev_pwd@localhost:5432/tirapro?schema=public&connection_limit=10&pool_timeout=20"

# ---------- Redis (Socket.io adapter + cache + bull queue) ----------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL="redis://localhost:6379"

# ---------- Adminer ----------
ADMINER_PORT=8080

# ---------- API (NestJS) ----------
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
# CORS: origin của web app (dev). Production: domain thật.
CORS_ORIGIN=http://localhost:5173

# ---------- Auth (JWT access + refresh) ----------
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
JWT_REFRESH_EXPIRES_IN=7d
# bcrypt cost factor
BCRYPT_ROUNDS=10

# ---------- Realtime (Socket.io) ----------
WS_PORT=4000
# Dùng Redis adapter để scale nhiều instance (true ở prod)
WS_USE_REDIS_ADAPTER=false

# ---------- Anthropic Claude API (AI features) ----------
# Nếu để trống, các AI features phải degrade gracefully (subsystem AI xử lý).
ANTHROPIC_API_KEY=
# Model mạnh nhất cho sinh issue / sprint planning; sonnet cho tóm tắt nhanh.
ANTHROPIC_MODEL_PRIMARY=claude-opus-4-8
ANTHROPIC_MODEL_FAST=claude-sonnet-4-6
# Bật/tắt toàn bộ AI features ở mức flag (kết hợp với việc thiếu API key).
AI_FEATURES_ENABLED=true

# ---------- File upload / Attachments ----------
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=25

# ---------- Web (Vite) — phải prefix VITE_ để lộ ra client ----------
VITE_API_BASE_URL=http://localhost:4000/api
VITE_WS_URL=http://localhost:4000
VITE_APP_NAME=Tirapro
```

> **Quy ước (điểm giao tiếp với mọi subsystem):**
> 1. Biến của Vite/web **bắt buộc** prefix `VITE_` (Vite chỉ expose biến có prefix này ra client). Không đặt secret vào biến `VITE_*`.
> 2. `apps/api` đọc env qua `@nestjs/config` + validation schema (Zod/Joi). `apps/web` đọc qua `import.meta.env`.
> 3. `ANTHROPIC_API_KEY` rỗng → subsystem AI phải fallback (đã quy ước ở tech stack). Infra chỉ đảm bảo biến tồn tại và được nạp.
> 4. **Validation env là trách nhiệm của từng app**, nhưng Infra cung cấp `.env.example` là single source of truth — mọi biến mới phải thêm vào đây.

### 6.1 `.gitignore` (trích phần liên quan)

```gitignore
node_modules/
dist/
build/
.turbo/
coverage/
*.log

# env
.env
.env.*.local
.env.local

# uploads (attachments dev)
uploads/

# prisma
apps/api/prisma/*.db

# editor / OS
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
```

---

## 7. TypeScript config chung + path aliases

### 7.1 `packages/tsconfig` (package `@tirapro/tsconfig`)

**`packages/tsconfig/package.json`:**
```json
{
  "name": "@tirapro/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": ["base.json", "nestjs.json", "vite.json", "library.json"]
}
```

**`packages/tsconfig/base.json`:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

**`packages/tsconfig/nestjs.json`** (api kế thừa):
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "NestJS",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2022",
    "lib": ["ES2022"],
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "outDir": "./dist"
  }
}
```

**`packages/tsconfig/vite.json`** (web kế thừa):
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Vite React",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  }
}
```

**`packages/tsconfig/library.json`** (packages/types, packages/shared kế thừa):
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Library",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### 7.2 Path aliases — `tsconfig.base.json` (gốc repo)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@tirapro/types": ["packages/types/src/index.ts"],
      "@tirapro/types/*": ["packages/types/src/*"],
      "@tirapro/shared": ["packages/shared/src/index.ts"],
      "@tirapro/shared/*": ["packages/shared/src/*"]
    }
  }
}
```

> **Quy ước alias (điểm giao tiếp quan trọng):**
> - Import giữa các package/app **luôn** dùng tên package: `import { IssueType } from '@tirapro/types'` — KHÔNG dùng đường dẫn tương đối `../../packages/...`.
> - `apps/api` (NestJS, không bundler): cần `tsconfig-paths` ở dev (`ts-node`/`tsc`) HOẶC trỏ `@tirapro/*` về `dist` đã build. Khuyến nghị: `apps/api/tsconfig.json` thêm `paths` riêng và dùng `tsconfig-paths` register, hoặc Nest đọc `dist` của package qua workspace symlink. Trong dev, Turbo build `types`+`shared` trước (`dependsOn: ["^build"]`) nên symlink trong `node_modules/@tirapro/*` đã có `dist`.
> - `apps/web` (Vite): cấu hình alias ở `vite.config.ts` + `tsconfig.json` paths (Vite tự resolve qua workspace symlink, nhưng để HMR vào source `packages`, thêm alias trỏ src — subsystem web quyết định).

### 7.3 `tsconfig.json` gốc (solution, dùng project references)

```json
{
  "files": [],
  "references": [
    { "path": "./packages/types" },
    { "path": "./packages/shared" },
    { "path": "./apps/api" },
    { "path": "./apps/web" }
  ]
}
```

---

## 8. Package shared types — `@tirapro/types` và `@tirapro/shared`

### 8.1 `@tirapro/types` — interfaces/enums dùng chung (zero runtime dep)

**`packages/types/package.json`:**
```json
{
  "name": "@tirapro/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint \"src/**/*.ts\"",
    "clean": "rimraf dist .turbo"
  },
  "devDependencies": {
    "@tirapro/tsconfig": "workspace:*",
    "@tirapro/eslint-config": "workspace:*",
    "typescript": "^5.6.2",
    "rimraf": "^6.0.1"
  }
}
```

**`packages/types/tsconfig.json`:**
```json
{
  "extends": "@tirapro/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**`packages/types/src/index.ts`** (mẫu khung — nội dung domain do các subsystem điền):
```typescript
// Barrel export. Mỗi subsystem bổ sung file riêng và re-export tại đây.
export * from './enums';
export * from './issue';
export * from './project';
export * from './user';
export * from './workflow';
export * from './realtime-events'; // payload các socket event — subsystem Realtime dùng
export * from './api-contracts';   // DTO request/response — FE & BE cùng tham chiếu
```

**`packages/types/src/enums.ts`** (ví dụ — các enum lõi để mọi subsystem đồng bộ):
```typescript
export enum IssueType {
  EPIC = 'EPIC',
  STORY = 'STORY',
  TASK = 'TASK',
  BUG = 'BUG',
  SUBTASK = 'SUBTASK',
}

export enum Priority {
  HIGHEST = 'HIGHEST',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  LOWEST = 'LOWEST',
}

export enum BoardType {
  KANBAN = 'KANBAN',
  SCRUM = 'SCRUM',
}

export enum SprintState {
  FUTURE = 'FUTURE',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}
```

> **Quy ước:** `@tirapro/types` **không** chứa logic runtime, **không** import Prisma. Đây là nguồn chân lý cho enum chia sẻ; Prisma schema (subsystem DB) phải khớp các enum này (cùng tên/giá trị) để tránh lệch. Subsystem DB có thể generate enum từ đây hoặc khai báo song song — quy ước: **`@tirapro/types` là master cho enum nghiệp vụ dùng ở cả FE & BE.**

### 8.2 `@tirapro/shared` — runtime utils, Zod schemas, JQL grammar, constants

**`packages/shared/package.json`:**
```json
{
  "name": "@tirapro/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint \"src/**/*.ts\"",
    "clean": "rimraf dist .turbo"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@tirapro/types": "workspace:*",
    "@tirapro/tsconfig": "workspace:*",
    "@tirapro/eslint-config": "workspace:*",
    "typescript": "^5.6.2",
    "rimraf": "^6.0.1"
  }
}
```

> `@tirapro/shared` **được phép** phụ thuộc `@tirapro/types` và `zod`. Đây là nơi đặt Zod schemas dùng chung cho validation env, DTO, và để FE & BE cùng validate. **Điểm giao tiếp:** subsystem Auth/Issues/Search đặt Zod schemas DTO ở đây; cả NestJS (qua `ZodValidationPipe`) và React (qua react-hook-form resolver) dùng chung một schema.

---

## 9. ESLint + Prettier

### 9.1 `@tirapro/eslint-config`

**`packages/eslint-config/package.json`:**
```json
{
  "name": "@tirapro/eslint-config",
  "version": "0.0.0",
  "private": true,
  "main": "index.js",
  "files": ["index.js", "react.js", "nest.js"],
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.30.0",
    "eslint-plugin-react": "^7.36.1",
    "eslint-plugin-react-hooks": "^4.6.2",
    "eslint-plugin-jsx-a11y": "^6.10.0"
  }
}
```

**`packages/eslint-config/index.js`** (base, dùng cho mọi package TS):
```js
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // PHẢI ở cuối — tắt mọi rule format xung đột với Prettier
  ],
  settings: {
    'import/resolver': { typescript: { alwaysTryTypes: true } },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
        pathGroups: [{ pattern: '@tirapro/**', group: 'internal' }],
      },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
};
```

**`packages/eslint-config/nest.js`** (api kế thừa):
```js
module.exports = {
  extends: ['./index.js'],
  env: { node: true, jest: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off', // Nest decorators đôi khi cần
    '@typescript-eslint/interface-name-prefix': 'off',
  },
};
```

**`packages/eslint-config/react.js`** (web kế thừa):
```js
module.exports = {
  extends: [
    './index.js',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  env: { browser: true, es2021: true },
  settings: { react: { version: 'detect' } },
  rules: {
    'react/react-in-jsx-scope': 'off', // React 18 automatic JSX runtime
    'react/prop-types': 'off',         // dùng TS thay PropTypes
  },
};
```

> **Điểm giao tiếp:** `apps/api/.eslintrc.cjs` → `{ extends: ['@tirapro/eslint-config/nest'], parserOptions: { project: './tsconfig.json' } }`; `apps/web/.eslintrc.cjs` → `{ extends: ['@tirapro/eslint-config/react'], ... }`. Mỗi app chỉ trỏ `parserOptions.project` vào tsconfig của mình.

### 9.2 Prettier — `.prettierrc.json` (gốc)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf",
  "arrowParens": "always",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

> `prettier-plugin-tailwindcss` tự sort class Tailwind (lợi cho `apps/web`). Plugin này không ảnh hưởng file không có class. Cài ở root devDeps.

**`.prettierignore`:**
```
dist
build
.turbo
coverage
pnpm-lock.yaml
**/*.md
apps/api/prisma/migrations
```

---

## 10. Husky + lint-staged + commitlint

### 10.1 `.husky/pre-commit`
```sh
pnpm exec lint-staged
```

### 10.2 `.husky/commit-msg`
```sh
pnpm exec commitlint --edit "$1"
```

### 10.3 `lint-staged` config (trong root `package.json` hoặc `.lintstagedrc.json`)

**`.lintstagedrc.json`:**
```json
{
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{js,jsx,cjs,mjs}": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{json,md,yml,yaml,css}": [
    "prettier --write"
  ]
}
```

### 10.4 `commitlint.config.cjs`
```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api', 'web', 'types', 'shared', 'infra', 'ci', 'deps', 'release', 'db'],
    ],
  },
};
```

> Conventional Commits: `feat(api): ...`, `fix(web): ...`, `chore(infra): ...`. Scope khớp tên package/app — thuận lợi cho changelog và lọc theo subsystem.

---

## 11. Turborepo — `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env", "tsconfig.base.json"],
  "globalEnv": [
    "NODE_ENV",
    "DATABASE_URL",
    "REDIS_URL",
    "ANTHROPIC_API_KEY"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"],
      "inputs": ["src/**", "prisma/**", "tsconfig.json", "package.json"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Giải thích các quyết định:**
- `dev`: `cache: false` + `persistent: true` (process chạy mãi). `dependsOn: ["^build"]` → đảm bảo `types`+`shared` được build (tạo `dist`) trước khi api/web khởi động dev — tránh lỗi "Cannot find module '@tirapro/types'".
- `build`: `dependsOn: ["^build"]` (topological) → `types`→`shared`→apps đúng thứ tự. `inputs` gồm `prisma/**` để đổi schema → invalidate cache build api.
- `globalEnv`: các env ảnh hưởng output build → khai báo để cache key đúng.

---

## 12. Prisma migrate / seed workflow (sở hữu bởi `apps/api`)

> Phần này định nghĩa **workflow & scripts**; chi tiết `schema.prisma` (models) do subsystem Database/Backend sở hữu. Infra đảm bảo lệnh chạy được và tích hợp vào root scripts.

### 12.1 Scripts trong `apps/api/package.json` (phần Prisma)

```json
{
  "scripts": {
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:reset": "prisma migrate reset --force",
    "prisma:seed": "tsx prisma/seed.ts",
    "prisma:studio": "prisma studio"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- `prisma migrate dev`: dùng ở **local dev** (tạo migration mới + apply + generate).
- `prisma migrate deploy`: dùng ở **CI/production** (chỉ apply migration đã commit, không tạo mới, không reset).
- `prisma:reset`: xóa DB + chạy lại toàn bộ migration + seed (tiện cho dev).
- Seed chạy bằng `tsx` (TypeScript runner nhanh, không cần build).

### 12.2 Vị trí file

```
apps/api/prisma/
├── schema.prisma        # subsystem DB sở hữu
├── seed.ts              # seed data (Infra cung cấp khung + ví dụ)
├── migrations/          # commit vào git
└── seed/                # (tùy chọn) data JSON tách riêng
    ├── users.json
    └── projects.json
```

### 12.3 Khung `apps/api/prisma/seed.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Tirapro database...');

  // --- Users ---
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@projira.dev' },
    update: {},
    create: {
      email: 'admin@projira.dev',
      name: 'Admin User',
      passwordHash,
      role: 'ADMIN',
    },
  });

  // --- Project + members + workflow + issues mẫu ---
  // (subsystem tương ứng bổ sung logic seed của họ tại đây, gọi qua các helper)
  // await seedProjects(prisma, admin.id);
  // await seedWorkflows(prisma);
  // await seedIssues(prisma, project.id);

  console.log(`✅ Seed done. Admin: ${admin.email} / Password123!`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

> **Điểm giao tiếp:** Seed dùng `upsert` (idempotent — chạy nhiều lần không vỡ). Mỗi subsystem (Projects, Issues, Workflows, Sprints) cung cấp một hàm `seedX(prisma, ...)` và đăng ký trong `main()`. Infra giữ entrypoint + đảm bảo `tsx` + script root `db:seed` hoạt động.

### 12.4 Quy trình chuẩn

| Tình huống | Lệnh |
|---|---|
| Lần đầu setup | `pnpm setup` (cài + docker + generate + migrate + seed) |
| Đổi schema (dev) | sửa `schema.prisma` → `pnpm db:migrate` (đặt tên migration) → `pnpm db:generate` |
| Làm mới DB sạch | `pnpm db:reset` |
| CI / deploy | `pnpm db:migrate:deploy` (không tạo migration mới) |
| Xem dữ liệu | `pnpm db:studio` hoặc Adminer (`docker compose --profile tools up`) |

---

## 13. CI — GitHub Actions

**`.github/workflows/ci.yml`:**
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: tirapro
          POSTGRES_PASSWORD: tirapro_dev_pwd
          POSTGRES_DB: tirapro_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U tirapro"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10

    env:
      DATABASE_URL: "postgresql://tirapro:tirapro_dev_pwd@localhost:5432/tirapro_test?schema=public"
      REDIS_URL: "redis://localhost:6379"
      JWT_ACCESS_SECRET: "ci_access_secret_min_32_chars_xxxxxxxx"
      JWT_REFRESH_SECRET: "ci_refresh_secret_min_32_chars_xxxxxxx"
      ANTHROPIC_API_KEY: "" # cố tình rỗng — verify AI degrade gracefully

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-

      - name: Build shared packages
        run: pnpm build:packages

      - name: Prisma generate + migrate (test DB)
        run: |
          pnpm db:generate
          pnpm db:migrate:deploy

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Format check
        run: pnpm format:check

      - name: Build
        run: pnpm build

      - name: Unit tests
        run: pnpm test

      - name: E2E tests
        run: pnpm test:e2e

  commitlint:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec commitlint --from ${{ github.event.pull_request.base.sha }} --to ${{ github.sha }} --verbose
```

**Quyết định CI:**
- Postgres + Redis chạy như `services` (không cần Docker Compose trong CI).
- `ANTHROPIC_API_KEY=""` cố ý để CI xác minh các AI feature **degrade gracefully** (yêu cầu tech stack).
- Build `packages` trước → generate Prisma → migrate `deploy` (không `dev`) → lint → typecheck → format check → build → test.
- Turbo cache lưu qua `actions/cache` để tăng tốc các lần chạy sau.
- `pnpm install --frozen-lockfile` đảm bảo lockfile khớp.

---

## 14. README quickstart

**`README.md`** (phần quickstart trọng tâm):

````markdown
# Tirapro

Clone Jira + nâng cấp (AI, realtime, analytics). Monorepo pnpm + Turborepo.

## Yêu cầu
- Node >= 20.18 (xem `.nvmrc` → `nvm use`)
- pnpm >= 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker + Docker Compose

## Khởi động nhanh (one-shot)
```bash
git clone <repo> tirapro && cd tirapro
cp .env.example .env            # sửa secret nếu cần
corepack enable
pnpm setup                      # install + docker up + prisma generate/migrate/seed
pnpm dev                        # chạy song song api (4000) + web (5173)
```

`pnpm setup` thực hiện: `pnpm install` → `docker compose up -d` (Postgres+Redis) → chờ Postgres → `prisma generate` → `prisma migrate dev` → `prisma db seed`.

Nếu pnpm v9 hỏi approve build scripts:
```bash
pnpm approve-builds   # approve: @prisma/engines, esbuild, @nestjs/core
```

## Truy cập
| Dịch vụ | URL |
|---|---|
| Web (Vite) | http://localhost:5173 |
| API (NestJS) | http://localhost:4000/api |
| Adminer (DB UI) | http://localhost:8080 — chạy `docker compose --profile tools up -d` |
| Prisma Studio | `pnpm db:studio` → http://localhost:5555 |

Tài khoản seed: `admin@projira.dev` / `Password123!`

## Lệnh thường dùng
```bash
pnpm dev            # dev api + web
pnpm dev:api        # chỉ api
pnpm dev:web        # chỉ web
pnpm build          # build tất cả (topological)
pnpm lint           # lint toàn repo
pnpm typecheck      # typecheck toàn repo
pnpm format         # prettier write
pnpm test           # unit tests

pnpm db:migrate     # tạo + apply migration (dev)
pnpm db:seed        # seed lại data
pnpm db:reset       # xóa DB + migrate + seed
pnpm db:studio      # Prisma Studio

pnpm docker:up      # bật Postgres + Redis
pnpm docker:down    # tắt
pnpm docker:reset   # tắt + xóa volume + bật lại (mất data)
```

## Cấu trúc
- `apps/api` — NestJS 10 + Prisma + Socket.io
- `apps/web` — React 18 + Vite + Tailwind + shadcn/ui
- `packages/types` — types/enums dùng chung (`@tirapro/types`)
- `packages/shared` — Zod schemas, utils, JQL grammar (`@tirapro/shared`)
- `packages/tsconfig`, `packages/eslint-config` — config chia sẻ

## AI features
Cần `ANTHROPIC_API_KEY` trong `.env`. Nếu để trống, AI tự degrade (tính năng AI bị tắt, app vẫn chạy bình thường).
````

---

## 15. Tóm tắt điểm giao tiếp với các subsystem khác (Integration Contract)

| Subsystem | Infra cung cấp | Subsystem phải tuân thủ |
|---|---|---|
| **Backend / API** (`apps/api`) | `DATABASE_URL`, `REDIS_URL`, env loader pattern; root script `db:*` ủy quyền sang api; tsconfig `nestjs.json`; eslint `nest.js` | Khai báo task `dev/build/lint/typecheck/test/test:e2e` trong `package.json`; sở hữu `schema.prisma`; cung cấp `prisma:*` scripts; đăng ký hàm seed vào `prisma/seed.ts` |
| **Frontend / Web** (`apps/web`) | `VITE_*` env; tsconfig `vite.json`; eslint `react.js`; `prettier-plugin-tailwindcss` | Prefix mọi env client bằng `VITE_`; khai báo task chuẩn; cấu hình alias `@tirapro/*` trong `vite.config.ts` |
| **Database** | DB Postgres + extensions (`uuid-ossp`, `pg_trgm`, `btree_gin`) sẵn sàng; workflow migrate/seed | Khớp enum với `@tirapro/types`; migration commit vào git; dùng `migrate deploy` ở CI |
| **Realtime** (Socket.io) | Redis sẵn sàng cho adapter (`WS_USE_REDIS_ADAPTER`, `REDIS_URL`) | Đặt payload event types vào `@tirapro/types/realtime-events` |
| **AI** (Claude) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_PRIMARY=claude-opus-4-8`, `ANTHROPIC_MODEL_FAST=claude-sonnet-4-6`, `AI_FEATURES_ENABLED` | Degrade gracefully khi key rỗng; dùng `@anthropic-ai/sdk` (TypeScript); model id chính xác như khai báo |
| **Search (JQL)** | `pg_trgm` + `btree_gin` extensions; chỗ đặt grammar trong `@tirapro/shared` | Đặt JQL grammar/parser vào `@tirapro/shared`; GIN index khai báo trong Prisma |
| **Auth** | `JWT_*`, `BCRYPT_ROUNDS` env | Đặt Zod schema DTO auth vào `@tirapro/shared` để FE & BE dùng chung |

**Hợp đồng chung cho mọi subsystem:**
1. Mọi biến môi trường mới → thêm vào `.env.example` (single source of truth).
2. Mọi type/enum dùng ở cả FE & BE → đặt trong `@tirapro/types`; mọi schema/util runtime dùng chung → `@tirapro/shared`.
3. Import cross-package luôn dùng `@tirapro/*`, không dùng relative path xuyên package.
4. Mỗi `package.json` con phải có đủ task: `dev`, `build`, `lint`, `typecheck`, `test`, `clean` (Turbo điều phối).
5. Commit theo Conventional Commits với scope khớp tên package (`feat(api)`, `fix(web)`, `chore(infra)`...).