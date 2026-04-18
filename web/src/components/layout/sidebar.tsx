'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/', label: 'Tableau de bord', icon: '📊' },
  { href: '/ecritures', label: 'Écritures', icon: '📒' },
  { href: '/remboursements', label: 'Remboursements', icon: '💶' },
  { href: '/caisse', label: 'Caisse', icon: '🪙' },
  { href: '/import', label: 'Import Comptaweb', icon: '📥' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-muted/30 p-4 flex flex-col gap-1">
      <div className="font-bold text-lg mb-6 px-3">Baloo Compta</div>
      {nav.map(item => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
