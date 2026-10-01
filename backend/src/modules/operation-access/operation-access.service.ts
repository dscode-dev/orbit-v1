import { HttpStatus, Injectable } from '@nestjs/common';
import { AssignmentStatus, Prisma, Role } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PrismaService } from '../database/prisma.service';

const OPERATOR_ACCESS_STATES: AssignmentStatus[] = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.ACCEPTED,
  AssignmentStatus.STARTED,
  AssignmentStatus.PAUSED,
  AssignmentStatus.COMPLETED,
];

export const OPERATOR_ACCESS_DENIED_ACTION = 'OPERATOR_ACCESS_DENIED';
export const OPERATOR_ACCESS_RESOURCE = 'operation_access';

export interface OperationAccessContext {
  requestId?: string | null;
}

export interface OperationAccessTarget {
  resource: string;
  resourceId: string;
  context?: OperationAccessContext;
}

@Injectable()
export class OperationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  operationScope(actor: AuthenticatedUser): Prisma.OperationWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return { assignments: { some: this.assignmentFilter(actor.id) } };
  }

  documentScope(actor: AuthenticatedUser): Prisma.OperationDocumentWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      operation: {
        is: { assignments: { some: this.assignmentFilter(actor.id) } },
      },
    };
  }

  /**
   * Equipamentos que o operador pode enxergar em relatórios: os que aparecem
   * em alguma operação atribuída a ele. Sem isso, uma exportação entregava a
   * carteira inteira (equipamento + cliente + local) a qualquer autenticado.
   */
  equipmentScope(actor: AuthenticatedUser): Prisma.EquipmentWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      OR: [
        { operations: { some: { assignments: { some: this.assignmentFilter(actor.id) } } } },
        { operationInspections: { some: { operation: { assignments: { some: this.assignmentFilter(actor.id) } } } } },
      ],
    };
  }

  maintenanceExecutionScope(actor: AuthenticatedUser): Prisma.MaintenanceExecutionWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      operation: {
        is: { assignments: { some: this.assignmentFilter(actor.id) } },
      },
    };
  }

  lifecycleScope(actor: AuthenticatedUser): Prisma.AssetLifecycleEventWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      operation: {
        is: { assignments: { some: this.assignmentFilter(actor.id) } },
      },
    };
  }

  stockMovementScope(actor: AuthenticatedUser): Prisma.StockMovementWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      OR: [
        { operationId: null },
        { operation: { is: { assignments: { some: this.assignmentFilter(actor.id) } } } },
      ],
    };
  }

  operationPartScope(actor: AuthenticatedUser): Prisma.OperationPartWhereInput {
    if (actor.role !== Role.OPERATOR) return {};
    return {
      operation: { assignments: { some: this.assignmentFilter(actor.id) } },
    };
  }

  async assertOperationAccess(
    actor: AuthenticatedUser,
    operationId: string,
    target: OperationAccessTarget,
  ): Promise<void> {
    if (actor.role !== Role.OPERATOR) return;
    const allowed = await this.prisma.assignment.findFirst({
      where: {
        operationId,
        ...this.assignmentFilter(actor.id),
      },
      select: { id: true },
    });
    if (allowed) return;
    const pendingCancellation = await this.prisma.operationCancellation.findFirst({
      where: { operationId, requestedById: actor.id, status: 'REQUESTED' },
      select: { id: true },
    });
    if (!pendingCancellation) await this.deny(actor, operationId, target, 'NO_ACTIVE_ASSIGNMENT');
  }

  async assertOperationBackedResourceAccess(
    actor: AuthenticatedUser,
    operationId: string | null,
    target: OperationAccessTarget,
  ): Promise<void> {
    if (actor.role !== Role.OPERATOR) return;
    if (!operationId) {
      return this.deny(actor, null, target, 'RESOURCE_NOT_OPERATION_BACKED');
    }
    await this.assertOperationAccess(actor, operationId, target);
  }

  async assertPhotoAccess(
    actor: AuthenticatedUser,
    photoId: string,
    target: OperationAccessTarget,
  ): Promise<void> {
    if (actor.role !== Role.OPERATOR) return;
    const allowed = await this.prisma.operationPhoto.findFirst({
      where: {
        id: photoId,
        OR: [
          { operation: { assignments: { some: this.assignmentFilter(actor.id) } } },
          { cancellation: { is: { requestedById: actor.id, status: 'REQUESTED' } } },
        ],
      },
      select: { id: true },
    });
    if (!allowed) await this.deny(actor, null, target, 'PHOTO_NOT_OWNED');
  }

  async assertMaintenanceExecutionAccess(
    actor: AuthenticatedUser,
    executionId: string,
    target: OperationAccessTarget,
  ): Promise<void> {
    if (actor.role !== Role.OPERATOR) return;
    const allowed = await this.prisma.maintenanceExecution.findFirst({
      where: {
        id: executionId,
        ...this.maintenanceExecutionScope(actor),
      },
      select: { operationId: true },
    });
    if (!allowed) await this.deny(actor, null, target, 'EXECUTION_NOT_OWNED');
  }

  async assertLifecycleEventAccess(
    actor: AuthenticatedUser,
    eventId: string,
    target: OperationAccessTarget,
  ): Promise<void> {
    if (actor.role !== Role.OPERATOR) return;
    const allowed = await this.prisma.assetLifecycleEvent.findFirst({
      where: { id: eventId, ...this.lifecycleScope(actor) },
      select: { operationId: true },
    });
    if (!allowed) await this.deny(actor, null, target, 'HISTORY_NOT_OWNED');
  }

  private assignmentFilter(operatorId: string): Prisma.AssignmentWhereInput {
    return {
      assignedTo: operatorId,
      status: { in: OPERATOR_ACCESS_STATES },
    };
  }

  private async deny(
    actor: AuthenticatedUser,
    operationId: string | null,
    target: OperationAccessTarget,
    reason: string,
  ): Promise<never> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    await this.prisma.auditLog
      .create({
        data: {
          action: OPERATOR_ACCESS_DENIED_ACTION,
          resource: OPERATOR_ACCESS_RESOURCE,
          actor: actor.id,
          metadata: {
            tenant: organization?.id ?? 'single-company-installation',
            userId: actor.id,
            role: actor.role,
            requestedResource: target.resource,
            resourceId: target.resourceId,
            operationId,
            reason,
            requestId: target.context?.requestId ?? null,
          },
        },
      })
      .catch(() => undefined);
    throw new ApplicationException(
      ERROR_CODES.FORBIDDEN,
      'O operador não possui atribuição ativa para este recurso',
      HttpStatus.FORBIDDEN,
    );
  }
}
