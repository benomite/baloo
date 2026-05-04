import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { getDb } from '@/lib/db';
import { listSelectableUnites } from '@/lib/queries/reference';
import { createMyRemboursement } from '@/lib/actions/remboursements';
import { RemboursementForm } from '@/components/rembs/remboursement-form';

// Récupère le RIB texte de la dernière demande non vide d'un user. Utile
// pour pré-remplir le form lors de la 2e+ demande — le user n'a pas à
// resaisir son IBAN à chaque fois.
async function getLastRibForUser(
  userId: string,
  groupId: string,
): Promise<string | null> {
  const row = await getDb()
    .prepare(
      `SELECT rib_texte FROM remboursements
       WHERE group_id = ? AND submitted_by_user_id = ? AND rib_texte IS NOT NULL AND rib_texte != ''
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get<{ rib_texte: string }>(groupId, userId);
  return row?.rib_texte ?? null;
}

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

  const [params, unites, lastRib] = await Promise.all([
    searchParams,
    listSelectableUnites(),
    getLastRibForUser(ctx.userId, ctx.groupId),
  ]);
  const today = new Date().toISOString().split('T')[0];
  const { prenom, nom } = splitName(ctx.name);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Accueil', href: '/' }}
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
        initialRibTexte={lastRib}
      />
    </div>
  );
}
