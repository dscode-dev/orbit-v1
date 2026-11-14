"use client";

/**
 * SignaturePad — commercial-grade signature capture for field use.
 *
 * Features: draw (pointer/touch), desfazer (undo last stroke), limpar, confirmar
 * and a visual status indicator. Reports the PNG data URL via `onChange` and the
 * confirmed signature via `onConfirm`.
 *
 * Sprint 3 is visual/collection only: the signature is NOT uploaded or embedded
 * into a document — that is backend responsibility in the document flow.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Undo2, Check, PenLine } from "lucide-react";

type Point = { x: number; y: number };

export function SignaturePad({
  onChange,
  onConfirm,
  initialValue,
}: {
  initialValue?: string | null;
  onChange?: (dataUrl: string | null) => void;
  onConfirm?: (dataUrl: string | null) => void;
}) {
  const initialImage = useRef(initialValue);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const ctxOf = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxOf();
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, [ctxOf]);

  useEffect(() => {
    setup();
    if (!initialImage.current) return;
    const image = new window.Image();
    image.onload = () => {
      const canvas = canvasRef.current; const ctx = ctxOf();
      if (!canvas || !ctx) return;
      ctx.drawImage(image, 0, 0, canvas.offsetWidth, canvas.offsetHeight);
      setHasInk(true); setConfirmed(true);
    };
    image.src = initialImage.current;
    return () => { image.onload = null; };
  }, [setup, ctxOf]);

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = ctxOf();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes.current) {
      ctx.beginPath();
      stroke.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  }

  function emit() {
    const has = strokes.current.length > 0;
    setHasInk(has);
    onChange?.(has ? canvasRef.current!.toDataURL("image/png") : null);
  }

  function pos(e: React.PointerEvent): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent) {
    if (confirmed) return;
    drawing.current = true;
    current.current = [pos(e)];
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !current.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const p = pos(e);
    const prev = current.current[current.current.length - 1];
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    current.current.push(p);
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (current.current && current.current.length > 1) strokes.current.push(current.current);
    current.current = null;
    emit();
  }

  function undo() {
    if (confirmed) return;
    strokes.current.pop();
    redraw();
    emit();
  }
  function clear() {
    initialImage.current = null;
    strokes.current = [];
    setConfirmed(false);
    redraw();
    emit();
  }
  function confirm() {
    if (!hasInk) return;
    setConfirmed(true);
    onConfirm?.(canvasRef.current!.toDataURL("image/png"));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${confirmed ? "bg-[var(--color-success)]/12 text-[var(--color-success)]" : hasInk ? "bg-[var(--color-info)]/12 text-[var(--color-info)]" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"}`}>
          {confirmed ? <><Check className="h-3 w-3" /> Assinatura confirmada</> : hasInk ? <><PenLine className="h-3 w-3" /> Assinatura capturada</> : <>Aguardando assinatura</>}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!hasInk || confirmed} aria-label="Desfazer" className="h-8 w-8 grid place-items-center rounded-[var(--radius-md)] border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-muted)]"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={clear} disabled={!hasInk} aria-label="Limpar" className="h-8 w-8 grid place-items-center rounded-[var(--radius-md)] border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-muted)]"><Eraser className="h-4 w-4" /></button>
        </div>
      </div>

      <div className={`relative rounded-[var(--radius-md)] border bg-white ${confirmed ? "border-[var(--color-success)]/50" : "border-dashed border-[var(--color-border)]"}`}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="h-44 w-full touch-none cursor-crosshair"
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[var(--color-muted-foreground)]">
            <span className="inline-flex items-center gap-1.5 text-sm"><PenLine className="h-4 w-4" /> Assine aqui</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={confirmed ? clear : confirm}
        disabled={!hasInk}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] h-11 text-sm font-semibold disabled:opacity-50 active:scale-[0.99] ${confirmed ? "border border-[var(--color-border)] hover:bg-[var(--color-muted)]" : "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"}`}
      >
        {confirmed ? <><Eraser className="h-4 w-4" /> Refazer assinatura</> : <><Check className="h-4 w-4" /> Confirmar assinatura</>}
      </button>
    </div>
  );
}
