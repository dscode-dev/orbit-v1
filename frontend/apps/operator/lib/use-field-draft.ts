'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@erp/ui/auth/auth-provider';
import {
  checkpointFieldDraft, deleteFieldDraft, fieldDraftOwner, listFieldDrafts, readFieldDraft, saveFieldDraft,
  type DraftKind, type FieldDraftSummary, type PhotoForm,
} from './field-drafts';
import type { DocumentKind } from '@erp/types';

export function useFieldDraft<T extends PhotoForm>(options: {
  kind: DraftKind; id?: string; revision?: string; enabled?: boolean;
  documentType: DocumentKind; customerName: string; guest?: boolean;
  onRestore: (data: T) => void;
}) {
  const { session } = useAuth();
  const owner = session ? fieldDraftOwner(session.user.id, session.organization.id) : null;
  const [id, setId] = useState<string | null>(options.id ?? null);
  const [loading, setLoading] = useState(options.kind === 'assigned' && options.enabled !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const restoreRef = useRef(options.onRestore); restoreRef.current = options.onRestore;
  const savedRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!owner || options.kind !== 'assigned' || !options.id || options.enabled === false) { setLoading(false); return; }
    let active = true; setLoading(true);
    readFieldDraft<T>(owner, options.id, options.revision).then((record) => {
      if (!active) { record?.data.photos.forEach((photo) => URL.revokeObjectURL(photo.url)); return; }
      if (record && record.documentType !== options.documentType) {
        record.data.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
        void deleteFieldDraft(owner, record.id).catch(() => undefined);
        return;
      }
      if (record) { restoreRef.current(record.data); setSavedAt(record.savedAt); savedRef.current = true; setRestored(true); }
    }).catch((cause) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, options.id, options.revision, options.kind, options.enabled, options.documentType]);

  async function save(data: T, step: number): Promise<boolean> {
    if (!owner || options.enabled === false) return false;
    setBusy(true); setError(null);
    try {
      const nextId = id ?? `new:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      const date = new Date().toISOString();
      await saveFieldDraft({ id: nextId, owner, kind: options.kind, revision: options.revision,
        documentType: options.documentType, customerName: options.customerName, guest: Boolean(options.guest), savedAt: date, step }, data);
      if (!mounted.current) return false;
      setId(nextId); savedRef.current = true; setSavedAt(date); return true;
    } catch (cause) { setError(message(cause)); return false; } finally { setBusy(false); }
  }
  async function resume(summary: FieldDraftSummary): Promise<boolean> {
    if (!owner || summary.owner !== owner || summary.kind !== options.kind) return false;
    setBusy(true); setError(null);
    try {
      const record = await readFieldDraft<T>(owner, summary.id);
      if (!record || record.kind !== options.kind) throw new Error('O rascunho não está mais disponível.');
      if (!mounted.current) { record.data.photos.forEach((photo) => URL.revokeObjectURL(photo.url)); return false; }
      restoreRef.current(record.data); setId(record.id); savedRef.current = true;
      setSavedAt(record.savedAt); setRestored(true); return true;
    } catch (cause) { setError(message(cause)); return false; } finally { setBusy(false); }
  }
  async function list(documentType: DocumentKind, guest: boolean) {
    return owner ? listFieldDrafts(owner, { kind: options.kind, documentType, guest }) : [];
  }
  async function remove(summary: FieldDraftSummary) {
    if (owner && summary.owner === owner) await deleteFieldDraft(owner, summary.id);
  }
  async function clear() {
    if (owner && id) await deleteFieldDraft(owner, id);
    savedRef.current = false; setId(options.id ?? null); setSavedAt(null); setRestored(false);
  }
  async function checkpoint(fields: Record<string, unknown>, uploadedPhotoIds?: string[]) {
    if (!owner || !id || !savedRef.current) return;
    await checkpointFieldDraft(owner, id, fields, uploadedPhotoIds);
  }
  function detach() { savedRef.current = false; setId(options.id ?? null); setSavedAt(null); setRestored(false); setError(null); }
  return { loading, busy, error, restored, savedAt, save, resume, list, remove, clear, checkpoint, detach };
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : 'Não foi possível salvar o rascunho neste aparelho.'; }
