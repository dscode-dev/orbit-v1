"use client";

/**
 * OperationView — renders an Operation through its section model.
 *
 * This is the "Renderers" layer of OperationForm → Sections → Renderers. Each
 * section kind maps to a small renderer; documents reuse the same foundation.
 * Photos are resolved by the caller (base64 loaded from the API) and passed in.
 */
import { CheckCircle2, Circle, FileText, ImageOff } from "lucide-react";
import type { OperationDetail } from "@erp/types";
import { DOCUMENT_KIND_LABEL } from "@erp/types";
import { StatusChip } from "../status-chip";
import { buildOperationSections, type OperationSection } from "./operation-sections";
import { OPERATION_DOC_STATUS } from "./operation-shared";
import { useServiceTypeLabel } from "./use-service-type-label";

export function OperationView({
  operation,
  photoSources = {},
  onOpenDocument,
}: {
  operation: OperationDetail;
  /** Map of photo id → data URL (loaded by the caller from the API). */
  photoSources?: Record<string, string>;
  onOpenDocument?: (documentId: string) => void;
}) {
  const typeLabel = useServiceTypeLabel();
  const sections = buildOperationSections(operation, typeLabel);
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <SectionRenderer key={section.id} section={section} photoSources={photoSources} onOpenDocument={onOpenDocument} />
      ))}
    </div>
  );
}

function SectionRenderer({
  section,
  photoSources,
  onOpenDocument,
}: {
  section: OperationSection;
  photoSources: Record<string, string>;
  onOpenDocument?: (documentId: string) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{section.title}</h3>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        {section.kind === "fields" && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {section.fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] text-[var(--color-muted-foreground)]">{f.label}</dt>
                <dd className="text-sm truncate">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {section.kind === "checklist" && (
          section.items.length === 0 ? (
            <Empty>Sem checklist.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {section.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2">
                  {it.done ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" />
                  )}
                  <span className={`text-sm ${it.done ? "" : "text-[var(--color-muted-foreground)]"}`}>
                    {it.label}
                    {it.note ? <span className="block text-[11px] text-[var(--color-muted-foreground)]">{it.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {section.kind === "text" && (
          section.text.trim() ? <p className="text-sm whitespace-pre-wrap">{section.text}</p> : <Empty>Sem observações.</Empty>
        )}

        {section.kind === "photos" && (
          section.photos.length === 0 ? (
            <Empty>Sem fotos.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {section.photos.map((p) => {
                const src = photoSources[p.id];
                return (
                  <div key={p.id} className="aspect-square rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-muted)] grid place-items-center">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={p.caption ?? "Foto"} className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {section.kind === "signature" && (
          section.captured ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {section.signerName ?? "Signatário não identificado"}
                {section.signerRole ? <span className="text-[var(--color-muted-foreground)] font-normal"> · {section.signerRole}</span> : null}
              </p>
              <p className="text-[var(--color-success)]">
                Assinatura coletada{section.signedAt ? ` em ${new Date(section.signedAt).toLocaleString("pt-BR")}` : ""} e protegida pelo backend.
              </p>
            </div>
          ) : (
            <Empty>Assinatura não coletada.</Empty>
          )
        )}

        {section.kind === "documents" && (
          section.documents.length === 0 ? (
            <Empty>Nenhum documento gerado.</Empty>
          ) : (
            <ul className="space-y-2">
              {section.documents.map((d) => {
                const inner = (
                  <span className="flex items-center gap-3 w-full">
                    <FileText className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{d.number}</span>
                      <span className="block text-[11px] text-[var(--color-muted-foreground)]">{DOCUMENT_KIND_LABEL[d.type]}</span>
                    </span>
                    <StatusChip tone={OPERATION_DOC_STATUS[d.status].tone} dot>{OPERATION_DOC_STATUS[d.status].label}</StatusChip>
                  </span>
                );
                return (
                  <li key={d.id}>
                    {onOpenDocument ? (
                      <button type="button" onClick={() => onOpenDocument(d.id)} className="w-full text-left rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 hover:bg-[var(--color-muted)] transition-colors">
                        {inner}
                      </button>
                    ) : (
                      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--color-muted-foreground)]">{children}</p>;
}
