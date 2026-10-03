'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, Sparkles, Trash2, TriangleAlert, Wrench } from 'lucide-react';
import { Markdown } from '@/components/data/markdown';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { cn } from '@/lib/utils';

/**
 * The assistant, as a launcher in the corner of every page.
 *
 * It lives in the shell rather than on a route of its own, which is what
 * makes it useful: a question about a number is asked while looking at the
 * number, and navigating the dashboard underneath does not interrupt the
 * conversation — the shell is a layout, so it does not remount between
 * pages and the thread survives.
 *
 * Motion is deliberate rather than decorative. The panel grows from the
 * launcher so the two read as one object; replies type out so the answer can
 * be read as it arrives instead of appearing as a wall; and every one of
 * those effects is dropped under `prefers-reduced-motion`.
 */

type Trace = { name: string; args: Record<string, unknown>; summary: string; ok: boolean };
type Turn = { role: 'user' | 'model'; text: string; trace?: Trace[]; animate?: boolean };

const SUGGESTIONS = [
  'What did we spend in the last 30 days?',
  'Top 5 accounts by spend',
  'Search terms with 20+ clicks and no conversions',
  'What needs my attention today?',
  'Which assignments are over their CPL?',
];

/** Characters per second for the reveal; fast enough not to feel like waiting. */
const TYPE_CPS = 180;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/**
 * Where the typewriter should stop.
 *
 * Only the leading prose is typed. Markdown is parsed on every frame, so
 * typing through a table would render half-built rows as paragraphs and then
 * snap them into a grid — motion that looks like a bug. The model is
 * instructed to lead with the answer, so the first block is the sentence
 * worth revealing, and the structure behind it fades in once.
 */
function leadLength(text: string): number {
  const stop = text.search(/\n\s*\n|\n\s*[|\-*#]|\n\s*\d+\./);
  return stop === -1 ? text.length : stop;
}

function Typewriter({ text, onTick }: { text: string; onTick: () => void }) {
  const reduced = usePrefersReducedMotion();
  const lead = leadLength(text);
  const [shown, setShown] = useState(reduced ? text.length : 0);

  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const chars = Math.floor(((now - started) / 1000) * TYPE_CPS);
      if (chars >= lead) {
        setShown(text.length);
        onTick();
        return;
      }
      setShown(chars);
      onTick();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, lead, reduced, onTick]);

  if (shown >= text.length) return <Markdown>{text}</Markdown>;
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {text.slice(0, shown)}
      <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-current animate-caret-blink" />
    </p>
  );
}

function TraceList({ trace }: { trace: Trace[] }) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <Wrench className="h-3 w-3" aria-hidden="true" />
        {trace.length} lookup{trace.length === 1 ? '' : 's'}
        <ChevronDown
          className={cn('h-3 w-3 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul className="mt-1.5 animate-fade-in space-y-1 border-l pl-2.5 text-[11px]">
          {trace.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {t.ok ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <code className="font-medium">{t.name}</code>
                <span className="text-muted-foreground"> — {t.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssistantWidget() {
  const { can, user } = usePermissions();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const allowed = can('ASSISTANT', 'VIEW');

  const { data: config } = useApi<{ available: boolean }>(
    ['assistant-config'],
    '/api/assistant',
    { enabled: allowed && open, staleTime: 5 * 60_000 }
  );

  // Pinned to the bottom as content grows, including on every typed frame.
  const stickToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(stickToBottom, [turns, busy, stickToBottom]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!allowed) return null;

  function close() {
    // Let the exit animation finish before unmounting, or the panel vanishes.
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 150);
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setDraft('');
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const answer = await apiSend<{ text: string; trace: Trace[] }>('/api/assistant', 'POST', {
        message: question,
        history,
      });
      setTurns((prev) => [
        ...prev,
        { role: 'model', text: answer.text, trace: answer.trace, animate: true },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not answer.');
    } finally {
      setBusy(false);
    }
  }

  const unavailable = config && !config.available;

  return (
    <>
      {/* ── Panel ── */}
      {(open || closing) && (
        <div
          role="dialog"
          aria-label="Ads CRM assistant"
          className={cn(
            'fixed bottom-20 right-4 z-50 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-elevation-3',
            'origin-bottom-right',
            // Full-bleed on a phone: a 400px panel in a corner is unusable at
            // 360px wide. `left-4 … sm:left-auto` rather than `inset-x-4 …
            // sm:inset-x-auto`, because the latter also resets `right` — and
            // media-query rules win over the base `right-4`, which parked the
            // whole panel against the left edge of the screen.
            'left-4 top-20 sm:left-auto sm:top-auto sm:h-[min(34rem,calc(100dvh-7rem))] sm:w-[25rem]',
            closing ? 'animate-panel-out' : 'animate-panel-in'
          )}
        >
          {/* Header */}
          <div className="relative shrink-0 overflow-hidden bg-primary px-4 py-3 text-primary-foreground">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent"
            />
            <div className="relative flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                <Bot className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">Ads Assistant</p>
                <p className="truncate text-[11px] leading-tight text-primary-foreground/75">
                  Reporting &amp; workflow, read-only
                </p>
              </div>
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTurns([]);
                    setError(null);
                  }}
                  aria-label="Clear the conversation"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-primary-foreground/70 transition-all duration-200 hover:bg-white/15 hover:text-primary-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close the assistant"
                className="flex h-7 w-7 items-center justify-center rounded-full text-primary-foreground/70 transition-all duration-200 hover:bg-white/15 hover:text-primary-foreground"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
            aria-live="polite"
            aria-atomic="false"
          >
            {unavailable && (
              <div className="animate-fade-in rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                Gemini is not configured, so the assistant cannot answer. Integrations health will
                confirm it.
              </div>
            )}

            {turns.length === 0 && !unavailable && (
              <div className="animate-fade-in-up space-y-3 px-1 pt-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">
                    Hello {user.name.split(' ')[0]} — what would you like to know?
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Every figure comes from the same functions the dashboards use, within what your
                  role can already see. I read only — I cannot change anything.
                </p>
              </div>
            )}

            {turns.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  'flex animate-bubble-in gap-2',
                  turn.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {turn.role === 'model' && (
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                )}
                <div
                  className={cn(
                    'min-w-0 max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                    turn.role === 'user'
                      ? 'rounded-br-md bg-primary text-primary-foreground'
                      : 'rounded-bl-md border bg-muted/40'
                  )}
                >
                  {turn.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                  ) : (
                    <>
                      {turn.animate ? (
                        <Typewriter text={turn.text} onTick={stickToBottom} />
                      ) : (
                        <Markdown>{turn.text}</Markdown>
                      )}
                      <TraceList trace={turn.trace ?? []} />
                    </>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex animate-bubble-in gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border bg-muted/40 px-3 py-2.5">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 rounded-full bg-foreground animate-typing-dot"
                      style={{ animationDelay: `${d * 160}ms` }}
                    />
                  ))}
                  <span className="sr-only">Looking it up</span>
                </div>
              </div>
            )}

            {error && (
              <div className="animate-fade-in rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* Suggestions */}
          {turns.length === 0 && !unavailable && (
            <div className="shrink-0 overflow-x-auto border-t px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max gap-1.5">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    disabled={busy}
                    style={{ animationDelay: `${i * 45}ms` }}
                    className="animate-fade-in-up whitespace-nowrap rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="flex shrink-0 items-end gap-2 border-t p-2.5">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              disabled={Boolean(unavailable)}
              // Short enough not to wrap in the one-row composer at 358px,
              // which clipped the second line behind the send button.
              placeholder="Ask a question…"
              aria-label="Your question"
              className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow duration-200 placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send(draft)}
              disabled={busy || !draft.trim() || Boolean(unavailable)}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all duration-200 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* ── Launcher ── */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? 'Close the assistant' : 'Open the assistant'}
        aria-expanded={open}
        className={cn(
          'group fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground shadow-elevation-3',
          'transition-all duration-300 ease-premium hover:scale-105 active:scale-95'
        )}
      >
        {/* A slow halo, so the button is findable without being noisy. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-primary/40 animate-pulse-glow motion-reduce:hidden"
        />
        <span className="relative flex items-center justify-center">
          <Bot
            className={cn(
              'absolute h-6 w-6 transition-all duration-300 ease-premium',
              open ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
            )}
            aria-hidden="true"
          />
          <ChevronDown
            className={cn(
              'h-6 w-6 transition-all duration-300 ease-premium',
              open ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            )}
            aria-hidden="true"
          />
        </span>
      </button>
    </>
  );
}
