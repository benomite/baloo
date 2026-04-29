'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  // Rôles autorisés à voir cet item. Si absent ou vide, visible par tous.
  roles?: string[];
}

const nav: NavItem[] = [
  { href: '/', label: 'Tableau de bord', icon: '📊' },
  { href: '/ecritures', label: 'Écritures', icon: '📒' },
  { href: '/remboursements', label: 'Remboursements', icon: '💶' },
  { href: '/depot', label: 'Déposer un justif', icon: '📎', roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { href: '/depots', label: 'Dépôts à traiter', icon: '📨', roles: ['tresorier', 'RG'] },
  { href: '/caisse', label: 'Caisse', icon: '🪙', roles: ['tresorier', 'RG'] },
  { href: '/import', label: 'Import Comptaweb', icon: '📥', roles: ['tresorier', 'RG'] },
  { href: '/admin/invitations', label: 'Invitations', icon: '✉️', roles: ['tresorier', 'RG'] },
  { href: '/moi', label: 'Mon espace', icon: '👤', roles: ['parent'] },
];

interface Props {
  role: string;
}

export function Sidebar({ role }: Props) {
  const pathname = usePathname();

  const items = nav.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <aside className="w-64 border-r bg-muted/30 p-4 flex flex-col gap-1">
      <div className="font-bold text-lg mb-6 px-3">Baloo Compta</div>
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
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
