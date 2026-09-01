import type { DocumentTemplateType } from '@prisma/client';
import type { SignatureMode } from '@prisma/client';

export type DocumentComponentKind =
  | 'metadata'
  | 'paragraph'
  | 'table'
  | 'list'
  | 'image'
  | 'imageGallery'
  | 'qrCode'
  | 'checklist'
  | 'checklistColumns'
  | 'signature'
  | 'signaturePlaceholder'
  | 'observation';

export interface DocumentMetadata {
  operationId: string | null;
  budgetId?: string | null;
  documentId: string | null;
  documentType: DocumentTemplateType;
  documentNumber: string;
  sourceKind?: 'operation' | 'budget' | 'template';
  sourceId?: string | null;
  templateId?: string | null;
  templateUpdatedAt?: string | null;
  sourceFingerprint?: string;
  generatedAt: string;
  locale: 'pt-BR';
  timezone: string;
  currency: string;
  organization: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    stateRegistration?: string;
    email: string;
    phone: string;
    phoneNumbers?: string[];
    website: string;
    address: string;
    zipCode?: string;
    city: string;
    state: string;
    primaryColor: string;
    secondaryColor: string;
  };
}

export interface DocumentHeader {
  title: string;
  subtitle?: string;
  organizationName: string;
  documentNumber: string;
  logo?: { mimeType: string; fileSize: number; contentBase64: string } | null;
  corporate?: CorporateDocumentHeader;
}

export interface CorporateDocumentHeader {
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration: string;
  fullAddress: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumbers: string[];
  email: string;
  website: string;
  logo?: { mimeType: string; fileSize: number; contentBase64: string } | null;
}

export interface DocumentFooter {
  content: string;
  generatedAt: string;
}

export interface BlueprintBaseComponent {
  id: string;
  kind: DocumentComponentKind;
  keepTogether?: boolean;
}

export interface MetadataComponent extends BlueprintBaseComponent {
  kind: 'metadata';
  items: Array<{ label: string; value: string }>;
}

export interface ParagraphComponent extends BlueprintBaseComponent {
  kind: 'paragraph';
  text: string;
  emphasis?: 'normal' | 'strong';
}

export interface TableComponent extends BlueprintBaseComponent {
  kind: 'table';
  columns: Array<{ key: string; label: string; width?: number }>;
  rows: Array<Record<string, string>>;
  emphasizedRowIndexes?: number[];
}

export interface ListComponent extends BlueprintBaseComponent {
  kind: 'list';
  items: string[];
}

export interface ImageComponent extends BlueprintBaseComponent {
  kind: 'image';
  sourceId: string;
  caption: string | null;
  mimeType: string;
  fileSize: number;
  image?: {
    mimeType: string;
    fileSize: number;
    contentBase64: string;
  } | null;
}

export interface ImageGalleryComponent extends BlueprintBaseComponent {
  kind: 'imageGallery';
  images: Array<Omit<ImageComponent, 'id' | 'kind' | 'keepTogether'>>;
  columns: 2 | 3 | 4;
}

export interface QrCodeComponent extends BlueprintBaseComponent {
  kind: 'qrCode';
  label: string;
  value: string;
  image: { mimeType: 'image/png'; fileSize: number; contentBase64: string };
}

export interface DocumentVisualStyle {
  colors: {
    primary: string;
    text: string;
    muted: string;
    border: string;
    surface: string;
    background: string;
  };
  typography: { title: number; section: number; body: number; label: number; caption: number };
  spacing: { section: number; component: number; cardPadding: number };
}

export interface ChecklistComponent extends BlueprintBaseComponent {
  kind: 'checklist';
  items: Array<{ label: string; done: boolean; note: string | null }>;
}

/**
 * Blocos de checklist lado a lado (ex.: Tipo de manutenção — Semanal × Semestral).
 * `selected` marca a coluna cujo tipo foi efetivamente executado ( x ).
 */
export interface ChecklistColumnsComponent extends BlueprintBaseComponent {
  kind: 'checklistColumns';
  columns: Array<{
    title: string;
    selected: boolean;
    items: Array<{ label: string; done: boolean }>;
  }>;
}

export interface SignaturePlaceholderComponent extends BlueprintBaseComponent {
  kind: 'signaturePlaceholder';
  label: string;
  strategy: 'none' | 'fixed' | 'collected' | 'hybrid';
  signedAt: string | null;
}

export interface SignatureComponent extends BlueprintBaseComponent {
  kind: 'signature';
  mode: SignatureMode;
  signatures: Array<{
    id: string;
    role: 'fixed' | 'collected';
    label: string;
    name: string | null;
    title: string | null;
    signedAt: string | null;
    caption: string | null;
    image?: {
      mimeType: string;
      fileSize: number;
      contentBase64: string;
    } | null;
  }>;
}

export interface ObservationComponent extends BlueprintBaseComponent {
  kind: 'observation';
  text: string;
}

export type DocumentBlueprintComponent =
  | MetadataComponent
  | ParagraphComponent
  | TableComponent
  | ListComponent
  | ImageComponent
  | ImageGalleryComponent
  | QrCodeComponent
  | ChecklistComponent
  | ChecklistColumnsComponent
  | SignatureComponent
  | SignaturePlaceholderComponent
  | ObservationComponent;

export interface DocumentSection {
  id: string;
  title: string;
  critical?: boolean;
  pageBreakAfter?: boolean;
  components: DocumentBlueprintComponent[];
}

export interface DocumentBlueprint {
  version: '1.0';
  metadata: DocumentMetadata;
  header: DocumentHeader;
  footer: DocumentFooter;
  visualStyle?: DocumentVisualStyle;
  sections: DocumentSection[];
}
