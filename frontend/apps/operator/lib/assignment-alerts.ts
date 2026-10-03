"use client";

/**
 * Alertas de novos atendimentos para o operador.
 *
 * O shell do app consulta as atribuições do operador em intervalo curto (e ao
 * voltar o foco para o app) e, quando surge um atendimento ainda não visto com
 * status ASSIGNED, dispara uma notificação local do dispositivo (Notification
 * API / service worker do PWA). Push real com o app fechado (Web Push + VAPID)
 * fica para uma etapa futura — este primeiro momento cobre o app aberto ou em
 * segundo plano.
 */
import { useCallback, useEffect, useRef } from "react";
import { assignmentsApi, type Assignment } from "@erp/api";

const SEEN_KEY = "operator.assignments.notified";
const POLL_MS = 30_000;

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  // Mantém a lista limitada para não crescer indefinidamente.
  window.localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-300)));
}

function operationLabel(assignment: Assignment): string {
  const op = assignment.operation;
  return `${op.customer?.name ?? "Cliente"} · OP-${String(op.number).padStart(6, "0")}`;
}

async function showNotification(fresh: Assignment[]): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const title = fresh.length === 1 ? "Novo atendimento atribuído" : `${fresh.length} novos atendimentos atribuídos`;
  const body = fresh.slice(0, 3).map(operationLabel).join("\n");
  const options: NotificationOptions = {
    body,
    tag: "assignment-assigned",
    icon: "/icons/icon-192.png",
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // Sem service worker — cai para a Notification direta abaixo.
  }
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = "/operator/services";
    };
  } catch {
    // Notificação bloqueada — a atualização automática da lista já cobre.
  }
}

/**
 * Monta o ciclo de alertas. Deve ser chamado uma única vez (OperatorShell) para
 * valer em qualquer aba do app.
 */
export function useAssignmentAlerts(onNewAssignments?: () => void): void {
  const seenRef = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNewAssignments);
  onNewRef.current = onNewAssignments;

  const check = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const { items } = await assignmentsApi.listMyAssignments({ limit: 50 });
      if (seenRef.current === null) {
        const stored = readSeen();
        if (stored.size === 0) {
          // Primeira execução neste dispositivo: registra o estado atual sem
          // notificar o histórico.
          const baseline = new Set(items.map((item) => item.id));
          writeSeen(baseline);
          seenRef.current = baseline;
          return;
        }
        seenRef.current = stored;
      }
      const seen = seenRef.current;
      const fresh = items.filter((item) => item.status === "ASSIGNED" && !seen.has(item.id));
      items.forEach((item) => seen.add(item.id));
      writeSeen(seen);
      if (fresh.length > 0) {
        await showNotification(fresh);
        onNewRef.current?.();
      }
    } catch {
      // Falha de rede silenciosa — próxima rodada tenta de novo.
    }
  }, []);

  useEffect(() => {
    // Pede a permissão de notificação uma única vez (se ainda não decidida).
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
    void check();
    const interval = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [check]);
}
