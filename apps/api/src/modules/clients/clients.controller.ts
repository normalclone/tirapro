import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ClientsService } from './clients.service';
import {
  createClientSchema, updateClientSchema, setClientProjectsSchema,
  createContractSchema, updateContractSchema,
  type CreateClientInput, type UpdateClientInput, type SetClientProjectsInput,
  type CreateContractInput, type UpdateContractInput,
} from './clients.schemas';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Danh sách khách hàng kèm dự án, hợp đồng và số đếm. */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@CurrentUser() user: AuthUser) {
    return this.clients.list(this.ws(user));
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clients.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createClientSchema)) dto: CreateClientInput,
  ) {
    return this.clients.create(this.ws(user), dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) dto: UpdateClientInput,
  ) {
    return this.clients.update(this.ws(user), id, dto);
  }

  /** Đặt lại toàn bộ tập dự án của khách hàng. */
  @Put(':id/projects')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async setProjects(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setClientProjectsSchema)) dto: SetClientProjectsInput,
  ) {
    return this.clients.setProjects(this.ws(user), id, dto.projectIds);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clients.remove(this.ws(user), id);
  }

  // ───────────────────────── hợp đồng ─────────────────────────

  @Get(':clientId/contracts')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listContracts(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string) {
    return this.clients.listContracts(this.ws(user), clientId);
  }

  @Post(':clientId/contracts')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async createContract(
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(createContractSchema)) dto: CreateContractInput,
  ) {
    return this.clients.createContract(this.ws(user), clientId, dto);
  }

  @Put(':clientId/contracts/:contractId')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async updateContract(
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
    @Body(new ZodValidationPipe(updateContractSchema)) dto: UpdateContractInput,
  ) {
    return this.clients.updateContract(this.ws(user), clientId, contractId, dto);
  }

  @Delete(':clientId/contracts/:contractId')
  @Permissions(PERMISSIONS.CLIENT_MANAGE)
  async removeContract(
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.clients.removeContract(this.ws(user), clientId, contractId);
  }
}
