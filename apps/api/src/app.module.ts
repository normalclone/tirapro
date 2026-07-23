import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { PermissionsGuard } from './modules/rbac/permissions.guard';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IssuesModule } from './modules/issues/issues.module';
import { BoardsModule } from './modules/boards/boards.module';
import { SprintsModule } from './modules/sprints/sprints.module';
import { CommentsModule } from './modules/comments/comments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AiModule } from './modules/ai/ai.module';
import { SearchModule } from './modules/search/search.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { LabelsModule } from './modules/labels/labels.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ActivityModule } from './modules/activity/activity.module';
import { ImportModule } from './modules/import/import.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { MediaModule } from './modules/media/media.module';
import { ExportModule } from './modules/export/export.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { GuidesModule } from './modules/guides/guides.module';
import { DevModule } from './modules/dev/dev.module';
import { TriageModule } from './modules/triage/triage.module';
import { DigestsModule } from './modules/digests/digests.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { ConfigCatalogModule } from './modules/config-catalog/config-catalog.module';
import { IntakeModule } from './modules/intake/intake.module';
import { WorkflowAdminModule } from './modules/workflow-admin/workflow-admin.module';
import { ComponentsModule } from './modules/components/components.module';
import { SavedFiltersModule } from './modules/saved-filters/saved-filters.module';
import { WatchersModule } from './modules/watchers/watchers.module';
import { IssueLinksModule } from './modules/issue-links/issue-links.module';
import { RolesModule } from './modules/roles/roles.module';
import { MembersModule } from './modules/members/members.module';
import { TeamsModule } from './modules/teams/teams.module';
import { AdminModule } from './modules/admin/admin.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { ApiKeyModule } from './modules/api-keys/api-key.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // nest chạy ở cwd apps/api => nạp .env ở root monorepo trước, fallback .env cục bộ
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnv,
    }),
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: (config.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: config.get<number>('throttle.limit') ?? 100,
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    SystemSettingsModule,
    ApiKeyModule,
    RbacModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    UsersModule,
    ProjectsModule,
    IssuesModule,
    BoardsModule,
    SprintsModule,
    CommentsModule,
    RealtimeModule,
    AiModule,
    SearchModule,
    AnalyticsModule,
    LabelsModule,
    NotificationsModule,
    ActivityModule,
    ImportModule,
    AttachmentsModule,
    MediaModule,
    ExportModule,
    IntegrationsModule,
    GuidesModule,
    DevModule,
    TriageModule,
    DigestsModule,
    CustomFieldsModule,
    ConfigCatalogModule,
    IntakeModule,
    WorkflowAdminModule,
    ComponentsModule,
    SavedFiltersModule,
    WatchersModule,
    IssueLinksModule,
    RolesModule,
    MembersModule,
    TeamsModule,
    AdminModule,
  ],
  providers: [
    // Thứ tự: rate-limit -> xác thực (JWT) -> phân quyền (RBAC).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
