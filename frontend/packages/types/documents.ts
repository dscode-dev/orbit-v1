import type { DocumentTemplateType } from './index';

export type DocumentKind = DocumentTemplateType;

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  BUDGET: 'Orçamento',
  QUOTE: 'Orçamento',
  WORK_ORDER: 'Ordem de Serviço',
  RECEIPT: 'Recibo',
  REPORT: 'Relatório legado',
  TECHNICAL_REPORT: 'Relatório de Visita Técnica',
  TECHNICAL_OPINION: 'Laudo Técnico',
  PMOC: 'PMOC',
};

export type DocumentComponent =
  | {
      id: string;
      kind: 'metadata';
      items: Array<{ label: string; value: string }>;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'paragraph';
      text: string;
      emphasis?: 'normal' | 'strong';
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'table';
      columns: Array<{ key: string; label: string; width?: number }>;
      rows: Array<Record<string, string>>;
      emphasizedRowIndexes?: number[];
      keepTogether?: boolean;
    }
  | { id: string; kind: 'list'; items: string[]; keepTogether?: boolean }
  | {
      id: string;
      kind: 'image';
      sourceId: string;
      caption: string | null;
      mimeType: string;
      fileSize: number;
      image?: { mimeType: string; fileSize: number; contentBase64: string } | null;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'imageGallery';
      columns: 2;
      images: Array<{
        sourceId: string;
        caption: string | null;
        mimeType: string;
        fileSize: number;
        image?: { mimeType: string; fileSize: number; contentBase64: string } | null;
      }>;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'qrCode';
      label: string;
      value: string;
      image: { mimeType: 'image/png'; fileSize: number; contentBase64: string };
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'checklist';
      items: Array<{ label: string; done: boolean; note: string | null }>;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'checklistColumns';
      columns: Array<{
        title: string;
        selected: boolean;
        items: Array<{ label: string; done: boolean }>;
      }>;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'signaturePlaceholder';
      label: string;
      strategy: 'none' | 'fixed' | 'collected' | 'hybrid';
      signedAt: string | null;
      keepTogether?: boolean;
    }
  | {
      id: string;
      kind: 'signature';
      mode: 'NONE' | 'FIXED' | 'COLLECTED' | 'HYBRID';
      signatures: Array<{
        id: string;
        role: 'fixed' | 'collected';
        label: string;
        name: string | null;
        title: string | null;
        signedAt: string | null;
        caption: string | null;
        image?: { mimeType: string; fileSize: number; contentBase64: string } | null;
      }>;
      keepTogether?: boolean;
    }
  | { id: string; kind: 'observation'; text: string; keepTogether?: boolean };

export type DocumentBlueprint = {
  version: '1.0';
  metadata: {
    operationId: string | null;
    budgetId?: string | null;
    documentId: string | null;
    documentType: DocumentKind;
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
  };
  header: {
    title: string;
    subtitle?: string;
    organizationName: string;
    documentNumber: string;
    logo?: { mimeType: string; fileSize: number; contentBase64: string } | null;
    corporate?: {
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
    };
  };
  footer: { content: string; generatedAt: string };
  visualStyle?: {
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
  };
  sections: Array<{
    id: string;
    title: string;
    critical?: boolean;
    pageBreakAfter?: boolean;
    components: DocumentComponent[];
  }>;
};

export type DocumentRenderResult = {
  id: string;
  operationId: string | null;
  budgetId?: string | null;
  type: DocumentKind;
  number: string;
  status: 'DRAFT' | 'READY' | 'VALIDATED' | 'SENT';
  mimeType: string | null;
  fileSize: number | null;
  renderedAt: string | null;
  renderMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  downloadReady: boolean;
};

export type DocumentDownloadResult = { blob: Blob; filename: string | null };
