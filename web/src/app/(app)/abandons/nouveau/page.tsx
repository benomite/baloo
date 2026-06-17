import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { AbandonForm } from '@/components/abandons/abandon-form';
import { getCurrentContext } from '@/lib/context';
import { requireCanSubmit } from '@/lib/auth/access';
import { listSelectableUnites } from '@/lib/queries/reference';
import { createAbandon } from '@/lib/actions/abandons';
import { getDb } from '@/lib/db';

// Récupère les 5 dernières natures distinctes des demandes (rembs +
// abandons) du user, pour suggérer via un datalist HTML5.
async function getNatureSuggestions(
  userId: string,
  groupId: string,
): Promise<string[]> {
  const rows = await getDb()
    .prepare(
      `SELECT DISTINCT nature FROM (
         SELECT nature, created_at FROM abandons_frais
         WHERE group_id = ? AND submitted_by_user_id = ? AND nature IS NOT NULL AND nature != ''
         UNION ALL
         SELECT nature, created_at FROM remboursements
         WHERE group_id = ? AND submitted_by_user_id = ? AND nature IS NOT NULL AND nature != ''
       )
       ORDER BY created_at DESC LIMIT 5`,
    )
    .all<{ nature: string }>(groupId, userId, groupId, userId);
  return rows.map((r) => r.nature);
}

interface SearchParams {
  error?: string;
}

export default async function NouvelAbandonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireCanSubmit(ctx.role);

  const [params, unites, natureSuggestions] = await Promise.all([
    searchParams,
    listSelectableUnites(),
    getNatureSuggestions(ctx.userId, ctx.groupId),
  ]);
  const today = new Date().toISOString().split('T')[0];

  // Dérive prénom/nom depuis ctx.name (format "Prénom Nom") ou ctx.email.
  const fullName = ctx.name ?? ctx.email;
  const [firstFromName, ...restFromName] = fullName.split(/\s+/);
  const defaultPrenom = firstFromName ?? '';
  const defaultNom = restFromName.join(' ');

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Dons au groupe', href: '/abandons' }}
        title="Déclarer un don au groupe"
        subtitle="Tu as avancé des frais pour le groupe et tu en fais don plutôt que d'être remboursé. Tu recevras un reçu fiscal CERFA (abandon de frais — art. 200 CGI) qui ouvre droit à une réduction d'impôt sur le revenu."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}

      <AbandonForm
        action={createAbandon}
        unites={unites}
        today={today}
        defaultIdentity={{
          prenom: defaultPrenom,
          nom: defaultNom,
          email: ctx.email,
        }}
        scopeUniteId={ctx.scopeUniteId}
        natureSuggestions={natureSuggestions}
        showSgdfInfo={true}
        submitLabel="Déclarer l'abandon"
      />
    </div>
  );
}
