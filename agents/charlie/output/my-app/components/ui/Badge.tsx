import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'yes' | 'no' | 'outline' | 'secondary';
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2',
          {
            'border-transparent bg-accent text-white': variant === 'default',
            'border-transparent bg-yes text-white': variant === 'yes',
            'border-transparent bg-no text-white': variant === 'no',
            'border-border bg-transparent text-text-secondary': variant === 'outline',
            'border-transparent bg-surface text-text-secondary': variant === 'secondary',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { Badge };
