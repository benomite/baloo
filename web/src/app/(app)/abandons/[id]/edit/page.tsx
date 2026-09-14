import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { AbandonForm } from '@/components/abandons/abandon-form';
import { getCurrentContext } from '@/lib/context';
import { listSelectableUnites } from '@/lib/queries/reference';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { canEditAbandon, getAbandon } from '@/lib/services/abandons';
import { updateAbandon } from '@/lib/actions/abandons';

interface SearchParams {
  error?: string;
}

const ADMIN_ROLES = ['tresorier', 'RG'];

// Montant pour un champ de saisie : "42,50" (sans symbole ni séparateur).
function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

export default async function EditAbandonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const [sp, ctx] = await Promise.all([searchParams, getCurrentContext()]);

  const a = await getAbandon({ groupId: ctx.groupId }, id);
  if (!a) notFound();

  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const isOwner = !!a.submitted_by_user_id && a.submitted_by_user_id === ctx.userId;
  if (!isAdmin && !isOwner) notFound();
  if (!canEditAbandon(a.status, { isAdmin, isOwner })) {
    redirect(
      `/abandons/${id}?error=` +
        encodeURIComponent('Cette demande n’est plus modifiable (elle n’est plus à traiter).'),
    );
  }

  const [unites, feuilles, justifs] = await Promise.all([
    // Préserve l'unité orpheline éventuellement déjà sur la demande.
    listSelectableUnites(a.unite_id),
    listJustificatifs('abandon_feuille', id),
    listJustificatifs('abandon', id),
  ]);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Abandons', href: `/abandons/${id}` }}
        title={`Modifier ${a.id}`}
        subtitle="Tu peux corriger la demande et ajouter des pièces tant qu’elle n’a pas été validée."
      />

      {sp.error && (
        <Alert variant="error" className="mb-6">
          {sp.error}
        </Alert>
      )}

      <AbandonForm
        action={updateAbandon.bind(null, id)}
        unites={unites}
        today={today}
        defaultIdentity={{
          prenom: a.prenom ?? '',
          nom: a.nom ?? '',
          email: a.email ?? '',
        }}
        scopeUniteIds={ctx.scopeUniteIds}
        initial={{
          nature: a.nature,
          montant: centsToInput(a.amount_cents),
          date_depense: a.date_depense,
          unite_id: a.unite_id,
          notes: a.notes,
        }}
        existingFeuillesCount={feuilles.length}
        existingJustifsCount={justifs.length}
        submitLabel="Enregistrer les modifications"
        pendingLabel="Enregistrement…"
      />
    </div>
  );
}
