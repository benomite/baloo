import { Mail, Send, Trash2, UserCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Section } from '@/components/shared/section';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listUnites } from '@/lib/queries/reference';
import {
  listActiveUsers,
  listPendingInvitations,
  type ListInvitationsItem,
} from '@/lib/services/invitations';
import {
  createInvitation,
  deleteInvitation,
  resendInvitation,
} from '@/lib/actions/invitations';
import { InvitationForm } from './invitation-form';

interface SearchParams {
  error?: string;
  success?: string;
  status?: string;
  resent?: string;
  deleted?: string;
}

const ROLE_OPTIONS = [
  { value: 'equipier', label: 'Équipier' },
  { value: 'chef', label: "Chef d'unité" },
  { value: 'parent', label: 'Parent' },
  { value: 'tresorier', label: 'Trésorier' },
  { value: 'RG', label: 'Responsable de groupe' },
];

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
);

export default async function AdminInvitationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);

  const [unites, pending, active] = await Promise.all([
    listUnites(),
    listPendingInvitations({ groupId: ctx.groupId }),
    listActiveUsers({ groupId: ctx.groupId }),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Invitations"
        subtitle="Inviter un bénévole, un parent ou un autre trésorier à utiliser Baloo."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}
      {params.success && (
        <Alert variant="success" className="mb-6">
          Invitation créée pour <b>{params.success}</b>
          {params.status === 'sent'
            ? ' — email envoyé.'
            : " — user créé mais l'envoi du mail a échoué (cf. logs)."}
        </Alert>
      )}
      {params.resent && (
        <Alert variant="success" className="mb-6">
          Mail d&apos;invitation renvoyé.
        </Alert>
      )}
      {params.deleted && (
        <Alert variant="info" className="mb-6">
          Invitation supprimée.
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2 items-start mb-6">
        <Section title="Nouvelle invitation" subtitle="Le destinataire reçoit un magic link.">
          <InvitationForm action={createInvitation} unites={unites} roles={ROLE_OPTIONS} />
        </Section>

        <Section
          title={`En attente de connexion (${pending.length})`}
          subtitle="Invitations créées qui n'ont pas encore généré de session."
          bodyClassName={pending.length === 0 ? undefined : 'px-0 pb-0'}
        >
          {pending.length === 0 ? (
            <EmptyState
              emoji="✉️"
              title="Personne en attente"
              description="Toutes les invitations créées ont été utilisées au moins une fois."
            />
          ) : (
            <ul className="divide-y divide-border-soft">
              {pending.map((inv) => (
                <PendingItem key={inv.id} inv={inv} />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title={`Membres actifs (${active.length})`}
        subtitle="Users qui se sont déjà connectés au moins une fois."
        bodyClassName={active.length === 0 ? undefined : 'px-0 pb-0'}
      >
        {active.length === 0 ? (
          <EmptyState
            emoji="👋"
            title="Aucun membre actif"
            description="Personne ne s'est encore connecté à Baloo. Envoie tes premières invitations à gauche."
          />
        ) : (
          <ul className="divide-y divide-border-soft">
            {active.map((u) => (
              <ActiveItem key={u.id} user={u} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function PendingItem({ inv }: { inv: ListInvitationsItem }) {
  return (
    <li className="px-6 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-fg truncate">
          {inv.nom_affichage ?? inv.email}
        </div>
        <div className="text-[12px] text-fg-muted truncate">{inv.email}</div>
        <div className="mt-0.5 text-[11.5px] text-fg-subtle">
          {ROLE_LABELS[inv.role] ?? inv.role}
          {inv.unite_code ? ` · ${inv.unite_code}` : ''}
          <span className="mx-1.5">·</span>
          <span className="tabular-nums">invité le {inv.created_at.slice(0, 10)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <form action={resendInvitation.bind(null, inv.id)}>
          <PendingButton
            variant="ghost"
            size="icon-sm"
            pendingLabel=""
            aria-label="Renvoyer le mail"
          >
            <Send size={13} strokeWidth={1.75} />
          </PendingButton>
        </form>
        <form action={deleteInvitation.bind(null, inv.id)}>
          <PendingButton
            variant="ghost"
            size="icon-sm"
            pendingLabel=""
            aria-label="Supprimer l'invitation"
            className="text-fg-muted hover:text-destructive"
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </PendingButton>
        </form>
      </div>
    </li>
  );
}

function ActiveItem({ user }: { user: ListInvitationsItem }) {
  return (
    <li className="px-6 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
          <UserCheck size={14} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-fg truncate">
            {user.nom_affichage ?? user.email}
          </div>
          <div className="text-[12px] text-fg-muted truncate">
            <Mail size={11} strokeWidth={1.75} className="inline-block mr-1 align-text-top" />
            {user.email}
          </div>
        </div>
      </div>
      <div className="text-right text-[11.5px] shrink-0">
        <div className="font-medium text-fg">
          {ROLE_LABELS[user.role] ?? user.role}
          {user.unite_code ? ` · ${user.unite_code}` : ''}
        </div>
        {user.email_verified && (
          <div className="text-fg-subtle tabular-nums">
            connecté depuis {user.email_verified.slice(0, 10)}
          </div>
        )}
      </div>
    </li>
  );
}
