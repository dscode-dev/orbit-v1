"use client";

/**
 * PhotoInput — field photo capture: multiple images, preview, remove, reorder.
 *
 * Mobile-first: offers explicit camera capture and gallery selection. Holds the
 * File + an object URL so the surrounding flow can upload it through the
 * official evidence endpoint.
 */
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { prepareEvidencePhoto } from "@erp/utils/prepare-evidence-photo";
import { Camera, X, ArrowLeft, ArrowRight, ImagePlus } from "lucide-react";

export type CapturedPhoto = {
  id: string;
  name: string;
  url: string; // object URL for preview
  file: File;
  caption?: string;
  status?: "pending" | "saving" | "error";
  error?: string;
};

export function PhotoInput({
  photos,
  onChange,
  max = 12,
  existingCount = 0,
  requiredMinimum,
  disabled = false,
  onProcessingChange,
}: {
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  max?: number;
  existingCount?: number;
  requiredMinimum?: number;
  disabled?: boolean;
  onProcessingChange?: (processing: boolean) => void;
}) {
  const cameraInputId = useId();
  const galleryInputId = useId();
  const photosRef = useRef(photos);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  photosRef.current = photos;

  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const active = useRef(true);
  const processingCallback = useRef(onProcessingChange);
  processingCallback.current = onProcessingChange;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; processingCallback.current?.(false); };
  }, []);

  async function addFiles(files: File[]) {
    if (disabled || processingRef.current) return;
    const room = Math.max(0, max - existingCount - photosRef.current.length);
    if (!room) return;
    processingRef.current = true; setProcessing(true); processingCallback.current?.(true); setValidationError(null);
    const errors: string[] = [];
    try {
      // Sequential processing keeps memory bounded on mobile cameras/galleries.
      for (const original of files.slice(0, room)) {
        try {
          const file = await prepareEvidencePhoto(original);
          if (!active.current) return;
          const next: CapturedPhoto = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name,
            url: URL.createObjectURL(file), file, caption: '', status: 'pending',
          };
          const current = [...photosRef.current, next];
          photosRef.current = current;
          onChange(current);
        } catch (cause) { errors.push(`${original.name}: ${cause instanceof Error ? cause.message : 'Não foi possível preparar a foto.'}`); }
      }
      if (active.current && errors.length) setValidationError(errors.join(' '));
    } finally {
      processingRef.current = false;
      if (active.current) setProcessing(false);
      processingCallback.current?.(false);
    }
  }

  function add(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void addFiles(files);
  }

  function remove(id: string) {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.url);
    onChange(photos.filter((p) => p.id !== id));
  }

  function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  function caption(id: string, value: string) {
    onChange(photos.map((photo) => photo.id === id ? { ...photo, caption: value } : photo));
  }

  const total = existingCount + photos.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {photos.map((p, i) => (
          <div key={p.id} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
            <div className="relative group aspect-square bg-[var(--color-muted)]">
              <Image src={p.url} alt={p.name} fill sizes="160px" unoptimized className="object-contain" />
            <button
              type="button"
              onClick={() => remove(p.id)} disabled={disabled || processing}
              aria-label="Remover foto"
              className="absolute top-1 right-1 h-7 w-7 grid place-items-center rounded-full bg-black/60 text-white active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
              <button type="button" onClick={() => move(i, -1)} disabled={disabled || processing || i === 0} aria-label="Mover para trás" className="h-7 w-7 grid place-items-center rounded-full bg-black/55 text-white disabled:opacity-30 active:scale-90">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] font-mono text-white bg-black/55 rounded-full px-1.5">{i + 1}</span>
              <button type="button" onClick={() => move(i, 1)} disabled={disabled || processing || i === photos.length - 1} aria-label="Mover para frente" className="h-7 w-7 grid place-items-center rounded-full bg-black/55 text-white disabled:opacity-30 active:scale-90">
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            </div>
            <div className="space-y-1.5 p-2">
              <input value={p.caption ?? ""} onChange={(event) => caption(p.id, event.target.value)} disabled={disabled || processing} maxLength={255} placeholder="Legenda opcional" className="h-8 w-full rounded border border-[var(--color-border)] bg-transparent px-2 text-xs" />
              <span className={`text-[10px] font-medium ${p.status === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-muted-foreground)]"}`}>{p.status === "saving" ? "Salvando…" : p.status === "error" ? p.error ?? "Falha no envio" : "Pendente"}</span>
            </div>
          </div>
        ))}

        {total < max && (
          <div
            onDragEnter={(event) => { event.preventDefault(); if (!disabled && !processing) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); if (!disabled && !processing) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled && !processing) void addFiles(Array.from(event.dataTransfer.files)); }}
            className={`aspect-square rounded-[var(--radius-md)] border border-dashed p-3 text-[var(--color-muted-foreground)] transition-colors ${dragging ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)]"}`}
          >
            <div className="flex h-full flex-col justify-center gap-2">
              {dragging ? (
                <span className="flex flex-1 flex-col items-center justify-center gap-2 text-xs font-medium text-[var(--color-primary)]">
                  <ImagePlus className="h-6 w-6" />
                  Solte as fotos aqui
                </span>
              ) : (
                <>
                  <label
                    htmlFor={cameraInputId}
                    aria-disabled={disabled || processing}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-xs font-semibold text-white transition-transform active:scale-[0.98] ${disabled || processing ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
                  >
                    <Camera className="h-4 w-4" />
                    Tirar foto
                  </label>
                  <label
                    htmlFor={galleryInputId}
                    aria-disabled={disabled || processing}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-xs font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] active:scale-[0.98] ${disabled || processing ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Escolher da galeria
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <input id={cameraInputId} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" capture="environment" disabled={disabled || processing} onChange={add} className="sr-only" aria-label="Tirar foto com a câmera" />
      <input id={galleryInputId} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple disabled={disabled || processing} onChange={add} className="sr-only" aria-label="Escolher fotos da galeria" />
      {processing && <p role="status" className="text-xs text-[var(--color-muted-foreground)]">Preparando e compactando fotos…</p>}
      {validationError && <p className="text-xs text-[var(--color-danger)]">{validationError}</p>}
      <p className="text-[11px] text-[var(--color-muted-foreground)]">{total}/{max} imagens · fotos compactadas automaticamente · até 512 KiB cada{requiredMinimum ? ` · mínimo ${requiredMinimum} para concluir e emitir` : ""}</p>
    </div>
  );
}
