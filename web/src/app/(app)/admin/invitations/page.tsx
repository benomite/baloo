import { PageHeader } from '@/components/layout/page-header';
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
  { value: 'chef', label: 'Chef d\'unité' },
  { value: 'parent', label: 'Parent' },
  { value: 'tresorier', label: 'Trésorier' },
  { value: 'RG', label: 'Responsable de groupe' },
];

export default async function AdminInvitationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
  const [unites, pending] = await Promise.all([
    listUnites(),
    listPendingInvitations({ groupId: ctx.groupId }),
  ]);

  return (
    <div>
      <PageHeader title="Invitations" />

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="font-semibold mb-3">Inviter un nouveau membre</h2>

          {params.error && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {params.error}
            </p>
          )}
          {params.success && (
            <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              Invitation créée pour <b>{params.success}</b>
              {params.status === 'sent' ? ' — email envoyé.' : ' — user créé mais l\'envoi du mail a échoué (cf. logs).'}
            </p>
          )}

          <InvitationForm action={createInvitation} unites={unites} roles={ROLE_OPTIONS} />
        </section>

        <section>
          <h2 className="font-semibold mb-3">En attente de connexion ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Personne n&apos;est en attente.</p>
          ) : (
            <ul className="divide-y border rounded">
              {pending.map((inv) => (
                <li key={inv.id} className="px-3 py-2 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-medium">{inv.nom_affichage ?? inv.email}</div>
                    <div className="text-xs text-muted-foreground">{inv.email}</div>
                  </div>
                  <div className="text-xs text-right">
                    <div>{inv.role}{inv.unite_code ? ` · ${inv.unite_code}` : ''}</div>
                    <div className="text-muted-foreground">invité le {inv.created_at.slice(0, 10)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
