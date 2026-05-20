'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { visibleTabsForRole } from './nav-config';

interface BottomNavProps {
  role: string;
  /** Callback pour ouvrir le drawer "Plus" (gestion trésorier sur mobile). */
  onOpenMore?: () => void;
}

export function BottomNav({ role, onOpenMore }: BottomNavProps) {
  const pathname = usePathname();
  const tabs = visibleTabsForRole(role);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Navigation principale"
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const isPlus = tab.key === 'plus';
          const active = !isPlus && (tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href));
          const Icon = tab.icon;
          const inner = (
            <span className={cn('flex flex-col items-center gap-0.5 py-2', active ? 'text-brand' : 'text-fg-muted')}>
              <Icon size={20} strokeWidth={2} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </span>
          );
          return (
            <li key={tab.key} className="flex-1 text-center">
              {isPlus ? (
                <button type="button" onClick={onOpenMore} aria-label="Plus d options" className="w-full">
                  {inner}
                </button>
              ) : (
                <Link href={tab.href}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
