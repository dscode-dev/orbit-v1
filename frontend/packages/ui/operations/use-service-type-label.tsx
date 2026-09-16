"use client";

/**
 * Resolve a chave do tipo de serviço (Operation.type) para o rótulo definido no
 * catálogo editável. Tipos custom (ex.: "Desinstalação") aparecem com o nome
 * exato cadastrado; os do sistema usam o rótulo padrão; chave desconhecida cai
 * na própria chave. Consome o catálogo uma vez via useQuery.
 */
import { useMemo } from "react";
import { serviceTypesApi, useQuery } from "@erp/api";
import { OPERATION_TYPE_LABEL } from "./operation-shared";

export type ServiceTypeLabelResolver = (key: string | null | undefined) => string;

export function useServiceTypeLabel(): ServiceTypeLabelResolver {
  const query = useQuery((signal) => serviceTypesApi.list({ signal }), []);
  return useMemo(() => {
    const map = new Map((query.data?.items ?? []).map((item) => [item.key, item.label]));
    return (key) => {
      if (!key) return "—";
      return map.get(key) ?? OPERATION_TYPE_LABEL[key] ?? key;
    };
  }, [query.data]);
}
