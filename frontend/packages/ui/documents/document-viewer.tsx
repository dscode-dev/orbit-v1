'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { documentsApi, ApiClientError } from '@erp/api';
import type {
  DocumentBlueprint,
  DocumentComponent,
  DocumentDownloadResult,
  DocumentKind,
  DocumentRenderResult,
} from '@erp/types';
import { DOCUMENT_KIND_LABEL } from '@erp/types';
import { formatBytes } from '@erp/utils';

type Source =
  | { documentId: string; operationId?: string; type?: DocumentKind }
  | { operationId: string; type: DocumentKind; documentId?: string | null }
  | { templateId: string; documentId?: string | null; operationId?: string; type?: DocumentKind };

export function DocumentViewer({
  source,
  title,
  canRender = true,
  canDownload = true,
  artifact,
  onRendered,
}: {
  source: Source;
  title?: string;
  canRender?: boolean;
  canDownload?: boolean;
  artifact?: {
    renderedAt: string | null;
    fileSize: number | null;
    revision?: number;
    renderMetadata?: Record<string, unknown> | null;
  } | null;
  onRendered?: (document: DocumentRenderResult) => void;
}) {
  const [documentId, setDocumentId] = useState(
    'documentId' in source ? (source.documentId ?? null) : null,
  );
  const [blueprint, setBlueprint] = useState<DocumentBlueprint | null>(null);
  const [rendered, setRendered] = useState<DocumentRenderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [stale, setStale] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(0.88);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setDocumentId('documentId' in source ? (source.documentId ?? null) : null);
    setRendered(null);
    setStale(false);
    setPage(0);
  }, [source]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    const operationSource =
      source.operationId && source.type
        ? { operationId: source.operationId, type: source.type }
        : null;
    const templateSource = 'templateId' in source ? source.templateId : null;
    const load = templateSource
      ? documentsApi.previewTemplateDocument(templateSource, { signal: controller.signal })
      : documentId
        ? documentsApi.previewDocument(documentId, { signal: controller.signal })
        : operationSource
          ? documentsApi.previewOperationDocument(
              operationSource.operationId,
              operationSource.type,
              { signal: controller.signal },
            )
          : Promise.reject(new Error('Documento sem origem de preview.'));

    load
      .then((data) => {
        if (!active) return;
        setBlueprint(data);
        const currentFingerprint = data.metadata.sourceFingerprint;
        const renderedFingerprint = artifact?.renderMetadata?.sourceFingerprint;
        setStale(Boolean(
          documentId &&
          artifact?.renderedAt &&
          typeof currentFingerprint === 'string' &&
          currentFingerprint !== renderedFingerprint
        ));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(
          err instanceof ApiClientError || err instanceof Error
            ? err.message
            : 'Falha ao carregar preview.',
        );
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [artifact, documentId, source, tick]);

  const pages = useMemo(() => paginate(blueprint), [blueprint]);
  const currentPage = pages[Math.min(page, Math.max(0, pages.length - 1))] ?? [];
  const docTitle =
    title ??
    blueprint?.header.title ??
    (source.type ? DOCUMENT_KIND_LABEL[source.type] : 'Documento');
  const isModelPreview = 'templateId' in source;
  const effectiveRenderedAt = rendered?.renderedAt ?? artifact?.renderedAt ?? null;
  const effectiveFileSize = rendered?.fileSize ?? artifact?.fileSize ?? 0;
  const pdfState = stale
    ? { label: 'PDF desatualizado', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700' }
    : effectiveRenderedAt
      ? { label: 'PDF disponível', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' }
      : { label: 'Sem PDF', className: 'border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' };

  const render = useCallback(async () => {
    setRendering(true);
    setError(null);
    try {
      const operationSource =
        source.operationId && source.type
          ? { operationId: source.operationId, type: source.type }
          : null;
      const templateSource = 'templateId' in source ? source.templateId : null;
      const result = templateSource
        ? null
        : documentId
          ? await documentsApi.renderDocument(documentId)
          : operationSource
            ? await documentsApi.renderOperationDocument(
                operationSource.operationId,
                operationSource.type,
              )
            : null;
      if (!result) throw new Error('Documento sem origem de renderização.');
      setRendered(result);
      setStale(false);
      setDocumentId(result.id);
      onRendered?.(result);
      setTick((value) => value + 1);
      return result;
    } catch (err) {
      setError(
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Falha ao renderizar documento.',
      );
      return null;
    } finally {
      setRendering(false);
    }
  }, [documentId, onRendered, source]);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      let id = documentId;
      if (!id) {
        const result = await render();
        id = result?.id ?? null;
      }
      if (!id) throw new Error('Renderize o documento antes do download.');
      const file = await documentsApi.downloadDocument(id);
      downloadBlob(file);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'DOCUMENT_STALE') {
        setStale(true);
        setError('Documento desatualizado — gere novamente antes de baixar.');
      } else {
        setError(
          err instanceof ApiClientError || err instanceof Error
            ? err.message
            : 'Falha ao baixar documento.',
        );
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[144px_minmax(0,1fr)_300px]">
      <aside className="hidden lg:block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 max-h-[720px] overflow-auto">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)] px-2 py-1">
          Páginas
        </div>
        <div className="space-y-2">
          {pages.map((sections, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setPage(index)}
              className={`w-full rounded-[var(--radius-md)] border p-1 text-left transition ${
                page === index
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'
              }`}
            >
              <div className="aspect-[1/1.35] rounded bg-white p-2 text-[7px] text-slate-500 shadow-sm overflow-hidden">
                <strong className="block truncate text-slate-900">{docTitle}</strong>
                {sections.slice(0, 3).map((section) => (
                  <span key={section.id} className="mt-1 block truncate">
                    {section.title}
                  </span>
                ))}
              </div>
              <span className="mt-1 block text-center text-[11px] text-[var(--color-muted-foreground)]">
                {index + 1}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 overflow-hidden">
        <Toolbar
          page={page}
          total={pages.length}
          zoom={zoom}
          onPrev={() => setPage((value) => Math.max(0, value - 1))}
          onNext={() => setPage((value) => Math.min(pages.length - 1, value + 1))}
          onZoomIn={() => setZoom((value) => Math.min(1.35, value + 0.08))}
          onZoomOut={() => setZoom((value) => Math.max(0.62, value - 0.08))}
          onRefresh={() => setTick((value) => value + 1)}
          loading={loading}
        />

        <div className="h-[720px] overflow-auto p-4 sm:p-6">
          {loading ? (
            <State icon={Loader2} title="Carregando preview oficial…" spin />
          ) : error && !blueprint ? (
            <State icon={AlertTriangle} title="Preview indisponível" description={error} danger />
          ) : blueprint ? (
            <div
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
              className="transition-transform"
            >
              <DocumentPage
                blueprint={blueprint}
                sections={currentPage}
                page={page + 1}
                total={pages.length}
              />
            </div>
          ) : (
            <State icon={FileText} title="Documento vazio" />
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-caption truncate">
                {blueprint ? DOCUMENT_KIND_LABEL[blueprint.metadata.documentType] : 'Documento'}
              </div>
              <h3 className="font-medium truncate">
                {blueprint?.metadata.documentNumber ?? docTitle}
              </h3>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className={`mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-center text-xs font-semibold ${pdfState.className}`}>
              {pdfState.label}
            </div>
            <Meta label="Cliente" value={metadataValue(blueprint, 'Cliente')} />
            <Meta label="Equipamento" value={metadataValue(blueprint, 'Nome')} />
            <Meta label="Operador" value={metadataValue(blueprint, 'Operador')} />
            <Meta label="Páginas" value={pages.length ? String(pages.length) : '—'} />
            <Meta label="Tamanho" value={formatBytes(effectiveFileSize)} />
            <Meta
              label="Renderizado em"
              value={
                effectiveRenderedAt ? new Date(effectiveRenderedAt).toLocaleString('pt-BR') : '—'
              }
            />
            <Meta label="Versão" value={blueprint?.version ? `v${blueprint.version}` : 'v1'} />
          </dl>
        </div>

        {error && blueprint && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="grid gap-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
            {isModelPreview
              ? 'Visualização do modelo — sem dados reais e sem emissão oficial.'
              : 'Pré-visualização com dados reais da operação.'}
          </div>
          <button
            type="button"
            onClick={() => setTick((value) => value + 1)}
            className={secondaryButtonCls}
          >
            <RefreshCw className="h-4 w-4" /> Pré-visualizar
          </button>
          {canRender && (
            <button
              type="button"
              onClick={render}
              disabled={rendering}
              className={primaryButtonCls}
            >
              {rendering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {stale ? 'Gerar novamente' : 'Gerar PDF'}
            </button>
          )}
          {canDownload && (
            <button
              type="button"
              onClick={download}
              disabled={downloading || stale}
              className={secondaryButtonCls}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PDF
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Toolbar({
  page,
  total,
  zoom,
  loading,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onRefresh,
}: {
  page: number;
  total: number;
  zoom: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={onPrev} disabled={page <= 0} className={iconButtonCls}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[92px] text-center text-sm">
          Página {total ? page + 1 : 0} / {total}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= total - 1}
          className={iconButtonCls}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={onZoomOut} className={iconButtonCls}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs font-mono">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={onZoomIn} className={iconButtonCls}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRefresh} disabled={loading} className={iconButtonCls}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

function DocumentPage({
  blueprint,
  sections,
  page,
  total,
}: {
  blueprint: DocumentBlueprint;
  sections: DocumentBlueprint['sections'];
  page: number;
  total: number;
}) {
  const visual = blueprint.visualStyle;
  const corporate = blueprint.header.corporate;
  const headerLogo = corporate?.logo ?? blueprint.header.logo;
  return (
    <article
      className="mx-auto min-h-[1060px] w-[780px] bg-white text-slate-950 shadow-[var(--shadow-card)]"
      style={{ backgroundColor: visual?.colors.background, color: visual?.colors.text }}
    >
      <div
        className="h-2"
        style={{ backgroundColor: visual?.colors.primary ?? 'var(--color-primary)' }}
      />
      <div className="p-10">
        <header className="border-b border-slate-200 pb-6">
          <div className="flex min-h-12 items-center">
            {headerLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${headerLogo.mimeType};base64,${headerLogo.contentBase64}`}
                alt={`Logo ${blueprint.header.organizationName}`}
                className="h-10 w-32 object-contain object-left"
              />
            )}
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(260px,1fr)] gap-10">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">{blueprint.header.title}</h1>
              <p className="mt-2 font-mono text-xs font-semibold text-slate-500">
                {blueprint.header.documentNumber}
              </p>
            </div>
            <div className="min-w-0 text-right text-xs leading-relaxed text-slate-500">
              <strong className="block text-sm text-slate-900">
                {corporate?.tradeName || blueprint.header.organizationName}
              </strong>
              {corporate?.legalName && corporate.legalName !== corporate.tradeName && (
                <span className="block">{corporate.legalName}</span>
              )}
              <span>{corporate?.cnpj || blueprint.metadata.organization.cnpj}</span>
              {corporate?.stateRegistration && <span> · IE {corporate.stateRegistration}</span>}
              <br />
              <span>
                {corporate?.fullAddress ||
                  blueprint.metadata.organization.address ||
                  `${blueprint.metadata.organization.city}/${blueprint.metadata.organization.state}`}
              </span>
              <br />
              <span>
                {(corporate?.phoneNumbers ?? [blueprint.metadata.organization.phone])
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · {corporate?.email || blueprint.metadata.organization.email}
              </span>
              {(corporate?.website || blueprint.metadata.organization.website) && (
                <>
                  <br />
                  <span>{corporate?.website || blueprint.metadata.organization.website}</span>
                </>
              )}
            </div>
          </div>
        </header>
        <div className="mt-7 space-y-7">
          {sections.map((section) => (
            <section key={section.id}>
              <h2
                className="border-b pb-1.5 text-xs font-semibold uppercase tracking-[0.12em]"
                style={{ color: visual?.colors.primary, borderColor: visual?.colors.border }}
              >
                {section.title}
              </h2>
              <div className="mt-3 space-y-3">
                {section.components.map((component) => (
                  <ComponentPreview key={component.id} component={component} visual={visual} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <footer className="mt-10 flex items-center justify-between border-t border-slate-200 pt-3 text-[10px] text-slate-400">
          <span>{blueprint.footer.content}</span>
          <span>
            Página {page} de {total}
          </span>
        </footer>
      </div>
    </article>
  );
}

function ComponentPreview({
  component,
  visual,
}: {
  component: DocumentComponent;
  visual?: DocumentBlueprint['visualStyle'];
}) {
  if (component.kind === 'metadata') {
    return (
      <dl
        className="grid grid-cols-2 gap-x-8 gap-y-2 rounded-md border p-4"
        style={{ borderColor: visual?.colors.border, backgroundColor: visual?.colors.surface }}
      >
        {component.items.map((item) => (
          <div key={`${component.id}-${item.label}`}>
            <dt className="text-[10px] uppercase tracking-wider text-slate-400">{item.label}</dt>
            <dd className="text-sm font-medium">{item.value || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (component.kind === 'table') {
    return (
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wider text-slate-400">
            {component.columns.map((col) => (
              <th
                key={col.key}
                className="break-words px-1 py-2 align-top"
                style={{ width: col.width ? `${col.width * 100}%` : undefined }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {component.rows.map((row, index) => {
            const emphasized = component.emphasizedRowIndexes?.includes(index) === true;
            return (
            <tr
              key={index}
              className={`border-b border-slate-100 ${emphasized ? 'bg-sky-50/70 font-medium text-slate-700' : ''}`}
            >
              {component.columns.map((col) => (
                <td
                  key={col.key}
                  className={`break-words px-1 py-2 align-top ${emphasized && col.key === 'total' ? 'font-semibold text-sky-800' : ''}`}
                >
                  {row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (component.kind === 'checklist') {
    return (
      <ul className="space-y-2 text-sm">
        {component.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono">{item.done ? '☑' : '☐'}</span>
            <span>
              {i + 1}. {item.label}
              {item.note ? <small className="block text-slate-500">{item.note}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (component.kind === 'checklistColumns') {
    return (
      <div
        className="grid gap-0 overflow-hidden rounded-md border"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, component.columns.length)}, minmax(0, 1fr))`,
          borderColor: visual?.colors.border,
        }}
      >
        {component.columns.map((col, colIndex) => (
          <div
            key={`${component.id}-${colIndex}`}
            className="min-w-0"
            style={{ borderLeftWidth: colIndex > 0 ? 1 : 0, borderColor: visual?.colors.border }}
          >
            <div
              className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide"
              style={{
                borderColor: visual?.colors.border,
                backgroundColor: col.selected ? 'rgba(15,118,110,0.1)' : visual?.colors.surface,
                color: col.selected ? '#0f766e' : undefined,
              }}
            >
              <span className="truncate">{col.title}</span>
              <span className="font-mono">( {col.selected ? 'x' : ' '} )</span>
            </div>
            <ul className="space-y-1.5 px-3 py-2.5 text-sm">
              {col.items.length > 0 ? (
                col.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono leading-5" style={{ color: item.done ? '#0f766e' : undefined }}>
                      {item.done ? '☑' : '☐'}
                    </span>
                    <span className="min-w-0">{item.label}</span>
                  </li>
                ))
              ) : (
                <li className="text-xs text-slate-400">Nenhum item registrado.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  if (component.kind === 'list') {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {component.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (component.kind === 'qrCode') {
    return (
      <div className="flex items-center gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:${component.image.mimeType};base64,${component.image.contentBase64}`}
          alt={component.label}
          className="h-32 w-32 shrink-0 bg-white object-contain [image-rendering:pixelated]"
        />
        <div>
          <strong className="block text-slate-900">{component.label}</strong>
          <span className="mt-1 block font-mono text-[11px] text-slate-500">{component.value}</span>
          <span className="mt-2 block text-xs text-slate-500">
            Escaneie para abrir o equipamento no fluxo oficial Orbit.
          </span>
        </div>
      </div>
    );
  }
  if (component.kind === 'signaturePlaceholder') {
    return (
      <div className="mt-10 border-t border-slate-400 pt-2 text-center text-sm">
        {component.label} · {component.strategy}
      </div>
    );
  }
  if (component.kind === 'signature') {
    // Cliente (coletada) à esquerda e responsável técnico à direita.
    return (
      <div className={`grid gap-4 rounded-md border border-slate-200 p-4 ${component.signatures.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {component.signatures.map((signature) => (
          <div key={signature.id} className="text-center">
            {signature.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${signature.image.mimeType};base64,${signature.image.contentBase64}`}
                alt={signature.label}
                className="mx-auto h-16 max-w-[220px] object-contain"
              />
            ) : (
              <div className="mt-12 border-t border-slate-400 pt-2" />
            )}
            <div className="mt-2 text-sm font-medium">{signature.name ?? signature.label}</div>
            <div className="text-xs text-slate-500">
              {signature.title ?? signature.caption ?? signature.role}
            </div>
            {signature.signedAt && (
              <div className="text-[10px] text-slate-400">
                {new Date(signature.signedAt).toLocaleString('pt-BR')}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (component.kind === 'image') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-medium text-slate-700">
            {component.caption ?? 'Evidência fotográfica'}
          </span>
          <span>
            {component.mimeType} · {formatBytes(component.fileSize)}
          </span>
        </div>
        {component.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:${component.image.mimeType};base64,${component.image.contentBase64}`}
            alt={component.caption ?? 'Evidência fotográfica'}
            className="max-h-72 w-full rounded object-contain"
          />
        ) : (
          <div>Imagem protegida indisponível no preview.</div>
        )}
      </div>
    );
  }
  if (component.kind === 'imageGallery') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {component.images.map((image) => (
          <figure
            key={image.sourceId}
            className="rounded-md border border-slate-200 bg-slate-50 p-2"
          >
            {image.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${image.image.mimeType};base64,${image.image.contentBase64}`}
                alt={image.caption ?? 'Evidência fotográfica'}
                className="h-32 w-full rounded object-cover"
              />
            ) : (
              <div className="grid h-32 place-items-center rounded bg-slate-100 text-xs text-slate-500">
                Imagem protegida indisponível.
              </div>
            )}
            <figcaption className="mt-1.5 truncate text-[11px] text-slate-600">
              {image.caption ?? 'Evidência fotográfica'}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {('text' in component ? component.text : '') || '—'}
    </p>
  );
}

function State({
  icon: Icon,
  title,
  description,
  spin,
  danger,
}: {
  icon: typeof FileText;
  title: string;
  description?: string;
  spin?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <Icon
          className={`mx-auto h-8 w-8 ${spin ? 'animate-spin' : ''} ${danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted-foreground)]'}`}
        />
        <h4 className="mt-3 font-medium">{title}</h4>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--color-muted-foreground)]">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-caption">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function paginate(blueprint: DocumentBlueprint | null): DocumentBlueprint['sections'][] {
  if (!blueprint) return [];
  const pageCapacity = 14;
  const pages: DocumentBlueprint['sections'][] = [];
  let current: DocumentBlueprint['sections'] = [];
  let weight = 0;
  for (const section of blueprint.sections) {
    const sectionWeight =
      1 + section.components.reduce((sum, component) => sum + componentWeight(component), 0);
    if (current.length > 0 && weight + sectionWeight > pageCapacity) {
      pages.push(current);
      current = [];
      weight = 0;
    }
    current.push(section);
    weight += sectionWeight;
    if (section.pageBreakAfter) {
      pages.push(current);
      current = [];
      weight = 0;
    }
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

function componentWeight(component: DocumentComponent): number {
  if (component.kind === 'table') return Math.max(2, Math.ceil(component.rows.length / 10));
  if (component.kind === 'checklist') return Math.max(1, Math.ceil(component.items.length / 8));
  if (component.kind === 'checklistColumns')
    return Math.max(1, Math.ceil(Math.max(0, ...component.columns.map((c) => c.items.length)) / 8));
  if (component.kind === 'metadata') return Math.max(1, Math.ceil(component.items.length / 8));
  if (component.kind === 'image') return 4;
  if (component.kind === 'imageGallery')
    return Math.max(2, Math.ceil(component.images.length / component.columns) * 2);
  if (component.kind === 'signature') return Math.max(4, component.signatures.length * 3);
  if (component.kind === 'signaturePlaceholder') return 3;
  if (component.kind === 'list') return Math.max(1, Math.ceil(component.items.length / 8));
  if (component.kind === 'paragraph' || component.kind === 'observation')
    return Math.max(1, Math.ceil(component.text.length / 600));
  return 1;
}

function metadataValue(blueprint: DocumentBlueprint | null, label: string): string {
  if (!blueprint) return '—';
  for (const section of blueprint.sections) {
    for (const component of section.components) {
      if (component.kind !== 'metadata') continue;
      const item = component.items.find((entry) => entry.label === label);
      if (item) return item.value || '—';
    }
  }
  return '—';
}

function downloadBlob(file: DocumentDownloadResult) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename ?? 'documento.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const iconButtonCls =
  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-45';
const primaryButtonCls =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonCls =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50';
