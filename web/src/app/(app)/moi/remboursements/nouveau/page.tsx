import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { listUnites } from '@/lib/queries/reference';
import { createMyRemboursement } from '@/lib/actions/remboursements';
import { RemboursementForm } from '@/components/rembs/remboursement-form';

interface SearchParams {
  error?: string;
}

function splitName(full: string | null): { prenom: string; nom: string } {
  if (!full) return { prenom: '', nom: '' };
  const trimmed = full.trim();
  if (!trimmed) return { prenom: '', nom: '' };
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { prenom: trimmed, nom: '' };
  return { prenom: trimmed.slice(0, idx), nom: trimmed.slice(idx + 1) };
}

export default async function MyNouveauRemboursementPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') redirect('/moi');

  const params = await searchParams;
  const unites = await listUnites();
  const today = new Date().toISOString().split('T')[0];
  const { prenom, nom } = splitName(ctx.name);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Mon espace', href: '/moi' }}
        title="Demander un remboursement"
        subtitle="Tu as avancé des frais pour le groupe ? Ajoute autant de lignes que de tickets, joins les justificatifs et tes coordonnées bancaires. Une feuille de remboursement PDF sera générée automatiquement."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}

      <RemboursementForm
        action={createMyRemboursement}
        unites={unites}
        today={today}
        identityMode="locked"
        defaultIdentity={{ prenom, nom, email: ctx.email }}
        scopeUniteId={ctx.scopeUniteId}
      />
    </div>
  );
}
