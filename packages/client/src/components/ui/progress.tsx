import * as React from 'react';
import { cn } from './utils';

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value?: number; max?: number }
>(({ className, value = 0, max = 100, ...props }, ref) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      ref={ref}
      role="progressbar" // NOSONAR - styled div from shadcn/ui, intentional for styling control
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
});
Progress.displayName = 'Progress';

export { Progress };
