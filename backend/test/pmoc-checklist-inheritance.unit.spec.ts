import {
  MaintenanceChecklistResult,
  OperationMaintenanceType,
  PmocChecklistUnit,
  Role,
} from '@prisma/client';
import { OperationType } from '../src/shared/constants/service-types.constants';
import { PmocExecutionRequestsService } from '../src/modules/pmoc-compliance/pmoc-execution-requests.service';
import type { AuthenticatedUser } from '../src/shared/types/authenticated-user.type';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@orbit.test',
  username: 'owner',
  name: 'Owner',
  role: Role.OWNER,
  isActive: true,
  mustChangePassword: false,
};

// Catálogo global do "Checklist PMOC" (workflow PMOC), classificado por unidade.
const unitChecklist = [
  {
    id: 'cat-evap-1',
    title: 'Limpar filtros da evaporadora',
    pmocUnit: PmocChecklistUnit.EVAPORATOR,
    maintenanceType: OperationMaintenanceType.MONTHLY,
  },
  {
    id: 'cat-evap-2',
    title: 'Higienizar serpentina da evaporadora',
    pmocUnit: PmocChecklistUnit.EVAPORATOR,
    maintenanceType: null,
  },
  {
    id: 'cat-cond-1',
    title: 'Medir pressão da condensadora',
    pmocUnit: PmocChecklistUnit.CONDENSER,
    maintenanceType: OperationMaintenanceType.MONTHLY,
  },
];

function plan(includeChecklistInOperations: boolean): Record<string, unknown> {
  const equipment = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Split 18.000 BTU',
    addressId: null,
    address: null,
  };
  const secondEquipment = {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Condensadora principal',
    addressId: null,
    address: { name: 'Cobertura' },
  };
  return {
    id: '33333333-3333-4333-8333-333333333333',
    number: 14,
    organizationId: '44444444-4444-4444-8444-444444444444',
    customerId: '55555555-5555-4555-8555-555555555555',
    equipmentId: equipment.id,
    equipment,
    equipments: [{ equipment }, { equipment: secondEquipment }],
    customer: { addresses: [] },
    maintenancePlan: { name: 'PMOC Cliente' },
    defaultOperator: null,
    defaultTechnician: null,
    defaultOperatorId: null,
    defaultAddressId: null,
    defaultOperationType: OperationType.PREVENTIVA,
    serviceTypes: [OperationType.PREVENTIVA],
    defaultOperationObservations: null,
    defaultEstimatedDurationMinutes: null,
    coverage: 'Climatização',
    observations: null,
    periodicity: 'MONTHLY',
    includeChecklistInOperations,
    // Itens que o owner marcou como executados no wizard (subconjunto do catálogo).
    checklists: [
      {
        technicalCatalogId: 'cat-evap-1',
        position: 0,
        technicalCatalog: { id: 'cat-evap-1', title: 'Limpar filtros da evaporadora', active: true },
      },
    ],
  };
}

describe('PMOC checklist per unit', () => {
  const service = new PmocExecutionRequestsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const build = (
    service as unknown as {
      buildOperationPayload: (
        plan: unknown,
        scheduledFor: Date,
        actor: AuthenticatedUser,
        unitChecklist: unknown,
        reviewed?: {
          checklist?: Array<{ label: string; done: boolean }>;
          maintenanceChecklist?: unknown;
          inspectedEquipments?: Array<{ equipmentId: string; sector: string }>;
        },
      ) => {
        checklist?: Array<{ label: string; done: boolean }>;
        maintenanceChecklist?: Array<{
          pmocUnit: PmocChecklistUnit;
          maintenanceType: OperationMaintenanceType;
          description: string;
          executed: boolean;
          result: MaintenanceChecklistResult;
        }>;
        inspectedEquipments?: Array<{ equipmentId: string; sector: string }>;
      };
    }
  ).buildOperationPayload.bind(service);

  it('lists every unit procedure and marks the executed ones as Sim', () => {
    const payload = build(plan(true), new Date('2026-08-01T12:00:00.000Z'), actor, unitChecklist);
    // Campo checklist da OS reflete os itens marcados como executados.
    expect(payload.checklist).toEqual([
      { label: 'Limpar filtros da evaporadora', done: true },
    ]);
    // Todos os procedimentos do catálogo entram na tabela; executed = marcação.
    expect(payload.maintenanceChecklist).toEqual([
      {
        pmocUnit: PmocChecklistUnit.EVAPORATOR,
        maintenanceType: OperationMaintenanceType.MONTHLY,
        description: 'Limpar filtros da evaporadora',
        executed: true,
        result: MaintenanceChecklistResult.YES,
      },
      {
        pmocUnit: PmocChecklistUnit.EVAPORATOR,
        maintenanceType: OperationMaintenanceType.MONTHLY,
        description: 'Higienizar serpentina da evaporadora',
        executed: false,
        result: MaintenanceChecklistResult.NO,
      },
      {
        pmocUnit: PmocChecklistUnit.CONDENSER,
        maintenanceType: OperationMaintenanceType.MONTHLY,
        description: 'Medir pressão da condensadora',
        executed: false,
        result: MaintenanceChecklistResult.NO,
      },
    ]);
    expect(payload.inspectedEquipments).toEqual([
      {
        equipmentId: '22222222-2222-4222-8222-222222222222',
        sector: 'Split 18.000 BTU',
      },
    ]);
  });

  it('generates the Work Order without checklist when the owner opts out', () => {
    const payload = build(plan(false), new Date('2026-08-01T12:00:00.000Z'), actor, unitChecklist);
    expect(payload.checklist).toEqual([]);
    expect(payload.maintenanceChecklist).toEqual([]);
  });

  it('keeps the unit procedures even when a reviewed general checklist differs', () => {
    const payload = build(plan(true), new Date('2026-08-01T12:00:00.000Z'), actor, unitChecklist, {
      checklist: [{ label: 'Procedimento adicional', done: false }],
      inspectedEquipments: [],
    });
    // O checklist geral revisado alimenta apenas o campo `checklist`.
    expect(payload.checklist).toEqual([{ label: 'Procedimento adicional', done: false }]);
    // A tabela do PMOC continua vindo do catálogo por unidade.
    expect(payload.maintenanceChecklist).toHaveLength(3);
    expect(payload.maintenanceChecklist?.map((item) => item.executed)).toEqual([true, false, false]);
    expect(payload.inspectedEquipments).toHaveLength(1);
  });
});
