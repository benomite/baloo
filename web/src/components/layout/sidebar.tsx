'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  CircleUser,
  Coins,
  Download,
  Gift,
  HandCoins,
  Inbox,
  LayoutDashboard,
  Mail,
  Paperclip,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Rôles autorisés à voir cet item. Si absent ou vide, visible par tous.
  roles?: string[];
}

const nav: NavItem[] = [
  { href: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/ecritures', label: 'Écritures', icon: BookOpen },
  { href: '/remboursements', label: 'Remboursements', icon: HandCoins },
  { href: '/depot', label: 'Déposer un justif', icon: Paperclip, roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { href: '/depots', label: 'Dépôts à traiter', icon: Inbox, roles: ['tresorier', 'RG'] },
  { href: '/abandons', label: 'Abandons de frais', icon: Gift, roles: ['tresorier', 'RG'] },
  { href: '/caisse', label: 'Caisse', icon: Coins, roles: ['tresorier', 'RG'] },
  { href: '/import', label: 'Import Comptaweb', icon: Download, roles: ['tresorier', 'RG'] },
  { href: '/admin/invitations', label: 'Invitations', icon: Mail, roles: ['tresorier', 'RG'] },
  { href: '/moi', label: 'Mon espace', icon: CircleUser },
];

interface Props {
  role: string;
}

export function Sidebar({ role }: Props) {
  const pathname = usePathname();

  const items = nav.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <aside className="w-64 border-r bg-muted/20 p-4 flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5 mb-6 px-2">
        <div
          className="h-8 w-8 rounded-full flex items-center justify-center text-base shrink-0"
          style={{ backgroundColor: 'oklch(0.34 0.10 252 / 0.12)' }}
          aria-hidden
        >
          🐻
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold tracking-tight text-foreground">Baloo</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Compta SGDF
          </span>
        </div>
      </div>
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
              active
                ? 'bg-secondary text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon size={16} className="shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
