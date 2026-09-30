'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The table used by every reporting screen.
 *
 * Below `md` it stops being a table: each row renders as a card with labelled
 * fields, because a nine-column metrics grid on a 360px screen is either
 * unreadable or a horizontal scroll nobody discovers. Sorting, search and
 * pagination work identically in both layouts.
 */

/** Widest a column may grow before its content has to truncate. */
const DEFAULT_MAX_COL_WIDTH = '16rem';

export type Column<T> = {
  key: string;
  header: string;
  /** Rendered cell. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null;
  align?: 'left' | 'right';
  /** Hidden in the mobile card layout — used for low-signal columns. */
  hideOnMobile?: boolean;
  className?: string;
  /**
   * Cap this column's width. Table cells size to their content, so one long
   * value — a campaign named
   * "MICA || KAPPLP || 2027 || klp_ca_0002 || …" — stretches its column until
   * every metric is pushed off the right edge. `truncate` alone cannot stop
   * that: it needs something to truncate *against*.
   */
  maxWidth?: string;
};

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T extends { [k: string]: unknown }>({
  rows,
  columns,
  rowKey,
  searchable,
  searchPlaceholder = 'Search…',
  onRowClick,
  pageSize = 25,
  initialSort,
  onExport,
  emptyMessage = 'Nothing to show for this filter.',
  caption,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  initialSort?: SortState;
  onExport?: (format: 'csv' | 'xlsx') => void;
  emptyMessage?: string;
  caption?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query || !searchable) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => searchable(r).toLowerCase().includes(q));
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      // Nulls sort last in both directions: "no data" is never the top or the
      // bottom of a ranking, it is simply absent.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function toggleSort(key: string) {
    setPage(0);
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === 'desc'
          ? { key, dir: 'asc' }
          : null
        : { key, dir: 'desc' }
    );
  }

  return (
    <div className="space-y-3">
      {(searchable || onExport) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              className="h-9 max-w-xs"
              aria-label={searchPlaceholder}
            />
          )}
          {onExport && (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onExport('csv')}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => onExport('xlsx')}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Excel
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Desktop: a real table. */}
      <Card className="hidden overflow-hidden md:block">
        <CardContent className="p-0">
          {/* A horizontally scrollable table gives no hint that it scrolls, so
              a faint edge fade marks where the content continues. */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent"
            />
            <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead className="border-b bg-muted/40">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        col.align === 'right' ? 'text-right' : 'text-left'
                      )}
                      aria-sort={
                        sort?.key === col.key
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            'inline-flex items-center gap-1 hover:text-foreground',
                            col.align === 'right' && 'flex-row-reverse'
                          )}
                        >
                          {col.header}
                          {sort?.key === col.key ? (
                            sort.dir === 'asc' ? (
                              <ArrowUp className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <ArrowDown className="h-3 w-3" aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b transition-colors last:border-0 hover:bg-muted/40',
                      onRowClick && 'cursor-pointer'
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'px-3 py-2.5',
                          col.align === 'right' && 'text-right tabular-nums',
                          col.className
                        )}
                        // No column may outgrow the cap unless it asks to.
                        // Badge and number columns never reach it, so it only
                        // bites on long-text ones — which is the point.
                        // Capping only the first column missed tables whose
                        // identifier sits in column two.
                        style={{ maxWidth: col.maxWidth ?? DEFAULT_MAX_COL_WIDTH }}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-3 py-12 text-center text-muted-foreground"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: one card per row. */}
      <div className="space-y-2 md:hidden">
        {pageRows.map((row) => {
          const [primary, ...rest] = columns;
          return (
            <Card
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && 'cursor-pointer active:bg-muted/50')}
            >
              <CardContent className="space-y-2 p-3.5">
                <div className="font-medium">{primary!.cell(row)}</div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {rest
                    .filter((c) => !c.hideOnMobile)
                    .map((col) => (
                      <div key={col.key} className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {col.header}
                        </dt>
                        <dd className="truncate tabular-nums">{col.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
              </CardContent>
            </Card>
          );
        })}
        {pageRows.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </CardContent>
          </Card>
        )}
      </div>

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
