import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { listUnites } from '@/lib/queries/reference';
import { getRemboursement } from '@/lib/queries/remboursements';
import { listLignes } from '@/lib/services/remboursements';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { updateMyRemboursement } from '@/lib/actions/remboursements';
import { RemboursementForm } from '@/components/rembs/remboursement-form';

interface SearchParams {
  error?: string;
}

const ADMIN_ROLES = ['tresorier', 'RG'];

export default async function EditRemboursementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;

  const [sp, ctx, r, unites, lignes, justifs] = await Promise.all([
    searchParams,
    getCurrentContext(),
    getRemboursement(id),
    listUnites(),
    listLignes(id),
    listJustificatifs('remboursement', id),
  ]);
  if (!r) notFound();

  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const isOwner = !!r.submitted_by_user_id && r.submitted_by_user_id === ctx.userId;

  if (!isAdmin && !isOwner) {
    redirect(
      `/remboursements/${id}?error=${encodeURIComponent('Tu n’as pas le droit de modifier cette demande.')}`,
    );
  }
  if (r.status !== 'a_traiter' && !isAdmin) {
    redirect(
      `/remboursements/${id}?error=${encodeURIComponent('Cette demande a été validée — l’édition complète est réservée aux admins.')}`,
    );
  }
  const today = new Date().toISOString().split('T')[0];
  const action = updateMyRemboursement.bind(null, id);

  const editAdminWarning = r.status !== 'a_traiter' && isAdmin;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Remboursements', href: `/remboursements/${id}` }}
        title={`Modifier ${r.id}`}
        subtitle={
          r.status === 'a_traiter'
            ? 'Tu peux modifier tous les champs tant que la demande n’a pas été validée par le trésorier. Le PDF feuille sera régénéré et la signature électronique remise à jour.'
            : "Édition admin : la demande a déjà été validée. Modifier les champs métier invalidera la chaîne de signatures (badge « chaîne brisée » côté trésorier)."
        }
      />

      {editAdminWarning && (
        <Alert variant="warning" className="mb-6">
          La demande a déjà été validée. Toute modification invalidera la signature électronique de
          la feuille — un badge « chaîne brisée » apparaîtra côté trésorier.
        </Alert>
      )}

      {sp.error && (
        <Alert variant="error" className="mb-6">
          {sp.error}
        </Alert>
      )}

      <RemboursementForm
        action={action}
        unites={unites}
        today={today}
        identityMode="editable"
        defaultIdentity={{
          prenom: r.prenom ?? '',
          nom: r.nom ?? '',
          email: r.email ?? '',
        }}
        scopeUniteId={ctx.scopeUniteId}
        initialLignes={lignes.map((l) => ({
          date_depense: l.date_depense,
          amount_cents: l.amount_cents,
          nature: l.nature,
        }))}
        initialRibTexte={r.rib_texte}
        initialNotes={r.notes}
        initialUniteId={r.unite_id}
        existingJustifsCount={justifs.length}
        submitLabel="Enregistrer les modifications"
      />
    </div>
  );
}
