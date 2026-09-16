/**
 * Operation sections — the reusable foundation shared by every document.
 *
 * Instead of one bespoke form per document (OsForm, PmocForm, LaudoForm…), an
 * Operation is described as an ordered list of typed sections. Renderers
 * (operation-view.tsx) turn each section into UI; a future PDF generator can
 * consume the very same section model. New document types reuse this without a
 * refactor.
 */
import type {
  OperationChecklistItem,
  OperationDetail,
  OperationDocument,
  OperationPhoto,
} from "@erp/types";
import { OPERATION_STATUS, OPERATION_TYPE_LABEL, operationCode } from "./operation-shared";

export type OperationSectionField = { label: string; value: string };

export type OperationSection =
  | { kind: "fields"; id: string; title: string; fields: OperationSectionField[] }
  | { kind: "checklist"; id: string; title: string; items: OperationChecklistItem[] }
  | { kind: "text"; id: string; title: string; text: string }
  | { kind: "photos"; id: string; title: string; photos: OperationPhoto[] }
  | { kind: "signature"; id: string; title: string; captured: boolean; signedAt: string | null; signerName: string | null; signerRole: string | null }
  | { kind: "documents"; id: string; title: string; documents: OperationDocument[] };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function addressLabel(op: OperationDetail): string {
  const a = op.address;
  if (!a) return "—";
  return [a.street, a.number, a.district, a.city].filter(Boolean).join(", ") || a.name || "Endereço";
}

/** Build the full ordered section list for an operation. */
export function buildOperationSections(
  op: OperationDetail,
  resolveTypeLabel?: (key: string) => string,
): OperationSection[] {
  const typeLabel = resolveTypeLabel ? resolveTypeLabel(op.type) : OPERATION_TYPE_LABEL[op.type];
  return [
    {
      kind: "fields",
      id: "identificacao",
      title: "Identificação",
      fields: [
        { label: "Operação", value: operationCode(op.number) },
        { label: "Cliente", value: op.customer?.name ?? "—" },
        { label: "Endereço", value: addressLabel(op) },
        { label: "Equipamento", value: op.equipment?.name ?? "Sem equipamento" },
        { label: "Operador", value: op.operator?.name ?? "—" },
        { label: "Tipo", value: typeLabel },
        { label: "Status", value: OPERATION_STATUS[op.status].label },
        { label: "Início", value: fmtDate(op.startedAt) },
        { label: "Conclusão", value: fmtDate(op.completedAt) },
        // Quem assinou pelo cliente — vai também para o relatório final.
        ...(op.signatureCaptured
          ? [{
              label: "Assinado por",
              value: `${op.customerSignerName ?? "Não identificado"}${op.customerSignerRole ? ` (${op.customerSignerRole})` : ""}`,
            }]
          : []),
      ],
    },
    { kind: "checklist", id: "checklist", title: "Checklist", items: op.checklist },
    { kind: "text", id: "observacoes", title: "Observações", text: op.observations ?? "" },
    { kind: "photos", id: "fotos", title: "Fotos", photos: op.photos },
    { kind: "signature", id: "assinatura", title: "Assinatura do cliente", captured: Boolean(op.signatureCaptured), signedAt: op.signedAt, signerName: op.customerSignerName, signerRole: op.customerSignerRole },
    { kind: "documents", id: "documentos", title: "Documentos relacionados", documents: op.documents },
  ];
}
