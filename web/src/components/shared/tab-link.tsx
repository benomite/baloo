import Link from 'next/link';
import { cn } from '@/lib/utils';

// `<TabLink>` : tab "underline" style Linear / Stripe Dashboard. Trait
// coloré primary sous le tab actif, hover doux. À utiliser dans une
// `<div className="flex gap-6 border-b">` qui sert de barre de tabs.

interface TabLinkProps {
  href: string;
  active: boolean;
  children: React.ReactNode;
}

export function TabLink({ href, active, children }: TabLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        '-mb-px border-b-2 pb-2 pt-1 px-1 text-sm transition-colors',
        active
          ? 'border-primary text-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
      )}
    >
      {children}
    </Link>
  );
}
