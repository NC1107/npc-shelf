import { useState, useRef, useEffect, type ReactNode } from 'react';
import { cn } from './utils';

interface DropdownMenuProps {
  children: ReactNode;
}

interface DropdownTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

interface DropdownContentProps {
  children: ReactNode;
  align?: 'start' | 'end';
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block">
      <DropdownContext.Provider value={{ open, setOpen }}>
        {children}
      </DropdownContext.Provider>
    </div>
  );
}

import { createContext, useContext } from 'react';

const DropdownContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function DropdownTrigger({ children }: DropdownTriggerProps) {
  const { open, setOpen } = useContext(DropdownContext);
  return (
    <div onClick={() => setOpen(!open)} className="cursor-pointer">
      {children}
    </div>
  );
}

export function DropdownContent({ children, align = 'start' }: DropdownContentProps) {
  const { open, setOpen } = useContext(DropdownContext);
  if (!open) return null;

  return (
    <div
      className={cn(
        'absolute z-50 mt-1 min-w-[160px] rounded-md border bg-popover p-1 shadow-lg',
        align === 'end' ? 'right-0' : 'left-0',
      )}
      onClick={() => setOpen(false)}
    >
      {children}
    </div>
  );
}

export function DropdownItem({ children, onClick, disabled, className }: DropdownItemProps) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent cursor-pointer',
        className,
      )}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
