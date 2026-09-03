import { DocumentTemplateType, type Prisma } from '@prisma/client';
import { OPERATION_DOCUMENT_PREFIX, formatDocumentNumber } from '../constants/operations.constants';

/** Cliente Prisma (transação ou não) capaz de operar a sequência de numeração. */
type DocumentSequenceClient = Pick<Prisma.TransactionClient, 'documentNumberSequence'>;

/**
 * Reserva o próximo número para um tipo de documento de operação, incrementando
 * a sequência específica daquele tipo de forma atômica. Retorna já no formato
 * final (ex.: `PMOC-000104`, `OS-000499`).
 *
 * Se `customNumber` for informado (ex.: recibo com número manual), ele é usado
 * como está e nenhuma sequência é consumida.
 *
 * Deve ser chamado apenas quando um NOVO documento é criado — nunca ao atualizar
 * um documento existente, para não gerar buracos na numeração.
 */
export async function reserveDocumentNumber(
  db: DocumentSequenceClient,
  type: DocumentTemplateType,
  customNumber?: string | null,
): Promise<string> {
  if (customNumber && customNumber.trim()) return customNumber.trim();
  const sequence = await db.documentNumberSequence.upsert({
    where: { type },
    create: { type, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return formatDocumentNumber(OPERATION_DOCUMENT_PREFIX[type], sequence.lastNumber);
}
