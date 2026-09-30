import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">{title}</p>
          {description && (
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">That did not load</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error.message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Try again
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/** Table skeleton sized to the real column count so the layout doesn't jump. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="space-y-px">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-4 px-4 py-3">
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton
                  key={c}
                  className="h-4"
                  style={{ width: c === 0 ? '22%' : `${Math.max(8, 60 / columns)}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
