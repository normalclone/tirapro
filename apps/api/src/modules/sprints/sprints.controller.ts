import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createSprintSchema, type CreateSprintInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { SprintsService } from './sprints.service';

@ApiTags('sprints')
@Controller('sprints')
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('projectId') projectId: string) {
    return this.sprints.listForProject(this.ws(user), projectId);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId: string,
    @Body(new ZodValidationPipe(createSprintSchema)) dto: CreateSprintInput,
  ) {
    return this.sprints.create(this.ws(user), projectId, dto);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @Post(':id/start')
  async start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sprints.start(this.ws(user), id);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @Post(':id/complete')
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sprints.complete(this.ws(user), id);
  }
}
