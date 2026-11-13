"use client";

import { useEffect, useMemo } from "react";
import { usersApi, useQuery } from "@erp/api";
import { MultiSelect } from "@erp/ui/multi-select";

/** Unavailable directory entries must not survive as invisible selected IDs. */
export function AuxiliaryOperatorSelect({ value, onChange, excludeId }: {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeId?: string;
}) {
  const users = useQuery((signal) => usersApi.listAllOperationalUsers({ signal }), [], { refetchOnFocus: true });
  const operators = useMemo(() => (users.data ?? []).filter((user) => user.id !== excludeId), [users.data, excludeId]);
  const eligibleIds = useMemo(() => new Set(operators.map((user) => user.id)), [operators]);

  useEffect(() => {
    // Never infer removal from an incomplete/failed directory request.
    if (!users.data) return;
    const selected = value.filter((id) => eligibleIds.has(id));
    if (selected.length !== value.length) onChange(selected);
  }, [users.data, value, eligibleIds, onChange]);

  return (
    <div className="space-y-1.5">
      <MultiSelect
        label="Auxiliar Técnico (opcional)"
        value={users.data ? value.filter((id) => eligibleIds.has(id)) : value.filter((id) => id !== excludeId)}
        onChange={onChange}
        options={operators.map((user) => ({
          value: user.id, label: user.name,
          description: `${user.role}${user.permission?.canReports ? "" : " · somente visualização"}`,
        }))}
        placeholder="Selecionar auxiliar técnico"
        emptyMessage={users.loading ? "Carregando técnicos…" : users.error ? "Não foi possível carregar os técnicos." : "Nenhum outro técnico disponível."}
      />
      <span className="text-caption">
        Recebem e visualizam a mesma demanda. Sem permissão de Relatórios, ficam somente em
        visualização (não iniciam nem editam o atendimento).
      </span>
    </div>
  );
}
