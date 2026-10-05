/**
 * Consulta de CNPJ (BrasilAPI → dados públicos da Receita Federal).
 * Fronteira externa isolada, como a de CEP: só sugere dados para o formulário,
 * nunca é a fonte oficial do cadastro.
 */
import { cnpjDigits, isValidCnpj } from "@erp/utils";

export type CnpjLookupResult = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  secondaryPhone: string;
  /** Situação cadastral na Receita (ATIVA, BAIXADA, INAPTA, SUSPENSA…). */
  status: string;
  activity: string;
  address: {
    zipCode: string;
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
  };
  provider: "brasilapi";
};

type BrasilApiCnpj = {
  cnpj?: string;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  email?: string | null;
  ddd_telefone_1?: string | null;
  ddd_telefone_2?: string | null;
  descricao_situacao_cadastral?: string | null;
  cnae_fiscal_descricao?: string | null;
  cep?: string | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

/** "6134939002" → "(61) 3493-9002"; "11987654321" → "(11) 98765-4321". */
function formatPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

/** Junta o tipo ao logradouro, sem repetir quando ele já vem no nome. */
function streetOf(type: string, street: string): string {
  const name = street.trim();
  const kind = type.trim();
  if (!kind || !name || name.toUpperCase().includes(kind.toUpperCase())) return name;
  return `${kind} ${name}`;
}

export async function lookupCnpj(cnpj: string, opts?: { signal?: AbortSignal }): Promise<CnpjLookupResult> {
  const digits = cnpjDigits(cnpj);
  if (!isValidCnpj(digits)) throw new Error("CNPJ inválido. Confira os números digitados.");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  const externalSignal = opts?.signal;
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error("CNPJ não encontrado na Receita Federal.");
    if (response.status === 400) throw new Error("CNPJ inválido. Confira os números digitados.");
    if (!response.ok) throw new Error("Não foi possível consultar o CNPJ agora. Preencha os dados manualmente.");

    const data = (await response.json()) as BrasilApiCnpj;
    const number = (data.numero ?? "").trim();
    return {
      cnpj: digits,
      legalName: (data.razao_social ?? "").trim(),
      tradeName: (data.nome_fantasia ?? "").trim(),
      email: (data.email ?? "").trim().toLowerCase(),
      phone: formatPhone(data.ddd_telefone_1),
      secondaryPhone: formatPhone(data.ddd_telefone_2),
      status: (data.descricao_situacao_cadastral ?? "").trim(),
      activity: (data.cnae_fiscal_descricao ?? "").trim(),
      address: {
        zipCode: (data.cep ?? "").replace(/\D/g, "").replace(/^(\d{5})(\d{3})$/, "$1-$2"),
        street: streetOf(data.descricao_tipo_de_logradouro ?? "", data.logradouro ?? ""),
        number: /^S\/?N$/i.test(number) ? "S/N" : number,
        complement: (data.complemento ?? "").trim(),
        district: (data.bairro ?? "").trim(),
        city: (data.municipio ?? "").trim(),
        state: (data.uf ?? "").trim().toUpperCase(),
      },
      provider: "brasilapi",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("A consulta do CNPJ demorou demais. Tente novamente ou preencha manualmente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
