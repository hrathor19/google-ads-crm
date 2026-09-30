import { cn } from '@/lib/utils';

/**
 * Loading placeholder. Uses the shared `skeleton-shimmer` sweep from
 * globals.css so every loading state in the app moves the same way.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('skeleton-shimmer rounded-md bg-muted/70', className)}
      {...props}
    />
  );
}

export { Skeleton };
