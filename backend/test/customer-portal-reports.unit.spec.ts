import 'reflect-metadata';
import { OperationStatus } from '@prisma/client';
import { DocumentEngineService } from '../src/modules/document-engine/document-engine.service';
import { CustomerPortalService } from '../src/modules/customer-portal/customer-portal.service';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const context = { requestId: 'r', ip: null, userAgent: null };
const OP = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
// Impressões digitais reais são SHA-256 (64 hex).
const FP_OLD = 'a'.repeat(64);
const FP_NEW = 'b'.repeat(64);

type Internals = {
  buildBlueprintForDocument: jest.Mock;
  renderAndStore: jest.Mock;
  renderedSourceFingerprint: (metadata: unknown) => string | null;
};

function baseDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DOC,
    number: 'OS-000041',
    type: 'WORK_ORDER',
    operationId: OP,
    canceledAt: null,
    storageKey: 'documents/os-v1.pdf',
    mimeType: 'application/pdf',
    finalizedById: 'tec-1',
    renderMetadata: { sourceFingerprint: FP_OLD },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function engineWith(
  document: Record<string, unknown>,
  opts: { currentFingerprint: string; renderFails?: boolean },
) {
  const findUnique = jest.fn().mockResolvedValue(document);
  const prisma = {
    operationDocument: { findUnique },
    operation: { findUnique: jest.fn().mockResolvedValue({ operatorId: 'tec-1' }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const assets = {
    getDocumentPdf: jest.fn((key: string) =>
      Promise.resolve({ content: Buffer.from(`pdf:${key}`) }),
    ),
  };
  const logger = { warn: jest.fn() };
  const service = new DocumentEngineService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never,
    assets as never,
    {} as never,
    {} as never,
  );
  const internals = service as unknown as Internals;
  internals.buildBlueprintForDocument = jest.fn().mockResolvedValue({ metadata: {} });
  // Fingerprint "atual" calculado a partir dos dados de hoje.
  (service as unknown as { withSourceFingerprint: (b: unknown) => unknown }).withSourceFingerprint =
    (): unknown => ({ metadata: { sourceFingerprint: opts.currentFingerprint } });
  internals.renderAndStore = jest.fn(() =>
    opts.renderFails
      ? Promise.reject(new Error('falha ao gerar'))
      : Promise.resolve({
          ...document,
          storageKey: 'documents/os-v2.pdf',
          renderMetadata: { sourceFingerprint: opts.currentFingerprint },
        }),
  );
  return { service, internals, prisma, assets, logger, findUnique };
}

describe('Portal do cliente — PDF do relatório (sempre disponível)', () => {
  it('entrega o PDF existente quando está em dia, sem gerar de novo', async () => {
    const { service, internals } = engineWith(baseDocument(), { currentFingerprint: FP_OLD });

    const file = await service.portalPdf(DOC, 'acc-1', context);

    expect(file.content.toString()).toBe('pdf:documents/os-v1.pdf');
    expect(file.filename).toBe('OS-000041.pdf');
    expect(internals.renderAndStore).not.toHaveBeenCalled();
  });

  it('gera de novo na hora quando o PDF está desatualizado e entrega o novo', async () => {
    const { service, internals, prisma } = engineWith(baseDocument(), {
      currentFingerprint: FP_NEW,
    });

    const file = await service.portalPdf(DOC, 'acc-1', context);

    expect(file.content.toString()).toBe('pdf:documents/os-v2.pdf');
    const [, actor, , origin, extra] = internals.renderAndStore.mock.calls[0] as [
      unknown,
      { id: string },
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(actor.id).toBe('tec-1');
    expect(origin).toBe('SYSTEM');
    expect(extra).toEqual({ trigger: 'CUSTOMER_PORTAL_DOWNLOAD', portalAccountId: 'acc-1' });
    const audit = (
      prisma.auditLog.create.mock.calls[0] as [
        { data: { actor: string; metadata: Record<string, unknown> } },
      ]
    )[0];
    expect(audit.data.actor).toBe('customer-portal:acc-1');
    expect(audit.data.metadata).toMatchObject({ channel: 'CUSTOMER_PORTAL', regenerated: true });
  });

  it('se a geração falhar, entrega a última versão gerada em vez de erro', async () => {
    const { service, logger } = engineWith(baseDocument(), {
      currentFingerprint: FP_NEW,
      renderFails: true,
    });

    const file = await service.portalPdf(DOC, 'acc-1', context);

    expect(file.content.toString()).toBe('pdf:documents/os-v1.pdf');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('nunca gerado e a geração falha: avisa que está em preparação', async () => {
    const { service } = engineWith(baseDocument({ storageKey: null, renderMetadata: null }), {
      currentFingerprint: FP_NEW,
      renderFails: true,
    });

    const error = await service.portalPdf(DOC, 'acc-1', context).catch((cause: unknown) => cause);

    expect((error as ApplicationException).code).toBe('DOCUMENT_DOWNLOAD_NOT_READY');
  });
});

describe('Portal do cliente — acesso aos relatórios', () => {
  const account = { id: 'acc-1', customerId: 'cus-1', organizationId: 'org-1' } as never;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function portalWith(document: Record<string, unknown> | null) {
    const prisma = { operationDocument: { findFirst: jest.fn().mockResolvedValue(document) } };
    const engine = {
      portalPdf: jest.fn().mockResolvedValue({
        content: Buffer.from('x'),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
      portalPreview: jest.fn().mockResolvedValue({}),
    };
    const service = new CustomerPortalService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      engine as never,
    );
    return { service, prisma, engine };
  }

  it('só procura o documento dentro das operações do próprio cliente', async () => {
    const { service, prisma } = portalWith(null);

    const error = await service
      .customerReportPdf(OP, DOC, account, context)
      .catch((cause: unknown) => cause);

    expect((error as ApplicationException).code).toBe('DOCUMENT_NOT_FOUND');
    expect(prisma.operationDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: DOC,
          operationId: OP,
          canceledAt: null,
          operation: { customerId: 'cus-1' },
        }) as unknown,
      }),
    );
  });

  it.each([
    [
      'serviço ainda não concluído',
      {
        finalizedAt: new Date(),
        renderedAt: null,
        operation: { status: OperationStatus.IN_PROGRESS },
      },
    ],
    [
      'relatório ainda em revisão',
      { finalizedAt: null, renderedAt: null, operation: { status: OperationStatus.COMPLETED } },
    ],
  ])('bloqueia quando %s', async (_label, document) => {
    const { service, engine } = portalWith(document);

    const error = await service
      .customerReportPdf(OP, DOC, account, context)
      .catch((cause: unknown) => cause);

    expect((error as ApplicationException).code).toBe('DOCUMENT_DOWNLOAD_NOT_READY');
    expect(engine.portalPdf).not.toHaveBeenCalled();
  });

  it('libera o download de relatório liberado de serviço concluído', async () => {
    const { service, engine } = portalWith({
      finalizedAt: new Date(),
      renderedAt: null,
      operation: { status: OperationStatus.COMPLETED },
    });

    await service.customerReportPdf(OP, DOC, account, context);

    expect(engine.portalPdf).toHaveBeenCalledWith(DOC, 'acc-1', context);
  });
});
