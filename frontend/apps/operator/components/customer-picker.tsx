"use client";

/**
 * Seletor de cliente para o app do operador. As listagens (Equipamentos,
 * Documentos) são sempre por cliente; este picker define o cliente em foco.
 * A escolha busca no servidor, então a carteira inteira é alcançável.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { customersApi, type Customer } from "@erp/api";
import { EntityCombobox, type ComboboxQuery } from "@erp/ui/entity-combobox";
import type { SelectedCustomer } from "@operator/lib/selected-customer";

export function CustomerPicker({
  selected,
  onSelect,
}: {
  selected: SelectedCustomer | null;
  onSelect: (c: SelectedCustomer | null) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const params = useSearchParams();
  const presetId = params.get("customerId");
  const presetApplied = useRef(false);
  const searchCustomers = useCallback(async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
    const result = await customersApi.listCustomers({ search: search || undefined, page, limit: 50, signal });
    return {
      options: result.items.map((item) => ({ value: item.id, label: item.name })),
      total: result.pagination?.total,
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    // Primeira página só para resolver o `?customerId=`; a escolha usa busca
    // no servidor, senão clientes além dos 100 primeiros ficavam invisíveis
    // para o técnico em campo.
    customersApi
      .listCustomers({ page: 1, limit: 20, signal: ac.signal })
      .then((res) => setCustomers(res.items))
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  // Apply `?customerId=` once, when nothing is selected yet.
  useEffect(() => {
    if (presetApplied.current || selected || !presetId || customers.length === 0) return;
    const match = customers.find((c) => c.id === presetId);
    if (match) {
      presetApplied.current = true;
      onSelect({ id: match.id, name: match.name });
    }
  }, [presetId, customers, selected, onSelect]);

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 h-11">
      <Building2 className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0" />
      <div className="flex-1">
        <EntityCombobox
          value={selected?.id ?? ""}
          onChange={(id, option) => onSelect(id ? { id, name: option?.label ?? "" } : null)}
          fetchOptions={searchCustomers}
          selectedOption={selected ? { value: selected.id, label: selected.name } : null}
          placeholder="Selecione um cliente…"
          emptyMessage="Nenhum cliente encontrado."
          clearLabel="Limpar seleção"
        />
      </div>
    </div>
  );
}
