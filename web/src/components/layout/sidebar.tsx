'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react';
import { InstallButton } from '@/components/pwa/install-button';
import { SyncStatusButton } from '@/components/sync/sync-status-button';
import { cn } from '@/lib/utils';
import {
  DESKTOP_GROUPS,
  resolveNavItem,
  visibleItemsForRole,
  type NavGroup,
} from './nav-config';

interface SidebarProps {
  role: string;
  groupName?: string | null;
}

export function Sidebar({ role, groupName }: SidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="w-[260px] shrink-0 flex flex-col h-full">
      {/* Wordmark */}
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
        {DESKTOP_GROUPS.map((g) => (
          <NavSection key={g.key} group={g} role={role} isActive={isActive} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-soft p-2 space-y-2">
        <div className="px-1">
          <InstallButton />
        </div>
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

function NavSection({
  group,
  role,
  isActive,
}: {
  group: NavGroup;
  role: string;
  isActive: (href: string) => boolean;
}) {
  const items = visibleItemsForRole(group.items, role);
  const [open, setOpen] = useState(!group.defaultCollapsed);
  if (items.length === 0) return null;

  const list = (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const resolved = resolveNavItem(item, role);
        return (
          <li key={resolved.href}>
            <NavLink href={resolved.href} icon={resolved.icon} active={isActive(resolved.href)}>
              {resolved.label}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );

  if (!group.collapsible) {
    return (
      <div className="mt-5 first:mt-1">
        <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
          {group.title}
        </div>
        {list}
      </div>
    );
  }

  return (
    <div className="mt-5 first:mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle hover:text-fg-muted transition-colors"
      >
        <ChevronDown
          size={11}
          strokeWidth={2.5}
          className={cn('transition-transform', open ? '' : '-rotate-90')}
        />
        {group.title}
      </button>
      {open && list}
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  active: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'subtle';
}

function NavLink({ href, icon: Icon, active, children, variant = 'default' }: NavLinkProps) {
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
    </Link>
  );
}
