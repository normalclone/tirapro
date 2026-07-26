import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { TestingService } from './testing.service';
import {
  addRunCasesSchema, createBugFromExecutionSchema, createTestCaseSchema, createTestRunSchema,
  setExecutionSchema, testCaseIssuesSchema, updateTestCaseSchema, updateTestRunSchema,
  type AddRunCasesInput, type CreateBugFromExecutionInput, type CreateTestCaseInput,
  type CreateTestRunInput, type SetExecutionInput, type TestCaseIssuesInput,
  type UpdateTestCaseInput, type UpdateTestRunInput,
} from './testing.schemas';

/**
 * Quản lý kiểm thử theo DỰ ÁN. `:projectId` là param đầu tiên nên PermissionsGuard tự
 * chấm quyền theo đúng dự án (đọc: project:view — ghi: test:manage).
 */
@ApiTags('testing')
@Controller('testing')
export class TestingController {
  constructor(private readonly testing: TestingService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ───────────────── Ca kiểm thử ─────────────────

  @Get(':projectId/cases')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listCases(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('search') search?: string,
    @Query('folder') folder?: string,
  ) {
    return this.testing.listCases(this.ws(user), projectId, { search, folder });
  }

  @Get(':projectId/folders')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listFolders(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.testing.listFolders(this.ws(user), projectId);
  }

  @Get(':projectId/cases/:caseId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async getCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.testing.getCase(this.ws(user), projectId, caseId);
  }

  @Post(':projectId/cases')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async createCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createTestCaseSchema)) dto: CreateTestCaseInput,
  ) {
    return this.testing.createCase(this.ws(user), projectId, dto, user.id);
  }

  @Put(':projectId/cases/:caseId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async updateCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(updateTestCaseSchema)) dto: UpdateTestCaseInput,
  ) {
    return this.testing.updateCase(this.ws(user), projectId, caseId, dto);
  }

  @Delete(':projectId/cases/:caseId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async removeCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.testing.removeCase(this.ws(user), projectId, caseId);
  }

  @Post(':projectId/cases/:caseId/issues')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async linkIssues(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(testCaseIssuesSchema)) dto: TestCaseIssuesInput,
  ) {
    return this.testing.linkIssues(this.ws(user), projectId, caseId, dto.issueIds);
  }

  @Delete(':projectId/cases/:caseId/issues')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async unlinkIssues(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(testCaseIssuesSchema)) dto: TestCaseIssuesInput,
  ) {
    return this.testing.unlinkIssues(this.ws(user), projectId, caseId, dto.issueIds);
  }

  // ───────────────── Đợt chạy ─────────────────

  @Get(':projectId/runs')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listRuns(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.testing.listRuns(this.ws(user), projectId);
  }

  @Get(':projectId/runs/:runId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async getRun(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.testing.getRun(this.ws(user), projectId, runId);
  }

  @Post(':projectId/runs')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async createRun(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createTestRunSchema)) dto: CreateTestRunInput,
  ) {
    return this.testing.createRun(this.ws(user), projectId, dto, user.id);
  }

  @Put(':projectId/runs/:runId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async updateRun(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(updateTestRunSchema)) dto: UpdateTestRunInput,
  ) {
    return this.testing.updateRun(this.ws(user), projectId, runId, dto);
  }

  @Delete(':projectId/runs/:runId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async removeRun(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.testing.removeRun(this.ws(user), projectId, runId);
  }

  @Post(':projectId/runs/:runId/cases')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async addRunCases(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(addRunCasesSchema)) dto: AddRunCasesInput,
  ) {
    return this.testing.addCases(this.ws(user), projectId, runId, dto.caseIds);
  }

  @Delete(':projectId/runs/:runId/cases/:caseId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async removeRunCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.testing.removeCaseFromRun(this.ws(user), projectId, runId, caseId);
  }

  @Put(':projectId/runs/:runId/executions/:caseId')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async setResult(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(setExecutionSchema)) dto: SetExecutionInput,
  ) {
    return this.testing.setResult(this.ws(user), projectId, runId, caseId, dto, user.id);
  }

  @Post(':projectId/runs/:runId/executions/:caseId/bug')
  @Permissions(PERMISSIONS.TEST_MANAGE)
  async createBug(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(createBugFromExecutionSchema)) dto: CreateBugFromExecutionInput,
  ) {
    return this.testing.createBug(this.ws(user), projectId, runId, caseId, dto, user.id);
  }
}
