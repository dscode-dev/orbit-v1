import type {
  CommissionDetail,
  CommissionPaymentRecord,
  OperationStatus,
  OperatorExecutionDetail,
  OperatorExecutionOperations,
  OperatorExecutionsOverview,
} from '@erp/types';
import { api } from './client';

export function list(params?: {
  month?: string;
  page?: number;
  limit?: number;
  search?: string;
  signal?: AbortSignal;
}): Promise<OperatorExecutionsOverview> {
  const { signal, ...query } = params ?? {};
  return api.get<OperatorExecutionsOverview>('/operator-executions', { query, signal });
}

export function get(
  operatorId: string,
  params?: { month?: string; signal?: AbortSignal },
): Promise<OperatorExecutionDetail> {
  const { signal, ...query } = params ?? {};
  return api.get<OperatorExecutionDetail>(`/operator-executions/${operatorId}`, { query, signal });
}

export function operations(
  operatorId: string,
  params?: {
    month?: string;
    page?: number;
    limit?: number;
    status?: OperationStatus;
    view?: 'HISTORY' | 'AGENDA';
    signal?: AbortSignal;
  },
): Promise<OperatorExecutionOperations> {
  const { signal, ...query } = params ?? {};
  return api.get<OperatorExecutionOperations>(`/operator-executions/${operatorId}/operations`, {
    query,
    signal,
  });
}

/** Apuração de comissão do técnico (pendente x pago) no intervalo. */
export function commission(
  operatorId: string,
  params?: { from?: string; to?: string; serviceType?: string; signal?: AbortSignal },
): Promise<CommissionDetail> {
  const { signal, ...query } = params ?? {};
  return api.get<CommissionDetail>(`/operator-executions/${operatorId}/commission`, {
    query,
    signal,
  });
}

/** Histórico de fechamentos já pagos (auditoria). */
export function commissionPayments(
  operatorId: string,
  params?: { signal?: AbortSignal },
): Promise<{ items: CommissionPaymentRecord[] }> {
  return api.get<{ items: CommissionPaymentRecord[] }>(
    `/operator-executions/${operatorId}/commission/payments`,
    params,
  );
}

/** Registra o pagamento da comissão pendente do período (OWNER). */
export function payCommission(
  operatorId: string,
  /** Sem `operationIds`, fecha todos os pendentes do período/filtro. */
  payload: {
    from?: string;
    to?: string;
    serviceType?: string;
    notes?: string;
    operationIds?: string[];
  },
): Promise<{ id: string; amount: number; operationCount: number; paidAt: string }> {
  return api.post(`/operator-executions/${operatorId}/commission/pay`, payload);
}
