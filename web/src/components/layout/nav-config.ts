import {
  BookOpen, Calculator, Coins, Ellipsis, Gift, HandCoins, Home, Inbox, Mail,
  Package, Paperclip, ShieldAlert, TrendingUp, Link2, Bot, FileText,
  type LucideIcon,
} from 'lucide-react';

export type Role = 'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent';
export type Intent = 'piloter' | 'saisir' | 'demandes' | 'gerer';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rôles autorisés. Absent = tous les rôles authentifiés. */
  roles?: Role[];
  badgeKey?: 'inbox';
}

export interface NavGroup {
  intent: Intent;
  title: string;
  items: NavItem[];
}

const ADMIN: Role[] = ['tresorier', 'RG'];
const COMPTA: Role[] = ['tresorier', 'RG', 'chef'];

// Desktop : poste de pilotage trésorier, rangé par intention.
// Import (/import) et Clôture (/cloture) sont VOLONTAIREMENT absents
// (accessibles par lien direct, cf. spec).
export const DESKTOP_GROUPS: NavGroup[] = [
  {
    intent: 'piloter',
    title: 'Piloter',
    items: [
      { href: '/', label: 'Accueil', icon: Home, roles: ADMIN },
      { href: '/inbox', label: 'Inbox', icon: Inbox, roles: ADMIN, badgeKey: 'inbox' },
      { href: '/synthese', label: 'Synthèse', icon: TrendingUp, roles: COMPTA },
      { href: '/budgets', label: 'Budget', icon: Calculator, roles: ADMIN },
    ],
  },
  {
    intent: 'saisir',
    title: 'Saisir',
    items: [
      { href: '/ecritures', label: 'Écritures', icon: BookOpen, roles: ADMIN },
      { href: '/caisse', label: 'Caisse', icon: Coins, roles: ADMIN },
      { href: '/comptaweb/rapprochement', label: 'Rapprochement', icon: Link2, roles: ADMIN },
    ],
  },
  {
    intent: 'demandes',
    title: 'Demandes & dépôts',
    items: [
      { href: '/remboursements', label: 'Remboursements', icon: HandCoins, roles: ADMIN },
      { href: '/abandons', label: 'Dons au groupe', icon: Gift, roles: ADMIN },
      { href: '/depots', label: 'Dépôts', icon: Package, roles: ADMIN },
    ],
  },
  {
    intent: 'gerer',
    title: 'Gérer',
    items: [
      { href: '/moi/connexions', label: 'Connexion Claude', icon: Bot, roles: ADMIN },
      { href: '/admin/invitations', label: 'Membres', icon: Mail, roles: ADMIN },
      { href: '/admin/errors', label: "Journal d'erreurs", icon: ShieldAlert, roles: ADMIN },
    ],
  },
];

export interface MobileTab {
  key: 'accueil' | 'depot' | 'demandes' | 'recus' | 'plus';
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

// Mobile : app membre pour tous. "Déposer" est l'action reine.
// IMPORTANT: l'ordre du tableau = l'ordre d'affichage. 'recus' (parent)
// doit venir avant 'demandes' pour que l'ordre parent soit [accueil, recus].
export const MOBILE_TABS: MobileTab[] = [
  { key: 'accueil', href: '/', label: 'Accueil', icon: Home },
  { key: 'depot', href: '/depot', label: 'Déposer', icon: Paperclip, roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { key: 'recus', href: '/remboursements', label: 'Mes reçus', icon: FileText, roles: ['parent'] },
  { key: 'demandes', href: '/remboursements', label: 'Mes demandes', icon: HandCoins, roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { key: 'plus', href: '#plus', label: 'Plus', icon: Ellipsis, roles: ['tresorier', 'RG'] },
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
