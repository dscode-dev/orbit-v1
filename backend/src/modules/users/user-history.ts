import type { Prisma } from '@prisma/client';

/**
 * Relacionamentos de `User` que representam HISTÓRICO do negócio. Se qualquer
 * um tiver registros, o usuário não pode ser apagado: muitas dessas chaves são
 * `onDelete: SetNull` e o banco apagaria em silêncio quem fez cada atendimento,
 * documento etc. Nesse caso a exclusão vira arquivamento (inativo + deletedAt).
 *
 * Ao adicionar um relacionamento em `User`, classifique-o aqui ou em
 * USER_OWNED_RELATIONS — o teste `user-removal.unit.spec.ts` falha se faltar.
 */
export const USER_HISTORY_RELATIONS = [
  'operations',
  'assignmentsCreated',
  'assignmentsReceived',
  'assignmentEvents',
  'assetLifecycleEvents',
  'maintenancePlans',
  'stockMovements',
  'budgetsCreated',
  'budgetApprovals',
  'budgetHistoryEvents',
  'financialEntriesCreated',
  'financialHistoryEvents',
  'purchaseOrdersCreated',
  'purchaseReceiptsReceived',
  'purchaseHistoryEvents',
  'pmocDefaultOperatorFor',
  'pmocDefaultTechnicianFor',
  'pmocPlannedOperatorFor',
  'pmocPlannedTechnicianFor',
  'pmocExecutionRequests',
  'pmocHistoryEvents',
  'commissionPayments',
  'commissionPaymentsRegistered',
  'commissionEntries',
  'documentsCollected',
  'documentsReviewed',
  'documentsFinalized',
  'documentRevisions',
  'operationPhotosCreated',
  'operationCancellationsRequested',
  'operationCancellationsResolved',
  'salesCreated',
  'saleHistoryEvents',
  'rvtPlansCreated',
  'rvtResponsibleFor',
  'rvtDefaultOperatorFor',
  'rvtExecutionsAssigned',
] as const satisfies readonly (keyof Prisma.UserCountOutputType)[];

/**
 * Dados do próprio usuário, removidos junto com ele numa exclusão física:
 * sessões, preferências, permissões e notificações (cascata no banco), foto de
 * perfil e assinatura (apagadas explicitamente, com os arquivos).
 */
export const USER_OWNED_RELATIONS = [
  'refreshTokens',
  'preferences',
  'permission',
  'notifications',
  'avatarAsset',
  'institutionalSignature',
  // Passkeys (biometria): saem em cascata na exclusão física; no arquivamento, são apagadas.
  'webauthnCredentials',
] as const;

/** Usos da assinatura que a tornam parte do histórico (documentos e modelos). */
export const SIGNATURE_HISTORY_RELATIONS = [
  'templates',
  'templateLinks',
  'pmocOverrides',
  'selectedDocuments',
  'operationCancellations',
] as const satisfies readonly (keyof Prisma.SignatureCountOutputType)[];

export const USER_FOOTPRINT_SELECT = {
  _count: {
    select: Object.fromEntries(USER_HISTORY_RELATIONS.map((name) => [name, true])),
  },
  institutionalSignature: {
    select: {
      id: true,
      imageStorageKey: true,
      _count: {
        select: Object.fromEntries(SIGNATURE_HISTORY_RELATIONS.map((name) => [name, true])),
      },
    },
  },
  avatarAsset: { select: { id: true, storageKey: true } },
} satisfies Prisma.UserSelect;

export type UserFootprint = Prisma.UserGetPayload<{ select: typeof USER_FOOTPRINT_SELECT }>;

/** Quantos registros de histórico (por relacionamento) prendem o usuário. */
export function userHistory(footprint: UserFootprint): Record<string, number> {
  const history: Record<string, number> = {};
  for (const [name, count] of Object.entries(footprint._count)) {
    if (count > 0) history[name] = count;
  }
  const signatureCounts: Record<string, number> = footprint.institutionalSignature?._count ?? {};
  for (const [name, count] of Object.entries(signatureCounts)) {
    if (count > 0) history[`signature.${name}`] = count;
  }
  return history;
}
