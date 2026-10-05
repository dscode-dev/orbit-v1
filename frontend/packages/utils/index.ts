/**
 * @erp/utils — shared, framework-agnostic helpers used by both apps.
 * No app-specific logic lives here.
 */
export { cn } from "./cn";
export * from "./format";
export * from "./export";
export * from "./currency-words";
export { dataUrlToFile } from "./data-url";
export { MIN_PASSWORD_LENGTH } from "./password";
export { cnpjDigits, isValidCnpj } from "./cnpj";
export { useDebounce } from "./use-debounce";
export { useLocalDraft, type LocalDraft, type StoredDraft } from "./use-local-draft";
