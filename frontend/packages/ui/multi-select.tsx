'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type MultiSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Selecione…',
  emptyMessage = 'Nenhum item encontrado.',
  hint,
}: {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Aviso sob o campo — ex.: a lista veio truncada pelo servidor. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(value), [value]);
  const visible = options.filter((option) =>
    `${option.label} ${option.description ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function toggle(option: MultiSelectOption) {
    if (option.disabled) return;
    onChange(
      selected.has(option.value)
        ? value.filter((item) => item !== option.value)
        : [...value, option.value],
    );
  }

  return (
    <div ref={root} className="relative grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-left font-normal"
      >
        <span className={value.length ? '' : 'text-[var(--color-muted-foreground)]'}>
          {value.length ? `${value.length} selecionado(s)` : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {hint && <span className="text-caption font-normal">{hint}</span>}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options
            .filter((option) => selected.has(option.value))
            .slice(0, 4)
            .map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => toggle(option)}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--color-primary)]/10 px-2 py-1 text-xs font-normal text-[var(--color-primary)]"
              >
                <span className="truncate">{option.label}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))}
          {value.length > 4 && <span className="text-caption">+{value.length - 4}</span>}
        </div>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-[var(--shadow-floating)]">
          <label className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2">
            <Search className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar…"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div role="listbox" aria-multiselectable className="mt-2 max-h-64 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="p-3 text-center text-caption">{emptyMessage}</p>
            ) : (
              visible.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected.has(option.value)}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => toggle(option)}
                  className="flex w-full items-start gap-2 rounded-[var(--radius-md)] p-2 text-left font-normal hover:bg-[var(--color-muted)] disabled:opacity-50"
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${selected.has(option.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}`}>
                    {selected.has(option.value) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm">{option.label}</span>
                    {option.description && <span className="block text-caption">{option.description}</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
