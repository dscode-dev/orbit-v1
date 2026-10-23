"use client";

/**
 * Agenda de campo (Operator) — calendário mensal real, inspirado na Agenda da
 * Platform e adaptado ao mobile: grade do mês com marcadores por dia + lista
 * cronológica do dia selecionado. Não repete o layout da lista de atendimentos.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronRight as Arrow, Clock } from "lucide-react";
import { StatusPill } from "@erp/ui/status-pill";
import { ErrorState } from "@erp/ui/states";
import { useQuery, type Assignment, type AssignmentStatus, type Role } from "@erp/api";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { loadOperatorAgenda } from "@operator/lib/agenda";
import { ASSIGNMENT_STATUS_LABEL, ASSIGNMENT_STATUS_PILL } from "@erp/ui/assignments/assignment-shared";

const STATE_COLOR: Record<AssignmentStatus, string> = {
  ASSIGNED: "var(--color-info)",
  ACCEPTED: "var(--color-success)",
  STARTED: "var(--color-primary)",
  PAUSED: "var(--color-warning)",
  COMPLETED: "var(--color-success)",
  CANCELED: "var(--color-danger)",
  REJECTED: "var(--color-danger)",
};

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
/** Monday-based index 0..6. */
function mondayIndex(d: Date) { return (d.getDay() + 6) % 7; }
function dayKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function sameDay(a: Date, b: Date) { return dayKey(a) === dayKey(b); }

export default function OperatorAgendaPage() {
  const { role, session } = useAuth();
  return <AgendaCalendar key={`${session?.user.id}:${role}`} role={role} />;
}

function AgendaCalendar({ role }: { role: Role | null }) {
  const isOwner = role === "OWNER";
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(() => new Date());

  const assignments = useQuery((signal) => loadOperatorAgenda(role, signal), [role]);

  // 6-week grid (Monday-first) covering the visible month.
  const gridStart = useMemo(() => {
    const first = startOfMonth(cursor);
    const s = new Date(first);
    s.setDate(first.getDate() - mondayIndex(first));
    s.setHours(0, 0, 0, 0);
    return s;
  }, [cursor]);
  const cells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    }),
    [gridStart],
  );

  const scheduled = useMemo(
    () => (assignments.data ?? []).filter((item) => Boolean(item.operation.scheduledFor)),
    [assignments.data],
  );
  const unscheduled = useMemo(
    () => (assignments.data ?? []).filter(
      (item) => !item.operation.scheduledFor && !["COMPLETED", "CANCELED", "REJECTED"].includes(item.status),
    ),
    [assignments.data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const item of scheduled) {
      const d = new Date(item.operation.scheduledFor as string);
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.operation.scheduledFor ?? "").localeCompare(b.operation.scheduledFor ?? ""));
    }
    return map;
  }, [scheduled]);

  const selectedItems = byDay.get(dayKey(selected)) ?? [];
  const monthCount = cells.filter((d) => d.getMonth() === cursor.getMonth()).reduce((acc, d) => acc + (byDay.get(dayKey(d))?.length ?? 0), 0);

  function shift(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }
  function goToday() {
    setCursor(startOfMonth(new Date()));
    setSelected(new Date());
  }
  function pick(date: Date) {
    setSelected(date);
    if (date.getMonth() !== cursor.getMonth()) setCursor(startOfMonth(date));
  }

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Agenda</h1>
          {isOwner && <p className="text-caption">Todos os técnicos</p>}
          <p className="text-caption">{monthCount} atendimento(s) em {MONTHS[cursor.getMonth()].toLowerCase()}.</p>
        </div>
        <button type="button" onClick={goToday} className="h-9 shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium active:scale-[0.97]">
          Hoje
        </button>
      </header>

      {/* Calendário do mês */}
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="flex items-center justify-between px-2 py-2 border-b border-[var(--color-border)]">
          <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" className="h-9 w-9 grid place-items-center rounded-[var(--radius-md)] active:bg-[var(--color-muted)]">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
          <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" className="h-9 w-9 grid place-items-center rounded-[var(--radius-md)] active:bg-[var(--color-muted)]">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-muted)]/40">
          {WEEKDAYS.map((w, i) => (
            <div key={`${w}-${i}`} className="py-1.5 text-center text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] font-medium">{w}</div>
          ))}
        </div>

        <div key={`${cursor.getFullYear()}-${cursor.getMonth()}`} className="grid grid-cols-7 animate-fade-in">
          {cells.map((date) => {
            const inMonth = date.getMonth() === cursor.getMonth();
            const isToday = sameDay(date, today);
            const isSelected = sameDay(date, selected);
            const items = byDay.get(dayKey(date)) ?? [];
            return (
              <button
                key={dayKey(date)}
                type="button"
                onClick={() => pick(date)}
                aria-label={date.toLocaleDateString("pt-BR")}
                className={`relative h-12 flex flex-col items-center justify-center gap-0.5 transition-colors ${isSelected ? "bg-[var(--color-primary)]/10" : "active:bg-[var(--color-muted)]"}`}
              >
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full text-[13px] tabular-nums ${
                    isToday
                      ? "bg-[var(--color-primary)] font-semibold text-white"
                      : isSelected
                        ? "font-semibold text-[var(--color-primary)]"
                        : inMonth
                          ? "text-[var(--color-foreground)]"
                          : "text-[var(--color-muted-foreground)]/50"
                  }`}
                >
                  {date.getDate()}
                </span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {items.slice(0, 3).map((item) => (
                    <span key={item.id} className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_COLOR[item.status] }} />
                  ))}
                  {items.length > 3 && <span className="text-[8px] leading-none text-[var(--color-muted-foreground)]">+</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Dia selecionado */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-[var(--color-muted-foreground)] capitalize">
          {selected.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
        </h2>

        {assignments.loading && !assignments.data ? (
          <div className="space-y-2">
            <div className="skeleton h-16 rounded-[var(--radius-lg)]" />
            <div className="skeleton h-16 rounded-[var(--radius-lg)]" />
          </div>
        ) : assignments.error && !assignments.data ? (
          <ErrorState error={assignments.error} onRetry={assignments.refetch} />
        ) : selectedItems.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-5 text-center">
            <CalendarIcon className="mx-auto h-5 w-5 text-[var(--color-muted-foreground)]" />
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">Sem atividades neste dia.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {selectedItems.map((item) => <AgendaRow key={item.id} assignment={item} showAssignee={isOwner} />)}
          </ul>
        )}
      </section>

      {/* Sem data definida */}
      {unscheduled.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Sem data definida ({unscheduled.length})</h2>
          <ul className="space-y-2">
            {(isOwner ? unscheduled : unscheduled.slice(0, 5)).map((item) => <AgendaRow key={item.id} assignment={item} showAssignee={isOwner} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Linha de agenda: horário + cliente/equipamento + status. */
function AgendaRow({ assignment, showAssignee = false }: { assignment: Assignment; showAssignee?: boolean }) {
  const op = assignment.operation;
  const time = op.scheduledFor
    ? new Date(op.scheduledFor).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <li>
      <Link
        href={`/operator/services/${assignment.id}`}
        className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 active:scale-[0.99] transition-transform"
        style={{ boxShadow: `inset 3px 0 0 0 ${STATE_COLOR[assignment.status]}` }}
      >
        <span className="flex w-12 shrink-0 flex-col items-center text-[var(--color-muted-foreground)]">
          <Clock className="h-3.5 w-3.5" />
          <span className="mt-0.5 font-mono text-xs tabular-nums">{time ?? "—"}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{op.customer?.name ?? `OP-${String(op.number).padStart(6, "0")}`}</span>
          <span className="block text-caption truncate">{op.equipment?.name ?? "Sem equipamento"} · OP-{String(op.number).padStart(6, "0")}</span>
          {showAssignee && <span className="block text-caption truncate">Técnico: {assignment.assignee.name}</span>}
        </span>
        <StatusPill status={ASSIGNMENT_STATUS_PILL[assignment.status]} label={ASSIGNMENT_STATUS_LABEL[assignment.status]} />
        <Arrow className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
      </Link>
    </li>
  );
}
