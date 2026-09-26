'use client';

/**
 * Seleção de UM registro com lista paginada sob demanda.
 *
 * Existe porque os `<select>` dos wizards carregavam uma página fixa (limit
 * 100) e escondiam o resto da base: com mais de 100 clientes, os excedentes
 * sumiam do orçamento, da operação, do recibo.
 *
 * O comportamento é o de uma lista normal: abre mostrando os primeiros e vai
 * carregando o restante conforme o usuário rola até o fim — sem obrigar
 * ninguém a digitar. A busca fica disponível para quem quiser ir direto ao
 * ponto, e nesse caso a paginação recomeça filtrada pelo servidor.
 *
 * O rótulo do item já selecionado é preservado mesmo que ele não esteja nas
 * páginas carregadas — importante ao editar um registro antigo.
 */
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
};

export type ComboboxPage = {
  options: ComboboxOption[];
  /** Total no servidor: define se ainda há página seguinte. */
  total?: number;
};

export type ComboboxQuery = { search: string; page: number };

const DEBOUNCE_MS = 300;
/** Distância do fim da lista que dispara a próxima página. */
const SCROLL_THRESHOLD_PX = 48;

export function EntityCombobox({
  label,
  value,
  onChange,
  fetchOptions,
  selectedOption,
  placeholder = 'Selecione…',
  emptyMessage = 'Nenhum item encontrado.',
  clearLabel,
  disabled = false,
  hint,
}: {
  /** Vazio esconde o rótulo (útil quando o campo já vive dentro de um Field). */
  label?: string;
  value: string;
  onChange: (value: string, option?: ComboboxOption) => void;
  /** Uma página do servidor. `search` vazio = lista completa, paginada. */
  fetchOptions: (query: ComboboxQuery, signal: AbortSignal) => Promise<ComboboxPage>;
  /** Rótulo do valor atual quando ele não está nas páginas carregadas. */
  selectedOption?: ComboboxOption | null;
  placeholder?: string;
  emptyMessage?: string;
  /** Quando definido, oferece uma opção para limpar a seleção. */
  clearLabel?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [known, setKnown] = useState<ComboboxOption | null>(selectedOption ?? null);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedOption) setKnown(selectedOption);
  }, [selectedOption]);

  // Carrega a página atual. Página 1 substitui a lista; as demais acrescentam.
  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError(false);
        fetchOptions({ search: search.trim(), page }, controller.signal)
          .then((result) => {
            setTotal(result.total ?? null);
            setOptions((current) =>
              page === 1
                ? result.options
                : // Concatena sem repetir: páginas podem se sobrepor se a base
                  // mudar entre as requisições.
                  [
                    ...current,
                    ...result.options.filter(
                      (option) => !current.some((item) => item.value === option.value),
                    ),
                  ],
            );
          })
          .catch((cause) => {
            if ((cause as Error)?.name !== 'AbortError') setError(true);
          })
          .finally(() => setLoading(false));
      },
      search && page === 1 ? DEBOUNCE_MS : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, page, disabled, fetchOptions]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const hasMore = total !== null && options.length < total;

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list || loading || !hasMore) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - SCROLL_THRESHOLD_PX) {
      setPage((current) => current + 1);
    }
  }, [loading, hasMore]);

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    if (known?.value === value) return known.label;
    return options.find((option) => option.value === value)?.label ?? '';
  }, [value, known, options]);

  const choose = useCallback(
    (option: ComboboxOption | null) => {
      setKnown(option);
      onChange(option?.value ?? '', option ?? undefined);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  return (
    <div ref={root} className="relative grid gap-1.5 text-sm font-medium">
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label || placeholder}
        onClick={() =>
          setOpen((current) => {
            if (!current) {
              setSearch('');
              setPage(1);
            }
            return !current;
          })
        }
        className="flex h-9 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-left font-normal outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
      >
        <span className={`truncate ${selectedLabel ? '' : 'text-[var(--color-muted-foreground)]'}`}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {hint && !open && <span className="text-caption font-normal">{hint}</span>}

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-[var(--shadow-floating)]">
          <label className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
            <input
              autoFocus
              value={search}
              // Busca e página mudam juntas: reiniciar a paginação num efeito
              // à parte gerava uma requisição com a página anterior.
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar (opcional)…"
              className="h-full min-w-0 flex-1 bg-transparent text-sm font-normal outline-none"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />}
          </label>

          <div ref={listRef} onScroll={onScroll} role="listbox" className="mt-2 max-h-64 overflow-y-auto">
            {clearLabel && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose(null)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-md)] p-2 text-left text-sm font-normal text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              >
                <X className="h-3.5 w-3.5 shrink-0" /> {clearLabel}
              </button>
            )}
            {error ? (
              <p className="p-3 text-center text-caption">Não foi possível carregar. Tente de novo.</p>
            ) : options.length === 0 && !loading ? (
              <p className="p-3 text-center text-caption">{emptyMessage}</p>
            ) : (
              options.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  key={option.value}
                  onClick={() => choose(option)}
                  className="flex w-full items-start gap-2 rounded-[var(--radius-md)] p-2 text-left font-normal hover:bg-[var(--color-muted)]"
                >
                  <span className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]">
                    {option.value === value && <Check className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{option.label}</span>
                    {option.description && <span className="block truncate text-caption">{option.description}</span>}
                  </span>
                </button>
              ))
            )}
            {hasMore && (
              <p className="flex items-center justify-center gap-2 p-2 text-caption">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Carregando mais… ({options.length} de {total})
              </p>
            )}
          </div>

          {!hasMore && total !== null && options.length > 0 && (
            <p className="mt-1 border-t border-[var(--color-border)] px-2 pt-2 text-caption font-normal">
              {options.length} {options.length === 1 ? 'item' : 'itens'}
              {search ? ' encontrados' : ' no total'}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
