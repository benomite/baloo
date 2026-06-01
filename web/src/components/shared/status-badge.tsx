import { cn } from '@/lib/utils';

// `<StatusPill>` : pill outline sobre avec point coloré, style Linear /
// GitHub. Évite les blocs de couleur saturée des badges shadcn par
// défaut (`bg-yellow-100 text-yellow-800` etc.) qui datent en milieu
// dense. À utiliser pour tout statut applicatif (écriture,
// remboursement, dépôt, abandon, etc.) — la map status → tone se fait
// dans des wrappers de domaine (`EcritureStatusBadge`,
// `RemboursementStatusBadge`...) ; le composant est lui-même agnostique.

export type StatusTone =
  | 'neutral'   // gris : état initial / par défaut (brouillon, en attente passive)
  | 'pending'   // ambre : action attendue de l'utilisateur (à traiter)
  | 'progress'  // bleu : en cours de validation / pipeline
  | 'success'   // vert : terminé OK
  | 'danger';   // rouge : refusé / erreur

interface StatusPillProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

const TONE_CLASSES: Record<StatusTone, { wrapper: string; dot: string }> = {
  neutral: {
    wrapper: 'border-border bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
  pending: {
    wrapper: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  progress: {
    wrapper: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  success: {
    wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  danger: {
    wrapper: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200',
    dot: 'bg-red-500',
  },
};

export function StatusPill({ tone, label, className }: StatusPillProps) {
  const { wrapper, dot } = TONE_CLASSES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        wrapper,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  );
}

// ---- Wrappers de domaine ----

// Mapping des nouveaux statuts (pivot Phase 1 "miroir strict + MCP-first") :
//   draft         : préparation locale (équivalent de l'ancien brouillon)
//   pending_cw    : push CW en cours (transitoire)
//   pending_sync  : envoyée à CW, attend la sync retour
//   mirror        : synchronisée, miroir CW propre (≈ ancien saisie_comptaweb)
//   divergent     : la sync a détecté un écart entre Baloo et CW
const ECRITURE_STATUS_MAP: Record<string, { tone: StatusTone; label: string }> = {
  draft: { tone: 'neutral', label: 'Brouillon' },
  pending_cw: { tone: 'pending', label: 'Envoi CW…' },
  pending_sync: { tone: 'progress', label: 'Envoyée à CW' },
  mirror: { tone: 'success', label: 'Miroir CW' },
  divergent: { tone: 'danger', label: 'Divergent CW' },
  supprimee_cw: { tone: 'danger', label: 'Supprimée dans CW' },
  agrege_remplace: { tone: 'pending', label: 'Agrégat (doublon)' },
};

export function EcritureStatusBadge({ status }: { status: string }) {
  const entry = ECRITURE_STATUS_MAP[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusPill tone={entry.tone} label={entry.label} />;
}

const REMBOURSEMENT_STATUS_MAP: Record<string, { tone: StatusTone; label: string }> = {
  a_traiter: { tone: 'pending', label: 'À traiter' },
  valide_tresorier: { tone: 'progress', label: 'Validé Trésorier' },
  valide_rg: { tone: 'progress', label: 'Validé RG' },
  virement_effectue: { tone: 'progress', label: 'Virement effectué' },
  termine: { tone: 'success', label: 'Terminé' },
  refuse: { tone: 'danger', label: 'Refusé' },
};

export function RemboursementStatusBadge({ status }: { status: string }) {
  const entry = REMBOURSEMENT_STATUS_MAP[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusPill tone={entry.tone} label={entry.label} />;
}

// ─── Pastilles 2 axes pour les écritures ────────────────────────────
//
// Au lieu d'un statut unique linéaire (draft → pending_sync → mirror)
// qui mélange deux dimensions, on rend deux pastilles indépendantes :
//
//   - JustifBadge  : présent / manquant (axe documentaire)
//   - CwBadge      : synchronisé Comptaweb / local (axe synchro)
//
// Cas légitimes (rappel) :
//   - Sans justif + Local       → 🟡 ⚪ à traiter classique
//   - Avec justif + Local       → 🟢 ⚪ prêt à pousser CW
//   - Avec justif + CW synchro  → 🟢 🔵 idéal
//   - Sans justif + CW synchro  → 🟡 🔵 hack légit ("synchro pour avoir
//     la paix, justif arrive bientôt"). Représentable, non-bloquant.

export function JustifBadge({ hasJustif }: { hasJustif: boolean }) {
  return hasJustif ? (
    <StatusPill tone="success" label="Justif" />
  ) : (
    <StatusPill tone="pending" label="Sans justif" />
  );
}

export function CwBadge({ synced }: { synced: boolean }) {
  return synced ? (
    <StatusPill tone="progress" label="Synchro CW" />
  ) : (
    <StatusPill tone="neutral" label="Local" />
  );
}

export function EcritureStatePair({
  hasJustif,
  comptawebSynced,
  className,
}: {
  hasJustif: boolean;
  comptawebSynced: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      <JustifBadge hasJustif={hasJustif} />
      <CwBadge synced={comptawebSynced} />
    </span>
  );
}

const ABANDON_STATUS_MAP: Record<string, { tone: StatusTone; label: string }> = {
  a_traiter: { tone: 'pending', label: 'À traiter' },
  valide: { tone: 'progress', label: 'Validé' },
  envoye_national: { tone: 'success', label: 'Envoyé au national' },
  refuse: { tone: 'danger', label: 'Refusé' },
};

export function AbandonStatusBadge({ status }: { status: string }) {
  const entry = ABANDON_STATUS_MAP[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusPill tone={entry.tone} label={entry.label} />;
}
