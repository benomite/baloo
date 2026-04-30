import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
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
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Remboursements', href: '/remboursements' }}
        title="Saisir pour quelqu'un d'autre"
        subtitle={
          <>
            Cette page sert à enregistrer une demande reçue à l&apos;oral / sur papier / par mail
            pour un autre bénévole. Pour faire ta propre demande, passe par{' '}
            <Link href="/moi/remboursements/nouveau" className="text-brand underline-offset-2 hover:underline">
              Mon espace
            </Link>
            .
          </>
        }
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
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
