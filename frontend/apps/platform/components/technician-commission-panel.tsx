"use client";

/**
 * Comissões do técnico: apuração por intervalo e tipo de serviço, fechamento
 * ("marcar como paga") e histórico de pagamentos para auditoria.
 *
 * O que já foi pago fica vinculado a um fechamento e sai do valor pendente —
 * por isso comissões quitadas (inclusive as pagas manualmente antes da feature,
 * fechando o período retroativo) nunca são recalculadas.
 *
 * O pagamento tem três formas, todas confirmadas antes de gravar: o período
 * inteiro, uma seleção de atendimentos ou um único item da lista.
 */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, HandCoins, History, Loader2 } from "lucide-react";
import {
  operatorExecutionsApi,
  serviceTypesApi,
  useQuery,
  errorMessage,
  type CommissionDetail,
  type CommissionItem,
} from "@erp/api";
import { Gate } from "@erp/ui/auth/gate";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { ConfirmDialog } from "@erp/ui/confirm-dialog";
import { formatCurrencyBRL, formatDate } from "@erp/utils";

const PERIOD_LABEL: Record<string, string> = {
  WEEKLY: "semanal",
  BIWEEKLY: "quinzenal",
  MONTHLY: "mensal",
};

const controlCls =
  "h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm outline-none focus:border-[var(--color-primary)]";

/** Alvo do fechamento: período todo, seleção ou um único atendimento. */
type PayTarget = {
  mode: "period" | "selection" | "single";
  /** Ausente = todos os pendentes do período (fechamento completo). */
  operationIds?: string[];
  count: number;
  amount: number;
  /** Só no individual: identifica o atendimento na confirmação. */
  reference?: string;
};

/** Um item só pode ser pago se ainda estiver pendente e não cancelado. */
const isPayable = (item: CommissionItem) => !item.paid && !item.canceled;

const operationLabel = (item: CommissionItem) => `OP-${String(item.number).padStart(6, "0")}`;

export function TechnicianCommissionPanel({ operatorId }: { operatorId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmPay, setConfirmPay] = useState<PayTarget | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { hasRole } = useAuth();
  const canPay = hasRole("OWNER");

  const types = useQuery((signal) => serviceTypesApi.list({ signal }), []);
  const data = useQuery<CommissionDetail>(
    (signal) =>
      operatorExecutionsApi.commission(operatorId, {
        from: from || undefined,
        to: to || undefined,
        serviceType: serviceType || undefined,
        signal,
      }),
    [operatorId, from, to, serviceType, reloadKey],
  );
  const payments = useQuery(
    (signal) => operatorExecutionsApi.commissionPayments(operatorId, { signal }),
    [operatorId, reloadKey],
  );

  // Na primeira carga o backend devolve o intervalo da janela configurada.
  useEffect(() => {
    if (!from && !to && data.data?.range) {
      setFrom(data.data.range.from.slice(0, 10));
      setTo(data.data.range.to.slice(0, 10));
    }
  }, [data.data, from, to]);

  const summary = data.data?.summary;
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const periodLabel = PERIOD_LABEL[data.data?.period ?? "MONTHLY"] ?? "mensal";

  const payableItems = useMemo(() => items.filter(isPayable), [items]);
  // A seleção não sobrevive a filtros/recargas que tiram o item da lista.
  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => payableItems.some((item) => item.operationId === id)),
    );
  }, [payableItems]);

  const selection = useMemo(
    () => payableItems.filter((item) => selectedIds.includes(item.operationId)),
    [payableItems, selectedIds],
  );
  const selectionAmount = selection.reduce((sum, item) => sum + item.commission, 0);
  const allSelected = payableItems.length > 0 && selection.length === payableItems.length;

  const toggleItem = (operationId: string) =>
    setSelectedIds((current) =>
      current.includes(operationId)
        ? current.filter((id) => id !== operationId)
        : [...current, operationId],
    );
  const toggleAll = () =>
    setSelectedIds(allSelected ? [] : payableItems.map((item) => item.operationId));

  /** Abre a confirmação para o período inteiro, a seleção ou um único item. */
  const askPayPeriod = () =>
    setConfirmPay({
      mode: "period",
      count: summary?.pendingCount ?? 0,
      amount: summary?.pendingAmount ?? 0,
    });
  const askPaySelection = () =>
    setConfirmPay({
      mode: "selection",
      operationIds: selection.map((item) => item.operationId),
      count: selection.length,
      amount: selectionAmount,
    });
  const askPaySingle = (item: CommissionItem) =>
    setConfirmPay({
      mode: "single",
      operationIds: [item.operationId],
      count: 1,
      amount: item.commission,
      reference: operationLabel(item),
    });

  const pay = async () => {
    if (!confirmPay) return;
    setPaying(true);
    setError(null);
    try {
      const result = await operatorExecutionsApi.payCommission(operatorId, {
        from: from || undefined,
        to: to || undefined,
        serviceType: serviceType || undefined,
        operationIds: confirmPay.operationIds,
      });
      setNotice(
        `Comissão de ${formatCurrencyBRL(result.amount)} registrada como paga (${result.operationCount} atendimento(s)).`,
      );
      setSelectedIds([]);
      setConfirmPay(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(errorMessage(e));
      setConfirmPay(null);
    } finally {
      setPaying(false);
    }
  };

  const confirmText = (target: PayTarget) => {
    const total = formatCurrencyBRL(target.amount);
    if (target.mode === "single") {
      return `O atendimento ${target.reference} será marcado como pago, no valor de ${total}. O valor sai do pendente e fica registrado no histórico para auditoria.`;
    }
    if (target.mode === "selection") {
      return `Serão marcados como pagos ${target.count} atendimento(s) selecionado(s), totalizando ${total}. Os demais continuam pendentes.`;
    }
    return `Serão marcados como pagos todos os ${target.count} atendimento(s) pendentes do período, totalizando ${total}. O valor sai do pendente e fica registrado no histórico para auditoria.`;
  };

  return (
    <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HandCoins className="h-5 w-5 text-[var(--color-primary)]" /> Comissões
          </h2>
          <p className="text-caption">
            Apuração {periodLabel} · o valor a pagar considera apenas atendimentos ainda não pagos.
            Operações canceladas continuam listadas para auditoria, mas não entram no total.
          </p>
        </div>
        <Gate roles={["OWNER"]}>
          <button
            type="button"
            className="btn-primary h-9"
            disabled={!summary || summary.pendingCount === 0}
            onClick={askPayPeriod}
          >
            <BadgeCheck className="h-4 w-4" /> Pagar período
          </button>
        </Gate>
      </header>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-caption">De</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={controlCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-caption">Até</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={controlCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-caption">Tipo de serviço</span>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={controlCls}>
            <option value="">Todos</option>
            {(types.data?.items ?? []).map((type) => (
              <option key={type.id} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <span className="text-caption">A pagar no período</span>
          <strong className="mt-1 block text-2xl tabular-nums text-[var(--color-primary)]">
            {formatCurrencyBRL(summary?.pendingAmount ?? 0)}
          </strong>
          <span className="text-caption">{summary?.pendingCount ?? 0} atendimento(s)</span>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <span className="text-caption">Já pago no período</span>
          <strong className="mt-1 block text-2xl tabular-nums">
            {formatCurrencyBRL(summary?.paidAmount ?? 0)}
          </strong>
          <span className="text-caption">{summary?.paidCount ?? 0} atendimento(s)</span>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <span className="text-caption">Cancelado (não conta)</span>
          <strong className="mt-1 block text-2xl tabular-nums text-[var(--color-muted-foreground)] line-through">
            {formatCurrencyBRL(summary?.canceledAmount ?? 0)}
          </strong>
          <span className="text-caption">{summary?.canceledCount ?? 0} atendimento(s)</span>
        </div>
      </div>

      {data.loading && !data.data ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nenhum atendimento com comissão neste período/filtro.
        </p>
      ) : (
        <div className="space-y-3">
          {canPay && selection.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
              <span>
                <strong className="tabular-nums">{selection.length}</strong> atendimento(s)
                selecionado(s) ·{" "}
                <strong className="tabular-nums">{formatCurrencyBRL(selectionAmount)}</strong>
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className="btn-secondary h-8" onClick={() => setSelectedIds([])}>
                  Limpar seleção
                </button>
                <button type="button" className="btn-primary h-8" onClick={askPaySelection}>
                  <BadgeCheck className="h-4 w-4" /> Pagar selecionados
                </button>
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-caption">
              <tr className="border-b border-[var(--color-border)]">
                {canPay && (
                  <th className="w-8 py-2 text-left font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      aria-label="Selecionar todos os atendimentos pendentes"
                      checked={allSelected}
                      disabled={payableItems.length === 0}
                      ref={(el) => {
                        if (el) el.indeterminate = selection.length > 0 && !allSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th className="py-2 text-left font-medium">Atendimento</th>
                <th className="py-2 text-left font-medium">Concluído</th>
                <th className="py-2 text-left font-medium">Serviço</th>
                <th className="py-2 text-left font-medium">Função</th>
                <th className="py-2 text-right font-medium">Valor</th>
                <th className="py-2 text-right font-medium">%</th>
                <th className="py-2 text-right font-medium">Comissão</th>
                <th className="py-2 text-right font-medium">Status</th>
                {canPay && <th className="py-2 text-right font-medium">Ação</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.operationId}
                  className={`border-b border-[var(--color-border)]/60 ${item.canceled ? "opacity-60" : ""}`}
                >
                  {canPay && (
                    <td className="py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)] disabled:cursor-not-allowed"
                        aria-label={`Selecionar ${operationLabel(item)}`}
                        checked={selectedIds.includes(item.operationId)}
                        disabled={!isPayable(item)}
                        onChange={() => toggleItem(item.operationId)}
                      />
                    </td>
                  )}
                  <td className="py-2 font-mono text-xs">{operationLabel(item)}</td>
                  <td className="py-2">{item.completedAt ? formatDate(item.completedAt) : "—"}</td>
                  <td className="py-2">{item.typeLabel}</td>
                  <td className="py-2">
                    <StatusChip tone={item.role === "ASSISTANT" ? "info" : "neutral"}>
                      {item.role === "ASSISTANT" ? "Auxiliar" : "Técnico"}
                    </StatusChip>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatCurrencyBRL(item.serviceValue)}</td>
                  <td className="py-2 text-right tabular-nums">{item.percent}%</td>
                  <td
                    className={`py-2 text-right font-semibold tabular-nums ${item.canceled ? "line-through text-[var(--color-muted-foreground)]" : ""}`}
                  >
                    {formatCurrencyBRL(item.commission)}
                  </td>
                  <td className="py-2 text-right">
                    <StatusChip tone={item.canceled ? "danger" : item.paid ? "success" : "warning"} dot>
                      {item.canceled ? "Cancelada" : item.paid ? "Paga" : "Pendente"}
                    </StatusChip>
                  </td>
                  {canPay && (
                    <td className="py-2 text-right">
                      {isPayable(item) ? (
                        <button
                          type="button"
                          className="btn-secondary h-8 px-2 text-xs"
                          onClick={() => askPaySingle(item)}
                        >
                          <BadgeCheck className="h-3.5 w-3.5" /> Pagar
                        </button>
                      ) : (
                        <span className="text-caption">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <details className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4" /> Histórico de pagamentos
          <span className="text-caption">({payments.data?.items.length ?? 0})</span>
        </summary>
        <div className="mt-3 space-y-2">
          {(payments.data?.items ?? []).length === 0 ? (
            <p className="text-caption">Nenhum fechamento registrado ainda.</p>
          ) : (
            (payments.data?.items ?? []).map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <span>
                  {formatDate(payment.periodStart)} — {formatDate(payment.periodEnd)}
                  <span className="text-caption"> · {payment.operationCount} atendimento(s)</span>
                </span>
                <span className="flex items-center gap-3">
                  <strong className="tabular-nums">{formatCurrencyBRL(payment.amount)}</strong>
                  <span className="text-caption">
                    pago em {formatDate(payment.paidAt)}
                    {payment.paidBy ? ` por ${payment.paidBy.name}` : ""}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </details>

      <ConfirmDialog
        open={Boolean(confirmPay)}
        title={
          confirmPay?.mode === "single"
            ? "Pagar a comissão deste atendimento?"
            : confirmPay?.mode === "selection"
              ? "Pagar as comissões selecionadas?"
              : "Registrar comissão do período como paga?"
        }
        description={confirmPay ? confirmText(confirmPay) : undefined}
        confirmLabel={paying ? "Registrando…" : "Confirmar pagamento"}
        onClose={() => setConfirmPay(null)}
        onConfirm={pay}
      />
      {paying && (
        <p className="flex items-center gap-2 text-caption">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processando fechamento…
        </p>
      )}
    </section>
  );
}
