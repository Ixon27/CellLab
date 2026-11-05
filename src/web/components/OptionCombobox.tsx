import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CatalogCategory, CatalogOption } from '../../shared/catalog';
import { loadCatalog } from '../state/catalog';
import { inputCls } from './Dialog';

/** Options of a category, refreshed whenever the list is opened. */
function useCatalogOptions(category: CatalogCategory, open: boolean): CatalogOption[] {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCatalog(category).then((list) => alive && setOptions(list)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [category, open]);
  return options;
}

interface Row {
  label: string;
  custom: boolean;
}

/**
 * Text input with a filtered dropdown of catalog options. Free text is always accepted;
 * when nothing matches exactly, the last row offers `직접 입력: "<text>"`.
 */
function useOptionList(category: CatalogCategory, query: string, open: boolean, exclude: readonly string[] = []) {
  const options = useCatalogOptions(category, open);
  return useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(exclude.map((v) => v.toLowerCase()));
    const rows: Row[] = options
      .filter((o) => !taken.has(o.label.toLowerCase()) && (!q || o.label.toLowerCase().includes(q)))
      .map((o) => ({ label: o.label, custom: false }));
    if (q && !options.some((o) => o.label.toLowerCase() === q)) rows.push({ label: query.trim(), custom: true });
    return rows;
  }, [options, query, exclude]);
}

function OptionList({ id, rows, active, onPick }: { id: string; rows: Row[]; active: number; onPick(label: string): void }) {
  if (!rows.length) return null;
  return (
    <ul
      id={id}
      role="listbox"
      className="pr-pop absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-pop"
    >
      {rows.map((row, i) => (
        <li
          key={`${row.custom ? 'custom:' : ''}${row.label}`}
          role="option"
          aria-selected={i === active}
          className={`cursor-pointer px-3 py-1.5 text-[13px] ${i === active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'}`}
          // mousedown keeps focus in the input, so blur does not close the list first.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(row.label);
          }}
        >
          {row.custom ? <span className="text-fg-muted">직접 입력: "{row.label}"</span> : row.label}
        </li>
      ))}
    </ul>
  );
}

function useListKeys(rows: Row[], open: boolean, setOpen: (v: boolean) => void, onPick: (label: string) => void) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [rows]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && rows[active]) {
        e.preventDefault();
        onPick(rows[active].label);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };
  return { active, onKeyDown };
}

export function OptionCombobox({
  category,
  value,
  onChange,
  placeholder,
  id,
  disabled,
}: {
  category: CatalogCategory;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const rows = useOptionList(category, value, open);
  const pick = (label: string) => {
    onChange(label);
    setOpen(false);
  };
  const { active, onKeyDown } = useListKeys(rows, open, setOpen, pick);
  return (
    <div className="relative">
      <input
        id={id}
        className={inputCls}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && <OptionList id={listId} rows={rows} active={active} onPick={pick} />}
    </div>
  );
}

/** Same list behaviour for several values; chips stay editable (e.g. `L-glutamine 2 mM`). */
export function OptionMultiSelect({
  category,
  value,
  onChange,
  placeholder,
  id,
  disabled,
}: {
  category: CatalogCategory;
  value: string[];
  onChange(v: string[]): void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rows = useOptionList(category, query, open, value);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = (label: string) => {
    const v = label.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setQuery('');
  };
  const { active, onKeyDown } = useListKeys(rows, open, setOpen, add);
  return (
    <div className="relative">
      <div
        className={`${inputCls} flex flex-wrap items-center gap-1.5 !py-1.5`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {value.map((chip, i) => (
          <span key={i} className="inline-flex items-center rounded-full border border-accent/40 bg-accent-soft pl-2 text-[12px] text-accent">
            <input
              aria-label={`항목 ${i + 1} 편집`}
              className="bg-transparent outline-none"
              size={Math.max(4, chip.length)}
              value={chip}
              disabled={disabled}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
              onBlur={() => {
                if (!chip.trim()) onChange(value.filter((_, j) => j !== i));
              }}
            />
            <button
              type="button"
              className="px-1.5 text-accent/70 hover:text-accent"
              aria-label={`${chip} 제거`}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-fg-dim"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={value.length ? '' : placeholder}
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
            else onKeyDown(e);
          }}
        />
      </div>
      {open && <OptionList id={listId} rows={rows} active={active} onPick={add} />}
    </div>
  );
}
