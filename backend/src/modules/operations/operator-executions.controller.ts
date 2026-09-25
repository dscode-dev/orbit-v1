import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { CommissionQueryDto, PayCommissionDto } from './dto/commission.dto';
import {
  ListOperatorExecutionOperationsQueryDto,
  ListOperatorExecutionsQueryDto,
  OperatorExecutionPeriodDto,
} from './dto/operator-execution.dto';
import { CommissionsService } from './commissions.service';
import { OperatorExecutionsService } from './operator-executions.service';

@Controller('operator-executions')
@Roles(Role.OWNER, Role.MANAGER)
export class OperatorExecutionsController {
  constructor(
    private readonly executions: OperatorExecutionsService,
    private readonly commissions: CommissionsService,
  ) {}

  @Get()
  list(@Query() query: ListOperatorExecutionsQueryDto): Promise<unknown> {
    return this.executions.list(query);
  }

  @Get(':operatorId')
  get(
    @Param('operatorId', new ParseUUIDPipe({ version: '4' })) operatorId: string,
    @Query() query: OperatorExecutionPeriodDto,
  ): Promise<unknown> {
    return this.executions.get(operatorId, query);
  }

  @Get(':operatorId/operations')
  operations(
    @Param('operatorId', new ParseUUIDPipe({ version: '4' })) operatorId: string,
    @Query() query: ListOperatorExecutionOperationsQueryDto,
  ): Promise<unknown> {
    return this.executions.operations(operatorId, query);
  }

  /** Apuração de comissão do técnico (pendente x pago) no intervalo. */
  @Get(':operatorId/commission')
  commission(
    @Param('operatorId', new ParseUUIDPipe({ version: '4' })) operatorId: string,
    @Query() query: CommissionQueryDto,
  ): Promise<unknown> {
    return this.commissions.detail(operatorId, query);
  }

  /** Histórico de fechamentos já pagos (auditoria). */
  @Get(':operatorId/commission/payments')
  commissionPayments(
    @Param('operatorId', new ParseUUIDPipe({ version: '4' })) operatorId: string,
  ): Promise<unknown> {
    return this.commissions.payments(operatorId);
  }

  /** Registra o pagamento da comissão pendente do período (somente OWNER). */
  @Roles(Role.OWNER)
  @Post(':operatorId/commission/pay')
  payCommission(
    @Param('operatorId', new ParseUUIDPipe({ version: '4' })) operatorId: string,
    @Body() body: PayCommissionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.commissions.pay(operatorId, body, actor);
  }
}
