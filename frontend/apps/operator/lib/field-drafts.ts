import type { CapturedPhoto } from '@erp/ui/photo-input';
import type { DocumentKind } from '@erp/types';

const DATABASE = 'erp-operator-field-drafts';
const STORE = 'drafts';
export type DraftKind = 'assigned' | 'new';
export type FieldDraftSummary = {
  id: string; owner: string; kind: DraftKind; documentType: DocumentKind;
  customerName: string; savedAt: string; step: number; guest: boolean;
  revision?: string; operationId?: string;
};
type StoredPhoto = { id: string; name: string; file: Blob; caption?: string; lastModified: number };
type StoredRecord = FieldDraftSummary & { version: 1; data: Record<string, unknown> & { photos: StoredPhoto[] } };
export type PhotoForm = { photos: CapturedPhoto[] };
export type FieldDraft<T> = FieldDraftSummary & { data: T };

export function fieldDraftOwner(userId: string, organizationId: string): string {
  return JSON.stringify(['operator', organizationId, userId]);
}
function key(owner: string, id: string): string { return JSON.stringify([owner, id]); }

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('O armazenamento de rascunhos não está disponível neste navegador.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE);
      store.createIndex('owner', 'owner', { unique: false });
    };
    request.onerror = () => reject(new Error('Não foi possível abrir os rascunhos neste aparelho.'));
    request.onblocked = () => { blocked = true; reject(new Error('Feche outras abas do aplicativo e tente salvar novamente.')); };
    request.onsuccess = () => { if (blocked) { request.result.close(); return; } const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(new Error('Não foi possível salvar o rascunho. Verifique o espaço disponível neste aparelho.'));
      tx.onerror = () => reject(new Error('Não foi possível acessar o rascunho. Tente novamente.'));
    });
  } finally { db.close(); }
}
function summary(record: StoredRecord): FieldDraftSummary {
  const { data, version, ...metadata } = record; void data; void version; return metadata;
}
export async function listFieldDrafts(owner: string, filter: { kind: DraftKind; documentType?: DocumentKind; guest?: boolean }): Promise<FieldDraftSummary[]> {
  const records = await transaction<StoredRecord[]>('readonly', (store) => store.index('owner').getAll(owner));
  return records.filter((item) => item.version === 1 && item.owner === owner && item.kind === filter.kind
    && (!filter.documentType || item.documentType === filter.documentType)
    && (filter.guest === undefined || item.guest === filter.guest))
    .map(summary).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function saveFieldDraft<T extends PhotoForm>(metadata: FieldDraftSummary, data: T): Promise<void> {
  const { photos, ...fields } = data;
  const record: StoredRecord = { ...metadata, version: 1, data: { ...fields, photos: photos.map((photo) => ({
    id: photo.id, name: photo.name, file: photo.file, caption: photo.caption, lastModified: photo.file.lastModified,
  })) } };
  await transaction('readwrite', (store) => store.put(record, key(metadata.owner, metadata.id)));
}
export async function readFieldDraft<T extends PhotoForm>(owner: string, id: string, revision?: string): Promise<FieldDraft<T> | null> {
  const record = await transaction<StoredRecord | undefined>('readonly', (store) => store.get(key(owner, id)));
  if (!record || record.owner !== owner || record.version !== 1 || !Array.isArray(record.data?.photos)) return null;
  if (revision !== undefined && record.revision !== revision) { await deleteFieldDraft(owner, id); return null; }
  const photos = record.data.photos.map((photo): CapturedPhoto => {
    const file = new File([photo.file], photo.name, { type: photo.file.type, lastModified: photo.lastModified });
    return { id: photo.id, name: photo.name, file, url: URL.createObjectURL(file), caption: photo.caption ?? '', status: 'pending' };
  });
  return { ...summary(record), data: { ...record.data, photos } as T };
}
export async function deleteFieldDraft(owner: string, id: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(key(owner, id)));
}
/** Only confirmed server progress is checkpointed; field edits are saved solely by the button. */
export async function checkpointFieldDraft(owner: string, id: string, fields: Record<string, unknown>, uploadedPhotoIds: string[] = []): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
      const request = store.get(key(owner, id));
      request.onsuccess = () => {
        const record = request.result as StoredRecord | undefined;
        if (!record || record.owner !== owner) return;
        const uploaded = new Set(uploadedPhotoIds);
        store.put({ ...record, data: { ...record.data, ...fields, photos: record.data.photos.filter((photo) => !uploaded.has(photo.id)) } }, key(owner, id));
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('Não foi possível atualizar o progresso do rascunho.'));
    });
  } finally { db.close(); }
}
