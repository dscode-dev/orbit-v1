'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiClientError, documentsApi, useQuery } from '@erp/api';
import { Drawer } from '@erp/ui/drawer';
import { ErrorState } from '@erp/ui/states';
import { SkeletonList } from '@erp/ui/skeletons';
import { brlAmountInWords, formatBrl, parseBrl } from '@erp/utils';

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]';

export function ReceiptEditDrawer({
  documentId,
  onClose,
  onSaved,
}: {
  documentId: string;
  onClose: () => void;
  onSaved: (canceled: boolean) => void;
}) {
  const receipt = useQuery(
    (signal) => documentsApi.getReceipt(documentId, { signal }),
    [documentId],
  );
  const [amount, setAmount] = useState('');
  const [words, setWords] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [warranty, setWarranty] = useState('');
  const [declaration, setDeclaration] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receipt.data) return;
    setAmount(formatBrl(Number(receipt.data.receiptAmount ?? 0)));
    setWords(receipt.data.receiptAmountInWords ?? '');
    setDate(receipt.data.receiptIssuedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
    setDescription(receipt.data.receiptDescription ?? receipt.data.receiptService ?? '');
    setWarranty(receipt.data.receiptWarrantyDays?.toString() ?? '');
    setDeclaration(receipt.data.receiptDeclaration ?? '');
  }, [receipt.data]);

  // Clearing the declaration makes the PDF generate its text from the updated fields.
  function regenerateDeclaration() {
    setDeclaration('');
  }
  async function submit(canceled: boolean) {
    if (!receipt.data || busy) return;
    const value = parseBrl(amount);
    if (
      !canceled &&
      (value === null ||
        value < 0 ||
        value > 999_999_999.99 ||
        !date ||
        !words.trim() ||
        !description.trim() ||
        (warranty !== '' &&
          (!Number.isInteger(Number(warranty)) || Number(warranty) < 1 || Number(warranty) > 3650)))
    ) {
      setError(
        'Preencha data, valor, valor por extenso e descrição. A garantia deve ser de 1 a 3650 dias, ou ficar vazia.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (canceled) await documentsApi.cancelReceipt(documentId, receipt.data.revision);
      else
        await documentsApi.updateReceipt(documentId, {
          revision: receipt.data.revision,
          receiptAmount: value!,
          receiptAmountInWords: words.trim(),
          receiptIssuedAt: date,
          receiptDescription: description.trim(),
          receiptWarrantyDays: warranty ? Number(warranty) : null,
          receiptDeclaration: declaration.trim() || null,
        });
      onSaved(canceled);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Não foi possível ajustar o recibo. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow="Documentos"
      title={`Editar recibo ${receipt.data?.number ?? ''}`}
    >
      {receipt.loading && !receipt.data ? (
        <SkeletonList rows={5} />
      ) : receipt.error && !receipt.data ? (
        <ErrorState error={receipt.error} onRetry={receipt.refetch} />
      ) : (
        receipt.data && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {receipt.data.customer.tradeName || receipt.data.customer.name}. O saldo financeiro
              será ajustado ao salvar. Gere o PDF novamente para emitir o documento atualizado.
            </p>
            {receipt.data.canceledAt ? (
              <p className="text-sm text-[var(--color-danger)]">
                Este recibo foi cancelado e não pode ser editado.
              </p>
            ) : (
              <>
                <fieldset disabled={busy || confirmCancel} className="space-y-4">
                  <label className="block space-y-1 text-sm">
                    <span>Data de emissão *</span>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Valor *</span>
                    <input
                      required
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        const value = parseBrl(event.target.value);
                        if (value !== null) setWords(brlAmountInWords(value));
                        regenerateDeclaration();
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Valor por extenso *</span>
                    <input
                      required
                      maxLength={500}
                      value={words}
                      onChange={(event) => {
                        setWords(event.target.value);
                        regenerateDeclaration();
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>
                      Descrição {receipt.data.sourceSaleId ? 'da venda' : 'dos serviços'} *
                    </span>
                    <textarea
                      required
                      maxLength={10000}
                      rows={4}
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        regenerateDeclaration();
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Garantia em dias</span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={warranty}
                      onChange={(event) => {
                        setWarranty(event.target.value);
                        regenerateDeclaration();
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Declaração personalizada</span>
                    <textarea
                      maxLength={20000}
                      rows={4}
                      value={declaration}
                      onChange={(event) => setDeclaration(event.target.value)}
                      placeholder="Deixe vazio para gerar a declaração com os dados atualizados."
                      className={inputClass}
                    />
                    <span className="text-caption">Confira o valor caso personalize o texto.</span>
                  </label>
                </fieldset>
                {!confirmCancel && (
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar ajustes
                  </button>
                )}
                <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  {confirmCancel ? (
                    <>
                      <p className="text-sm">
                        Cancelar este recibo de {formatBrl(Number(receipt.data.receiptAmount ?? 0))}
                        ? O valor lançado será estornado do saldo e o recibo ficará indisponível
                        para emissão.
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submit(true)}
                          className="h-11 rounded-[var(--radius-md)] bg-[var(--color-danger)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? 'Cancelando…' : 'Confirmar cancelamento'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmCancel(false)}
                          className="h-11 px-3 text-sm"
                        >
                          Manter recibo
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmCancel(true)}
                      className="h-11 text-sm font-medium text-[var(--color-danger)]"
                    >
                      Cancelar recibo
                    </button>
                  )}
                </section>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}
          </form>
        )
      )}
    </Drawer>
  );
}
