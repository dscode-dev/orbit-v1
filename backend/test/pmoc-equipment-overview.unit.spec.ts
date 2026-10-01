import 'reflect-metadata';

import {
  MaintenanceExecutionStatus,
  OperationStatus,
  PmocExecutionRequestStatus,
  PmocGenerationMode,
  PmocOperationalStatus,
} from '@prisma/client';
import { PmocComplianceService } from '../src/modules/pmoc-compliance/pmoc-compliance.service';

describe('PMOC equipment overview', () => {
  it('separates the last completed execution from the next scheduled request', () => {
    const service = new PmocComplianceService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const project = (
      service as unknown as {
        planOverview: (plan: unknown, requests: unknown[]) => {
          completedExecutions: number;
          equipmentExecutions: Array<{
            completedExecutions: number;
            lastExecutionNumber: number | null;
            nextExecutionNumber: number;
            nextExecutionDate: Date | null;
            executionStatus: string;
          }>;
        };
      }
    ).planOverview.bind(service);
    // Datas relativas a "agora": com datas fixas o próximo agendamento vira
    // passado com o tempo e o status esperado (UP_TO_DATE) muda para OVERDUE.
    const day = 24 * 60 * 60 * 1000;
    const scheduledAt = new Date(Date.now() - 45 * day);
    const completedAt = new Date(Date.now() - 44 * day);
    const nextDate = new Date(Date.now() + 30 * day);
    const planEndDate = new Date(Date.now() + 365 * day);

    const overview = project(
      {
        id: 'plan',
        plannedExecutionCount: 12,
        equipments: [{ equipment: { id: 'equipment-1' } }],
        endDate: planEndDate,
        active: true,
        generationMode: PmocGenerationMode.MANUAL,
        operationalStatus: PmocOperationalStatus.ACTIVE,
        executionRequests: [],
      },
      [
        {
          id: 'request-1',
          pmocPlanId: 'plan',
          equipmentId: 'equipment-1',
          executionNumber: 1,
          equipmentExecutionNumber: 1,
          status: PmocExecutionRequestStatus.GENERATED,
          scheduledFor: scheduledAt,
          generatedAt: completedAt,
          cancelledAt: null,
          maintenanceExecution: {
            status: MaintenanceExecutionStatus.LINKED,
            executedAt: null,
          },
          operation: {
            id: 'operation-1',
            number: 1,
            status: OperationStatus.COMPLETED,
            completedAt,
            signedAt: null,
            documents: [],
          },
        },
        {
          id: 'request-2',
          pmocPlanId: 'plan',
          equipmentId: 'equipment-1',
          executionNumber: 2,
          equipmentExecutionNumber: 2,
          status: PmocExecutionRequestStatus.PENDING,
          scheduledFor: nextDate,
          generatedAt: null,
          cancelledAt: null,
          maintenanceExecution: {
            status: MaintenanceExecutionStatus.PLANNED,
            executedAt: null,
          },
          operation: null,
        },
      ],
    );

    expect(overview.completedExecutions).toBe(1);
    expect(overview.equipmentExecutions[0]).toMatchObject({
      completedExecutions: 1,
      lastExecutionNumber: 1,
      nextExecutionNumber: 2,
      nextExecutionDate: nextDate,
      executionStatus: 'UP_TO_DATE',
    });
  });
});
