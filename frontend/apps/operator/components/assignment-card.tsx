import { operationServiceAddressLabel } from "@erp/ui/operations/operation-shared";
import Link from "next/link";
import { ChevronRight, Clock, MapPin, Wrench } from "lucide-react";
import type { Assignment } from "@erp/types";
import { StatusPill } from "@erp/ui/status-pill";
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_PILL,
  assignmentPrimaryAction,
  assignmentTime,
} from "@erp/ui/assignments/assignment-shared";

/**
 * Card de atendimento. Por padrão exibe o cartão completo (usado na fila/página
 * de atendimentos). Com `compact`, exibe uma versão enxuta para o Dashboard —
 * sem endereço, data nem prioridade — apenas acesso rápido às informações.
 */
export function AssignmentCard({ assignment, compact = false }: { assignment: Assignment; compact?: boolean }) {
  const op = assignment.operation;
  const pmoc = op.maintenanceExecution?.plan.pmocPlan;
  const execution = op.maintenanceExecution?.pmocExecutionRequest;
  const address = op.address
    ? `${op.address.street}, ${op.address.number} · ${op.address.city}/${op.address.state}`
    : "Endereço não informado";
  return (
    <Link
      href={`/operator/services/${assignment.id}`}
      className={`block rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-card)] active:scale-[0.99] transition-transform ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            OP-{String(op.number).padStart(6, "0")}
          </div>
          {pmoc && (
            <div className="mt-1 text-[11px] font-semibold text-[var(--color-primary)]">
              PMOC-{String(pmoc.number).padStart(6, "0")} · Execução {String(execution?.executionNumber ?? 0).padStart(3, "0")}
            </div>
          )}
          <h3 className={`mt-1 font-semibold leading-tight truncate ${compact ? "text-sm" : "text-base"}`}>
            {op.customer?.name ?? "Cliente não informado"}
          </h3>
          <p className={`mt-1 text-[var(--color-muted-foreground)] truncate ${compact ? "text-xs" : "text-sm"}`}>
            {op.equipment?.name ?? "Sem equipamento vinculado"}
          </p>
        </div>
        <StatusPill status={ASSIGNMENT_STATUS_PILL[assignment.status]} label={ASSIGNMENT_STATUS_LABEL[assignment.status]} />
      </div>
      {op.secondaryServiceType && (
        <div className="mt-2 space-y-1 text-xs text-[var(--color-muted-foreground)]">
          <p className="font-medium text-[var(--color-primary)]">2 serviços nesta OS</p>
          {!compact && <p><strong>Endereço secundário:</strong> {operationServiceAddressLabel(op.secondaryAddress)}</p>}
        </div>
      )}
      {!compact && (
        <>
          <div className="mt-3 grid gap-2 text-sm text-[var(--color-muted-foreground)]">
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4" /> {op.scheduledFor ? assignmentTime(op.scheduledFor) : "Não agendado"}
            </span>
            <span className="inline-flex items-center gap-2 truncate">
              <MapPin className="h-4 w-4 shrink-0" /> {address}
            </span>
            <span className="inline-flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Prioridade operacional padrão
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[var(--radius-lg)] bg-[var(--color-muted)] px-3 py-2 text-sm font-semibold">
            {assignmentPrimaryAction(assignment.status)}
            <ChevronRight className="h-4 w-4" />
          </div>
        </>
      )}
    </Link>
  );
}
