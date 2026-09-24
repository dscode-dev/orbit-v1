"use client";

/**
 * Comissões do técnico: apuração por intervalo e tipo de serviço, fechamento
 * ("marcar como paga") e histórico de pagamentos para auditoria.
 *
 * O que já foi pago fica vinculado a um fechamento e sai do valor pendente —
 * por isso comissões quitadas (inclusive as pagas manualmente antes da feature,
 * fechando o período retroativo) nunca são recalculadas.
 */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, HandCoins, History, Loader2 } from "lucide-react";
import {
  operatorExecutionsApi,
  serviceTypesApi,
  useQuery,
  errorMessage,
  type CommissionDetail,
} from "@erp/api";
import { Gate } from "@erp/ui/auth/gate";
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

export function TechnicianCommissionPanel({ operatorId }: { operatorId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmPay, setConfirmPay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      const result = await operatorExecutionsApi.payCommission(operatorId, {
        from: from || undefined,
        to: to || undefined,
        serviceType: serviceType || undefined,
      });
      setNotice(
        `Comissão de ${formatCurrencyBRL(result.amount)} registrada como paga (${result.operationCount} atendimento(s)).`,
      );
      setConfirmPay(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(errorMessage(e));
      setConfirmPay(false);
    } finally {
      setPaying(false);
    }
  };

  return (
    <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HandCoins className="h-5 w-5 text-[var(--color-primary)]" /> Comissões
          </h2>
          <p className="text-caption">
            Apuração {periodLabel} · o valor pendente considera apenas atendimentos ainda não pagos.
          </p>
        </div>
        <Gate roles={["OWNER"]}>
          <button
            type="button"
            className="btn-primary h-9"
            disabled={!summary || summary.pendingCount === 0}
            onClick={() => setConfirmPay(true)}
          >
            <BadgeCheck className="h-4 w-4" /> Marcar como paga
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

      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      {data.loading && !data.data ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nenhum atendimento com comissão neste período/filtro.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-caption">
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 text-left font-medium">Atendimento</th>
                <th className="py-2 text-left font-medium">Concluído</th>
                <th className="py-2 text-left font-medium">Serviço</th>
                <th className="py-2 text-right font-medium">Valor</th>
                <th className="py-2 text-right font-medium">%</th>
                <th className="py-2 text-right font-medium">Comissão</th>
                <th className="py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.operationId} className="border-b border-[var(--color-border)]/60">
                  <td className="py-2 font-mono text-xs">OP-{String(item.number).padStart(6, "0")}</td>
                  <td className="py-2">{item.completedAt ? formatDate(item.completedAt) : "—"}</td>
                  <td className="py-2">{item.typeLabel}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrencyBRL(item.serviceValue)}</td>
                  <td className="py-2 text-right tabular-nums">{item.percent}%</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatCurrencyBRL(item.commission)}
                  </td>
                  <td className="py-2 text-right">
                    <StatusChip tone={item.paid ? "success" : "warning"} dot>
                      {item.paid ? "Paga" : "Pendente"}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        open={confirmPay}
        title="Registrar comissão como paga?"
        description={`Serão marcados como pagos ${summary?.pendingCount ?? 0} atendimento(s), totalizando ${formatCurrencyBRL(summary?.pendingAmount ?? 0)}. O valor sai do pendente e fica registrado no histórico para auditoria.`}
        confirmLabel={paying ? "Registrando…" : "Confirmar pagamento"}
        onClose={() => setConfirmPay(false)}
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
