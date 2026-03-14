import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from './utils';

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ children, ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger ref={ref} asChild {...props}>
    {children}
  </DropdownMenuPrimitive.Trigger>
));
DropdownTrigger.displayName = 'DropdownTrigger';

const DropdownContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, align = 'start', children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
));
DropdownContent.displayName = 'DropdownContent';

const DropdownItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    onClick?: () => void;
  }
>(({ className, disabled, onClick, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
      'focus:bg-accent',
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
      className,
    )}
    disabled={disabled}
    onSelect={(e) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      onClick?.();
    }}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.Item>
));
DropdownItem.displayName = 'DropdownItem';

export { DropdownMenu, DropdownTrigger, DropdownContent, DropdownItem };
