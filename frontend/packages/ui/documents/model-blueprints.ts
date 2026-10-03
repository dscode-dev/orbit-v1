/**
 * Document model blueprints — definições modernas e profissionais dos modelos
 * de documento (OS, Relatório Técnico, PMOC, Laudo, Orçamento, Recibo).
 * Estes blueprints são metadados de UX para seleção de tipo; a renderização
 * autoritativa vem do Document Engine.
 */
import type { DocumentTemplateType } from "@erp/types";
import { formatCurrencyBRL, formatDate } from "@erp/utils";
import type { DocPaperData, DocPaperSection } from "./document-paper";

export type ModelKey =
  | "OS"
  | "RELATORIO_TECNICO"
  | "PMOC"
  | "LAUDO"
  | "ORCAMENTO"
  | "RECIBO";

export type ModelContext = {
  number: string;
  date: string;
  customer: string;
  equipment?: string;
  operator?: string;
  value?: number;
  statusLabel?: string;
};

export type OrgInfo = { name: string; cnpj?: string; city?: string; email?: string; phone?: string };

type Blueprint = {
  key: ModelKey;
  label: string;
  description: string;
  templateType: DocumentTemplateType;
  build: (ctx: ModelContext, org: OrgInfo) => { sections: DocPaperSection[]; signatures: { name: string; role: string }[] };
};

export const MODEL_BLUEPRINTS: Blueprint[] = [
  {
    key: "OS",
    label: "Ordem de Serviço",
    description: "Registro do serviço executado em campo.",
    templateType: "WORK_ORDER",
    build: (c) => ({
      sections: [
        { title: "Descrição do serviço", kind: "text", text: `Execução de serviço técnico no equipamento ${c.equipment ?? "—"}, conforme solicitação do cliente ${c.customer}.` },
        { title: "Checklist executado", kind: "list", items: ["Inspeção inicial e EPIs", "Limpeza e verificação de componentes", "Medição de parâmetros operacionais", "Teste de funcionamento"] },
        { title: "Materiais utilizados", kind: "table", columns: ["Item", "Qtd", "Valor"], rows: [["Filtro de ar", "2", formatCurrencyBRL(78)], ["Gás R-410A (kg)", "1", formatCurrencyBRL(180)]], total: formatCurrencyBRL(c.value ?? 760) },
        { title: "Observações", kind: "text", text: "Equipamento operando dentro dos parâmetros após o atendimento." },
      ],
      signatures: [{ name: c.operator ?? "Técnico responsável", role: "Técnico responsável" }, { name: c.customer, role: "Cliente" }],
    }),
  },
  {
    key: "RELATORIO_TECNICO",
    label: "Relatório Técnico",
    description: "Registro factual de atendimento, inspeção, atividades, materiais e evidências.",
    templateType: "TECHNICAL_REPORT",
    build: (c) => ({
      sections: [
        { title: "Escopo", kind: "text", text: `Relatório técnico referente ao equipamento ${c.equipment ?? "—"} do cliente ${c.customer}.` },
        { title: "Análise técnica", kind: "text", text: "Avaliação das condições operacionais, identificação de não conformidades e medições realizadas." },
        { title: "Procedimentos realizados", kind: "list", items: ["Diagnóstico de funcionamento", "Medições elétricas e de pressão", "Ajustes e correções aplicadas"] },
        { title: "Conclusão e recomendações", kind: "text", text: "Recomenda-se manutenção preventiva trimestral para preservar a eficiência do sistema." },
      ],
      signatures: [{ name: c.operator ?? "Responsável técnico", role: "Responsável técnico" }],
    }),
  },
  {
    key: "PMOC",
    label: "PMOC",
    description: "Plano de Manutenção, Operação e Controle.",
    templateType: "PMOC",
    build: (c) => ({
      sections: [
        { title: "Dados do PMOC", kind: "fields", fields: [{ label: "Cliente", value: c.customer }, { label: "Sistema", value: c.equipment ?? "—" }, { label: "Responsável", value: c.operator ?? "—" }, { label: "Emissão", value: formatDate(c.date) }] },
        { title: "Plano de manutenção", kind: "table", columns: ["Atividade", "Periodicidade", "Responsável"], rows: [["Limpeza de filtros", "Mensal", "Operador"], ["Verificação de gás", "Trimestral", "Técnico"], ["Inspeção elétrica", "Semestral", "Técnico"]] },
        { title: "Parâmetros monitorados", kind: "list", items: ["Temperatura de insuflamento", "Pressão de operação", "Consumo elétrico"] },
      ],
      signatures: [{ name: c.operator ?? "Responsável técnico", role: "Responsável técnico (ART)" }, { name: c.customer, role: "Responsável pelo estabelecimento" }],
    }),
  },
  {
    key: "LAUDO",
    label: "Laudo Técnico",
    description: "Avaliação técnica analítica baseada nos registros e evidências disponíveis.",
    templateType: "TECHNICAL_OPINION",
    build: (c) => ({
      sections: [
        { title: "Objeto do laudo", kind: "text", text: `Avaliação técnica do equipamento ${c.equipment ?? "—"} do cliente ${c.customer}.` },
        { title: "Metodologia", kind: "text", text: "Inspeção visual, medições instrumentadas e análise de funcionamento conforme normas aplicáveis." },
        { title: "Constatações", kind: "list", items: ["Estado geral de conservação", "Conformidades e não conformidades", "Riscos identificados"] },
        { title: "Parecer técnico", kind: "text", text: "Conclusão objetiva sobre a condição do equipamento e providências recomendadas." },
      ],
      signatures: [{ name: c.operator ?? "Responsável técnico", role: "Responsável técnico" }],
    }),
  },
  {
    key: "ORCAMENTO",
    label: "Orçamento",
    description: "Proposta comercial para aprovação do cliente.",
    templateType: "QUOTE",
    build: (c, org) => ({
      sections: [
        { title: "Itens do orçamento", kind: "table", columns: ["Descrição", "Qtd", "Valor"], rows: [["Mão de obra técnica", "1", formatCurrencyBRL((c.value ?? 2400) * 0.6)], ["Materiais e peças", "1", formatCurrencyBRL((c.value ?? 2400) * 0.4)]], total: formatCurrencyBRL(c.value ?? 2400) },
        { title: "Condições comerciais", kind: "list", items: ["Pagamento: 50% na aprovação, 50% na entrega", "Garantia de 90 dias sobre o serviço", "Prazo de execução: a combinar"] },
        { title: "Validade", kind: "fields", fields: [{ label: "Validade da proposta", value: "7 dias" }, { label: "Emissão", value: formatDate(c.date) }] },
      ],
      signatures: [{ name: "Responsável comercial", role: org.name }],
    }),
  },
  {
    key: "RECIBO",
    label: "Recibo",
    description: "Comprovante de pagamento do serviço.",
    templateType: "RECEIPT",
    build: (c, org) => ({
      sections: [
        { title: "Recebemos de", kind: "fields", fields: [{ label: "Cliente", value: c.customer }, { label: "Data", value: formatDate(c.date) }] },
        { title: "Referente a", kind: "text", text: `Pagamento referente ao serviço técnico no equipamento ${c.equipment ?? "—"}.` },
        { title: "Valor", kind: "fields", fields: [{ label: "Valor recebido", value: formatCurrencyBRL(c.value ?? 2750) }, { label: "Forma de pagamento", value: "PIX / Transferência" }] },
      ],
      signatures: [{ name: org.name, role: "Recebedor" }],
    }),
  },
];

export function blueprintByType(type: DocumentTemplateType): Blueprint {
  return MODEL_BLUEPRINTS.find((b) => b.templateType === type) ?? MODEL_BLUEPRINTS[0];
}

export function buildDocument(blueprint: Blueprint, ctx: ModelContext, org: OrgInfo): DocPaperData {
  const { sections, signatures } = blueprint.build(ctx, org);
  return {
    kindLabel: blueprint.label,
    number: ctx.number,
    statusLabel: ctx.statusLabel,
    org,
    meta: [
      { label: "Cliente", value: ctx.customer },
      { label: "Equipamento", value: ctx.equipment ?? "—" },
      { label: "Operador", value: ctx.operator ?? "—" },
      { label: "Data", value: formatDate(ctx.date) },
    ],
    sections,
    signatures,
  };
}
