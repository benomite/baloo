import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Section } from '@/components/shared/section';
import { EmptyState } from '@/components/shared/empty-state';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listUnites } from '@/lib/queries/reference';
import { listPendingInvitations } from '@/lib/services/invitations';
import { createInvitation } from '@/lib/actions/invitations';
import { InvitationForm } from './invitation-form';

interface SearchParams {
  error?: string;
  success?: string;
  status?: string;
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
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
  const [unites, pending] = await Promise.all([
    listUnites(),
    listPendingInvitations({ groupId: ctx.groupId }),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Invitations"
        subtitle="Inviter un bénévole, un parent ou un autre trésorier à utiliser Baloo."
      />

      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      {params.success && (
        <Alert variant="success" className="mb-6">
          Invitation créée pour <b>{params.success}</b>
          {params.status === 'sent'
            ? ' — email envoyé.'
            : " — user créé mais l'envoi du mail a échoué (cf. logs)."}
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2 items-start">
        <Section title="Nouvelle invitation" subtitle="Le destinataire reçoit un magic link.">
          <InvitationForm action={createInvitation} unites={unites} roles={ROLE_OPTIONS} />
        </Section>

        <Section
          title={`En attente de connexion (${pending.length})`}
          subtitle="Invitations créées qui n'ont pas encore généré de session."
        >
          {pending.length === 0 ? (
            <EmptyState
              emoji="✉️"
              title="Personne en attente"
              description="Toutes les invitations créées ont été utilisées au moins une fois."
            />
          ) : (
            <ul className="divide-y divide-border-soft -mx-6">
              {pending.map((inv) => (
                <li key={inv.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-fg truncate">
                      {inv.nom_affichage ?? inv.email}
                    </div>
                    <div className="text-[12px] text-fg-muted truncate">{inv.email}</div>
                  </div>
                  <div className="text-right text-[12px] shrink-0">
                    <div className="font-medium text-fg">
                      {ROLE_LABELS[inv.role] ?? inv.role}
                      {inv.unite_code ? ` · ${inv.unite_code}` : ''}
                    </div>
                    <div className="text-fg-muted">invité le {inv.created_at.slice(0, 10)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
