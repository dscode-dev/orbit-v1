/**
 * Service types — classificação operacional do atendimento (OperationType).
 *
 * Apenas rótulos/descrições dos tipos de serviço. Os checks de atendimento NÃO
 * ficam aqui: vêm de Catálogos Técnicos (type CHECKLIST) por workflow do
 * documento, carregados em tempo real (ver `technicalCatalogsApi.listChecklistItems`).
 */
// Antes um conjunto fixo; agora é a chave de um item do catálogo editável de
// tipos de serviço (pode ser um tipo custom criado pelo owner).
export type ServiceTypeKey = string;

export type ServiceTypeConfig = {
  key: ServiceTypeKey;
  label: string;
  description: string;
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    key: "PREVENTIVA",
    label: "Manutenção Preventiva",
    description: "Limpeza, inspeção e verificação periódica.",
  },
  {
    key: "CORRETIVA",
    label: "Manutenção Corretiva",
    description: "Diagnóstico e reparo de falha.",
  },
  {
    key: "INSTALACAO",
    label: "Instalação",
    description: "Instalação de novo equipamento.",
  },
  {
    key: "PROJETO",
    label: "Projeto / Visita Técnica",
    description: "Levantamento técnico em campo.",
  },
];

// Aceita qualquer chave (tipos custom do catálogo) — cai no próprio valor quando
// não é um dos tipos do sistema conhecidos.
export function serviceTypeLabel(key: string): string {
  return SERVICE_TYPES.find((t) => t.key === key)?.label ?? key;
}
