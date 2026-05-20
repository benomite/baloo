'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import { InstallButton } from '@/components/pwa/install-button';
import { SyncStatusButton } from '@/components/sync/sync-status-button';
import { cn } from '@/lib/utils';
import { DESKTOP_GROUPS, visibleItemsForRole } from './nav-config';

interface SidebarProps {
  role: string;
  groupName?: string | null;
  inboxCount?: number;
}

export function Sidebar({ role, groupName, inboxCount = 0 }: SidebarProps) {
  const counts: Record<'inbox', number> = {
    inbox: inboxCount,
  };

  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="w-[260px] shrink-0 flex flex-col h-full">
      {/* Wordmark : écusson dégradé brand + Baloo + groupe */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'relative h-9 w-9 shrink-0 rounded-xl flex items-center justify-center',
              'bg-gradient-to-br from-brand to-[oklch(0.22_0.08_252)]',
              'shadow-sm shadow-brand/20 ring-1 ring-inset ring-white/10',
            )}
            aria-hidden
          >
            <span className="text-[15px] leading-none">🐻</span>
            <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-transparent to-white/15 pointer-events-none" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-display text-[15px] font-medium tracking-tight text-fg truncate">
              Baloo
            </div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-fg-muted truncate">
              {groupName ? `Compta · ${groupName}` : 'Compta SGDF'}
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 [scrollbar-gutter:stable]">
        {DESKTOP_GROUPS.map((group) => {
          const items = visibleItemsForRole(group.items, role);
          if (items.length === 0) return null;
          return (
            <div key={group.intent} className="mt-5 first:mt-1">
              <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      icon={item.icon}
                      active={isActive(item.href)}
                      badge={item.badgeKey ? counts[item.badgeKey] : undefined}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer : install PWA si proposable + Sync (admins) + Aide */}
      <div className="border-t border-border-soft p-2 space-y-2">
        <div className="px-1">
          <InstallButton />
        </div>
        {/* Sync incrémentale Comptaweb — admins uniquement (cf. Phase 2
            pivot miroir strict). Mount = auto-check + auto-run si stale. */}
        {(role === 'tresorier' || role === 'RG') && (
          <div className="px-1">
            <SyncStatusButton />
          </div>
        )}
        <NavLink href="/aide" icon={CircleHelp} active={pathname === '/aide'} variant="subtle">
          Aide & guide
        </NavLink>
      </div>
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  active: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'subtle';
  // Compteur optionnel rendu en pastille à droite (badge "12").
  badge?: number;
}

function NavLink({
  href,
  icon: Icon,
  active,
  children,
  variant = 'default',
  badge,
}: NavLinkProps) {
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-all duration-100',
        active
          ? variant === 'default'
            ? 'bg-brand-50 text-brand shadow-[inset_2px_0_0_var(--brand)]'
            : 'bg-fg/[0.06] text-fg'
          : 'text-fg-muted hover:text-fg hover:bg-fg/[0.035]',
      )}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2.25 : 1.75}
        className={cn(
          'shrink-0',
          active
            ? variant === 'default'
              ? 'text-brand'
              : 'text-fg'
            : 'text-fg-subtle group-hover:text-fg-muted',
        )}
      />
      <span className="truncate flex-1">{children}</span>
      {showBadge && (
        <span
          className={cn(
            'ml-auto inline-flex shrink-0 items-center justify-center rounded-full',
            'min-w-[18px] h-[18px] px-1.5 text-[10.5px] font-semibold tabular-nums',
            active
              ? 'bg-brand text-white'
              : 'bg-brand-50 text-brand group-hover:bg-brand-100',
          )}
          aria-label={`${badge} à traiter`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
