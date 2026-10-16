import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ClientsService } from './clients.service';
import {
  createClientSchema,
  updateClientSchema,
  setClientProjectsSchema,
  createContractSchema,
  updateContractSchema,
  type CreateClientInput,
  type UpdateClientInput,
  type SetClientProjectsInput,
  type CreateContractInput,
  type UpdateContractInput,
} from './clients.schemas';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  /** Danh sách khách hàng kèm dự án, hợp đồng và số đếm. */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.clients.list(workspaceId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.clients.get(workspaceId, id, user.id);
  }

  @Post()
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createClientSchema)) dto: CreateClientInput,
  ) {
    return this.clients.create(workspaceId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) dto: UpdateClientInput,
  ) {
    return this.clients.update(workspaceId, id, dto, user.id);
  }

  /** Đặt lại toàn bộ tập dự án của khách hàng. */
  @Put(':id/projects')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async setProjects(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setClientProjectsSchema)) dto: SetClientProjectsInput,
  ) {
    return this.clients.setProjects(workspaceId, id, dto.projectIds, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.clients.remove(workspaceId, id);
  }

  // ───────────────────────── hợp đồng ─────────────────────────

  @Get(':clientId/contracts')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listContracts(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
  ) {
    return this.clients.listContracts(workspaceId, clientId, user.id);
  }

  @Post(':clientId/contracts')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async createContract(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(createContractSchema)) dto: CreateContractInput,
  ) {
    return this.clients.createContract(workspaceId, clientId, dto, user.id);
  }

  @Put(':clientId/contracts/:contractId')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async updateContract(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
    @Body(new ZodValidationPipe(updateContractSchema)) dto: UpdateContractInput,
  ) {
    return this.clients.updateContract(workspaceId, clientId, contractId, dto, user.id);
  }

  @Delete(':clientId/contracts/:contractId')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async removeContract(
    @WorkspaceId() workspaceId: string,
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.clients.removeContract(workspaceId, clientId, contractId);
  }
}
