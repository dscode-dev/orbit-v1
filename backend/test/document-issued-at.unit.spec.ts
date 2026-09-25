import { DocumentBuilderService } from '../src/modules/document-engine/builder/document-builder.service';

/**
 * A "Data de emissão" que aparece no PDF e na pré-visualização não pode vir do
 * relógio: baixar de novo o relatório de um atendimento antigo recarimbava o
 * documento com a data de hoje, e o cliente recebia a mesma peça com datas
 * diferentes.
 */
describe('data de emissão do documento', () => {
  const builder = new DocumentBuilderService({} as never);
  const issuedAt = (
    operation: { completedAt?: Date | null; createdAt?: Date | null },
    document: { finalizedAt?: Date | null; createdAt?: Date | null } | null,
  ) =>
    (
      builder as unknown as {
        issuedAt: (context: unknown, document: unknown) => string;
      }
    ).issuedAt({ operation }, document);

  const finalized = new Date('2026-07-10T12:00:00.000Z');
  const completed = new Date('2026-07-09T08:30:00.000Z');
  const created = new Date('2026-07-01T09:00:00.000Z');

  it('usa a finalização do documento — o momento em que ele foi emitido', () => {
    expect(issuedAt({ completedAt: completed, createdAt: created }, { finalizedAt: finalized })).toBe(
      finalized.toISOString(),
    );
  });

  it('cai para a conclusão do atendimento quando o documento não foi finalizado', () => {
    expect(issuedAt({ completedAt: completed, createdAt: created }, { finalizedAt: null })).toBe(
      completed.toISOString(),
    );
  });

  it('cai para a criação quando o atendimento ainda não foi concluído', () => {
    expect(issuedAt({ completedAt: null, createdAt: created }, { createdAt: created })).toBe(
      created.toISOString(),
    );
  });

  it('não muda quando o mesmo documento é gerado de novo dias depois', () => {
    const operation = { completedAt: completed, createdAt: created };
    const document = { finalizedAt: finalized };

    const primeiraEmissao = issuedAt(operation, document);
    jest.useFakeTimers().setSystemTime(new Date('2026-12-25T18:45:00.000Z'));
    const segundaBaixa = issuedAt(operation, document);
    jest.useRealTimers();

    expect(segundaBaixa).toBe(primeiraEmissao);
    expect(segundaBaixa).not.toContain('2026-12-25');
  });

  it('usa o relógio só quando não há documento nem atendimento concluído', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    // Pré-visualização durante a execução: nada foi emitido ainda.
    expect(issuedAt({ completedAt: null, createdAt: null }, null)).toBe('2026-08-01T10:00:00.000Z');
    jest.useRealTimers();
  });
});
