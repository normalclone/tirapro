import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const globalPrefix = config.get<string>('api.globalPrefix') ?? 'api';
  const version = config.get<string>('api.version') ?? 'v1';
  app.setGlobalPrefix(`${globalPrefix}/${version}`);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string[]>('api.corsOrigin') ?? true,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  // AllExceptions là fallback; Prisma filter đăng ký sau để ưu tiên lỗi Prisma.
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  if (!config.get<boolean>('isProd')) {
    const docConfig = new DocumentBuilder()
      .setTitle('Tirapro API')
      .setDescription(
        'REST API cho tích hợp ngoài & khai thác dữ liệu (Jira clone + AI/Realtime/Analytics).\n\n' +
          '**Xác thực**: gửi `Authorization: Bearer <token>` — token là JWT (đăng nhập web) HOẶC API key dạng `tira_…` ' +
          '(tạo ở Cài đặt → API & MCP). Có thể dùng header `X-API-Key: tira_…` thay thế. ' +
          'Bấm **Authorize** rồi dán key để thử trực tiếp.\n\n' +
          '**MCP** (cho trợ lý AI): Streamable HTTP tại `http://localhost:4100/mcp`. ' +
          'Tổng quan nhanh: `GET /api/v1/help`.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'JWT hoặc API key tira_…' }, 'bearer')
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'API key tira_…' }, 'api-key')
      .build();
    const doc = SwaggerModule.createDocument(app, docConfig);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  const port = config.get<number>('api.port') ?? 4000;
  const host = config.get<string>('api.host') ?? '0.0.0.0';
  await app.listen(port, host);
  logger.log(`🚀 Tirapro API: http://localhost:${port}/${globalPrefix}/${version}`);
  if (!config.get<boolean>('isProd')) {
    logger.log(`📚 Swagger: http://localhost:${port}/${globalPrefix}/docs`);
  }
}

void bootstrap();
