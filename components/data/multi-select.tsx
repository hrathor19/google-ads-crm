'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type MultiSelectOption = { value: string; label: string; group?: string };

/** How many options are put in the DOM at once. */
const RENDER_LIMIT = 80;

/**
 * A searchable, multi-selectable dropdown.
 *
 * The whole list is filtered in the browser, and — the part that matters —
 * anything already ticked stays visible whatever the search says. Hiding a
 * selection behind a filter is how somebody unticks one without seeing it
 * happen, which the campaign linker learned the hard way.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'Nothing matches.',
  id,
  disabled,
  maxSelected,
  className,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  id?: string;
  disabled?: boolean;
  /** Google caps some of these lists; refuse past the cap rather than erroring later. */
  maxSelected?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const chosen = useMemo(() => new Set(selected), [selected]);
  const labelFor = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options]
  );

  /**
   * Capped, because the location list is every city in India — 2,771 of
   * them. Rendering that many buttons locks the browser for a beat each time
   * a character is typed, and nobody scrolls a list that long anyway: the
   * search box is the way through it. Ticked options are never cut.
   */
  const { visible, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = options.filter(
      (o) => chosen.has(o.value) || !q || o.label.toLowerCase().includes(q)
    );
    return { visible: matches.slice(0, RENDER_LIMIT), hidden: Math.max(0, matches.length - RENDER_LIMIT) };
  }, [options, query, chosen]);

  const grouped = useMemo(() => {
    const map = new Map<string, MultiSelectOption[]>();
    for (const o of visible) {
      const key = o.group ?? '';
      map.set(key, [...(map.get(key) ?? []), o]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const atCap = maxSelected !== undefined && selected.length >= maxSelected;

  const toggle = (value: string) => {
    if (chosen.has(value)) onChange(selected.filter((v) => v !== value));
    else if (!atCap) onChange([...selected, value]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full justify-between font-normal', className)}
        >
          <span className="truncate text-left">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : selected.length === 1 ? (
              (labelFor.get(selected[0]) ?? selected[0])
            ) : (
              `${selected.length} selected`
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <div className="relative border-b p-2">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-7"
            autoComplete="off"
          />
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b p-2">
            {selected.map((v) => (
              <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
                <span className="max-w-40 truncate">{labelFor.get(v) ?? v}</span>
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
                  aria-label={`Remove ${labelFor.get(v) ?? v}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          )}
          {grouped.map(([group, items]) => (
            <div key={group}>
              {group && (
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
              )}
              {items.map((o) => {
                const isOn = chosen.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    disabled={!isOn && atCap}
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                      )}
                    >
                      {isOn && <Check className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {hidden > 0 && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {hidden.toLocaleString('en-IN')} more {'\u2014'} keep typing to narrow it down.
          </p>
        )}

        {atCap && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {maxSelected} is the most this can take. Untick one to add another.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
