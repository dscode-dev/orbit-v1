export const DOCUMENT_ENGINE_RESOURCE = 'DOCUMENT_ENGINE';
export const DOCUMENT_RENDER_RESOURCE = 'DOCUMENT_RENDER';

export const DOCUMENT_ENGINE_AUDIT_ACTIONS = {
  DOCUMENT_PREVIEWED: 'DOCUMENT_PREVIEWED',
  TEMPLATE_PREVIEWED: 'TEMPLATE_PREVIEWED',
  DOCUMENT_RENDERED: 'DOCUMENT_RENDERED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT_DOWNLOADED',
  DOCUMENT_DRAFT_SAVED: 'DOCUMENT_DRAFT_SAVED',
  DOCUMENT_SUBMITTED: 'DOCUMENT_SUBMITTED',
  DOCUMENT_REVIEW_STARTED: 'DOCUMENT_REVIEW_STARTED',
  DOCUMENT_REVIEW_UPDATED: 'DOCUMENT_REVIEW_UPDATED',
  DOCUMENT_TECHNICAL_SIGNATURE_SELECTED: 'DOCUMENT_TECHNICAL_SIGNATURE_SELECTED',
  DOCUMENT_REVIEW_FINALIZED: 'DOCUMENT_REVIEW_FINALIZED',
} as const;

export const OPERATOR_HANDOFF_DOCUMENT_TYPES = [
  'WORK_ORDER',
  'TECHNICAL_REPORT',
  'TECHNICAL_OPINION',
  'BUDGET',
  'PMOC',
] as const;

/**
 * Documentos que o Operator pode iniciar sem uma atribuição da gestão e
 * concluir em campo sem revisão editorial posterior.
 */
export const OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES = [
  'WORK_ORDER',
  'TECHNICAL_REPORT',
] as const;

/**
 * Documentos que NÃO representam um atendimento/operação com operador: são
 * apenas relatórios. Ao criar, não geram Assignment nem ficam nas visões
 * operacionais (Operações, Dashboard, Lembretes). O Recibo é emitido só na
 * plataforma e nunca indica um operador executor.
 */
export const DOCUMENT_ONLY_DOCUMENT_TYPES = ['RECEIPT'] as const;

/**
 * Documentos que nunca criam a OS (documento WORK_ORDER) automaticamente junto.
 * O RVT e o PMOC são atendimentos de campo legítimos (mantêm operador/assignment),
 * mas geram somente o seu próprio relatório: um atendimento de execução PMOC
 * produz apenas o documento PMOC daquela execução, nunca uma OS junto. A OS, se
 * necessária, é criada depois, manualmente, a partir do relatório.
 */
export const SKIP_AUTO_WORK_ORDER_DOCUMENT_TYPES = ['RECEIPT', 'TECHNICAL_REPORT', 'PMOC'] as const;

// Orçamento (BUDGET) não coleta assinatura do cliente — é apenas uma proposta.
// PMOC também não coleta assinatura do cliente: usa somente o responsável técnico
// (política FIXED), permitindo finalizar sem a assinatura do cliente.
export const CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES = [
  'WORK_ORDER',
] as const;

export const DOCUMENT_MIME_TYPE = 'application/pdf';
export const DOCUMENT_STORAGE_PREFIX = 'documents/operations';
export const DOCUMENT_MAX_SECTIONS = 80;
export const DOCUMENT_MAX_COMPONENTS = 600;
export const DOCUMENT_MAX_TABLE_ROWS = 400;
export const DOCUMENT_MAX_PAGES = 80;
export const DOCUMENT_MAX_PDF_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_PAGE = {
  width: 595.28,
  height: 841.89,
  marginTop: 48,
  marginRight: 42,
  marginBottom: 54,
  marginLeft: 42,
  headerHeight: 168,
  footerHeight: 34,
} as const;

export const FINANCIAL_DOCUMENT_TYPES = ['QUOTE', 'RECEIPT'] as const;
