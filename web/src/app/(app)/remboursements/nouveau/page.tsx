import { PageHeader } from '@/components/layout/page-header';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';
import { listUnites } from '@/lib/queries/reference';
import { createForeignRemboursement } from '@/lib/actions/remboursements';
import { RemboursementForm } from '@/components/rembs/remboursement-form';

interface SearchParams {
  error?: string;
}

// Saisie d'une demande de remboursement **pour quelqu'un d'autre** (le
// trésorier reçoit une demande à l'oral / sur papier / par mail). On
// saisit les nom/prenom/email du bénéficiaire ; la demande ne pointe
// pas sur l'espace personnel du saisissant (champ
// `submitted_by_user_id` laissé NULL ou matché à un user existant).
//
// Pour faire sa propre demande, voir `/moi/remboursements/nouveau`.
export default async function NouveauRemboursementForeignPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);

  const params = await searchParams;
  const unites = await listUnites();
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-3xl">
      <PageHeader title="Saisir une demande pour un bénévole" />

      <p className="text-sm text-muted-foreground mb-6">
        Cette page sert à enregistrer une demande de remboursement reçue à l&apos;oral / sur
        papier pour quelqu&apos;un d&apos;autre. Pour faire ta propre demande,
        passe par <a href="/moi/remboursements/nouveau" className="text-primary underline">Mon espace</a>.
      </p>

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}

      <RemboursementForm
        action={createForeignRemboursement}
        unites={unites}
        today={today}
        identityMode="editable"
        defaultIdentity={{ prenom: '', nom: '', email: '' }}
        scopeUniteId={null}
        submitLabel="Enregistrer la demande"
      />
    </div>
  );
}
