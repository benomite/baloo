import {
  BookOpen, Bot, Coins, Ellipsis, FileText, Files, Gift, HandCoins, Link2, Mail,
  Paperclip, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export type Role = 'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent';
export type GroupKey = 'process' | 'comptabilite' | 'administration';

const ADMIN: Role[] = ['tresorier', 'RG'];
const SUBMITTERS: Role[] = ['tresorier', 'RG', 'chef', 'equipier'];

export function isAdminRole(role: string): boolean {
  return role === 'tresorier' || role === 'RG';
}

export interface NavItem {
  /** href par défaut (membre non-admin, non-parent). */
  href: string;
  /** href admin (ex. Déposer → liste /depots). */
  adminHref?: string;
  /** href parent (ex. Mes reçus → /). */
  parentHref?: string;
  /** libellé par défaut. */
  label: string;
  /** libellé admin. */
  adminLabel?: string;
  /** libellé parent. */
  parentLabel?: string;
  icon: LucideIcon;
  /** Rôles autorisés. Absent = tous les rôles authentifiés. */
  roles?: Role[];
}

export interface NavGroup {
  key: GroupKey;
  title: string;
  /** Bloc repliable (Administration). */
  collapsible?: boolean;
  /** Replié par défaut. */
  defaultCollapsed?: boolean;
  items: NavItem[];
}

export interface ResolvedNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Desktop : façade « process » (filtrée par rôle, items role-switched) +
// groupe « Comptabilité » (admins) + bloc « Administration » repliable
// (système). /cloture reste hors nav (accès par lien direct).
// Suite ADR-033 / 034, puis réintroduction du groupe Comptabilité + /inbox.
export const DESKTOP_GROUPS: NavGroup[] = [
  {
    key: 'process',
    title: 'Process',
    items: [
      { href: '/depot', adminHref: '/depots', label: 'Déposer', adminLabel: 'Dépôts', icon: Paperclip, roles: SUBMITTERS },
      { href: '/remboursements', parentHref: '/', label: 'Mes demandes', adminLabel: 'Remboursements', parentLabel: 'Mes reçus', icon: HandCoins },
      { href: '/abandons', label: 'Abandons', icon: Gift, roles: SUBMITTERS },
    ],
  },
  {
    key: 'comptabilite',
    title: 'Comptabilité',
    items: [
      { href: '/ecritures', label: 'Écritures', icon: BookOpen, roles: ADMIN },
      { href: '/caisse', label: 'Caisse', icon: Coins, roles: ADMIN },
      { href: '/inbox', label: 'Justificatifs', icon: Files, roles: ADMIN },
    ],
  },
  {
    key: 'administration',
    title: 'Administration',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: '/import', label: 'Configs Comptaweb', icon: Link2, roles: ADMIN },
      { href: '/moi/connexions', label: 'Connexion Claude', icon: Bot, roles: ADMIN },
      { href: '/admin/invitations', label: 'Membres', icon: Mail, roles: ADMIN },
      { href: '/admin/errors', label: "Journal d'erreurs", icon: ShieldAlert, roles: ADMIN },
    ],
  },
];

/** Résout href + label d'un item selon le rôle (admin / parent / défaut). */
export function resolveNavItem(item: NavItem, role: string): ResolvedNavItem {
  const admin = isAdminRole(role);
  let href = item.href;
  if (role === 'parent' && item.parentHref) href = item.parentHref;
  else if (admin && item.adminHref) href = item.adminHref;

  let label = item.label;
  if (role === 'parent' && item.parentLabel) label = item.parentLabel;
  else if (admin && item.adminLabel) label = item.adminLabel;

  return { href, label, icon: item.icon };
}

export interface MobileTab {
  key: 'depot' | 'recus' | 'demandes' | 'abandons' | 'plus';
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

// Mobile : process en bas + tiroir « Plus » (admins). L'ordre du tableau =
// ordre d'affichage. 'recus' (parent, → /) placé avant 'demandes' pour que le
// parent ait bien son onglet unique.
export const MOBILE_TABS: MobileTab[] = [
  { key: 'depot', href: '/depot', label: 'Déposer', icon: Paperclip, roles: SUBMITTERS },
  { key: 'recus', href: '/', label: 'Mes reçus', icon: FileText, roles: ['parent'] },
  { key: 'demandes', href: '/remboursements', label: 'Demandes', icon: HandCoins, roles: SUBMITTERS },
  { key: 'abandons', href: '/abandons', label: 'Abandons', icon: Gift, roles: SUBMITTERS },
  { key: 'plus', href: '#plus', label: 'Plus', icon: Ellipsis, roles: ADMIN },
];

function roleAllowed(roles: Role[] | undefined, role: string): boolean {
  return !roles || roles.includes(role as Role);
}

export function visibleItemsForRole(items: NavItem[], role: string): NavItem[] {
  return items.filter((i) => roleAllowed(i.roles, role));
}

export function visibleTabsForRole(role: string): MobileTab[] {
  return MOBILE_TABS.filter((t) => roleAllowed(t.roles, role));
}
