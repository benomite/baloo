import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { getCurrentContext } from '@/lib/context';
import { listUnites } from '@/lib/queries/reference';
import { createMyRemboursement } from '@/lib/actions/remboursements';
import { RemboursementForm } from './remboursement-form';

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
    <div className="max-w-3xl">
      <PageHeader title="Demander un remboursement" />

      <p className="text-sm text-muted-foreground mb-6">
        Tu as avancé des frais pour le groupe ? Ajoute autant de lignes que de tickets,
        joins les justificatifs et tes coordonnées bancaires. Une feuille de remboursement
        PDF sera générée automatiquement et archivée avec ta demande.
      </p>

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}

      <RemboursementForm
        action={createMyRemboursement}
        unites={unites}
        scopeUniteId={ctx.scopeUniteId}
        defaultIdentity={{ prenom, nom, email: ctx.email }}
        today={today}
      />
    </div>
  );
}
