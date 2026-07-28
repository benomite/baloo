import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { Amount } from '@/components/shared/amount';
import { UniteBadge } from '@/components/shared/unite-badge';
import { EmptyState } from '@/components/shared/empty-state';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { listActivites } from '@/lib/queries/reference';
import { currentExercice, exerciceBounds } from '@/lib/services/overview';
import { selectAnneeParActivite, selectAnneeEcritures } from '@/lib/services/annee';
import { parseHors, horsParam, ADMIN_ROLES } from '@/lib/annee-perimetre';

export const dynamic = 'force-dynamic';

/** Segment d'URL pour les écritures sans unité (unite_id NULL). */
const NON_IMPUTE = 'non-impute';

export default async function AnneeUnitePage({
  params,
  searchParams,
}: {
  params: Promise<{ uniteId: string }>;
  searchParams: Promise<{ exercice?: string; hors?: string }>;
}) {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/');
  }

  const { uniteId: segment } = await params;
  const sp = await searchParams;
  const exercice = sp.exercice ?? currentExercice();
  const bornes = exerciceBounds(exercice);
  const activites = await listActivites();
  const exclus = parseHors(sp.hors, activites);

  const estNonImpute = segment === NON_IMPUTE;

  // Anti-énumération : on ne résout l'unité que dans le groupe courant.
  const unite = estNonImpute
    ? null
    : await getDb()
        .prepare('SELECT id, code, name, couleur FROM unites WHERE id = ? AND group_id = ?')
        .get<{ id: string; code: string; name: string; couleur: string | null }>(segment, ctx.groupId);

  if (!estNonImpute && !unite) notFound();

  const uniteId = estNonImpute ? null : segment;
  const db = getDb();
  const [parActivite, ecritures] = await Promise.all([
    selectAnneeParActivite(db, ctx.groupId, bornes, exclus, uniteId),
    selectAnneeEcritures(db, ctx.groupId, bornes, exclus, uniteId),
  ]);

  const recettes = parActivite.reduce((s, r) => s + r.recettes, 0);
  const depenses = parActivite.reduce((s, r) => s + r.depenses, 0);
  const retour = `/annee?exercice=${exercice}${horsParam(sp.hors)}`;

  return (
    <div>
      <PageHeader
        eyebrow={{ label: 'Année', href: retour }}
        title={estNonImpute ? 'Non imputé' : unite!.name}
        subtitle={`Sept ${exercice.split('-')[0]} → Août ${exercice.split('-')[1]}${
          exclus.length ? ` · hors ${exclus.length === 1 ? '1 activité' : `${exclus.length} activités`}` : ''
        }`}
        meta={
          estNonImpute ? undefined : (
            <UniteBadge code={unite!.code} name={unite!.name} couleur={unite!.couleur} size="md" />
          )
        }
      />

      {estNonImpute && (
        <p className="mb-4 text-sm text-muted-foreground">
          Écritures de l’exercice sans unité rattachée. Les imputer depuis{' '}
          <Link href="/ecritures" className="underline">Écritures</Link> les fera
          basculer dans l’unité concernée.
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Recettes" value={<Amount cents={recettes} tone="positive" />} />
        <StatCard label="Dépenses" value={<Amount cents={depenses} tone="negative" />} />
        <StatCard label="Solde" value={<Amount cents={recettes - depenses} tone="signed" />} />
      </div>

      {ecritures.length === 0 ? (
        <EmptyState
          emoji="🗓️"
          title="Rien sur cet exercice"
          description="Aucune écriture dans le périmètre pour cette unité."
        />
      ) : (
        <>
          <Section title="Par activité">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activité</TableHead>
                  <TableHead className="text-right">Recettes</TableHead>
                  <TableHead className="text-right">Dépenses</TableHead>
                  <TableHead className="text-right">Solde</TableHead>
                  <TableHead className="text-right">Écritures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parActivite.map((a) => (
                  <TableRow key={a.activite_id ?? 'aucune'}>
                    <TableCell>{a.activite_name}</TableCell>
                    <TableCell className="text-right">
                      {a.recettes ? <Amount cents={a.recettes} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.depenses ? <Amount cents={a.depenses} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount cents={a.recettes - a.depenses} tone="signed" />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{a.nb}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title={`Écritures (${ecritures.length})`} className="mt-8">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ecritures.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(e.date_ecriture)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/ecritures?focus=${e.id}`} className="hover:underline">
                        {e.description}
                      </Link>
                      {e.status === 'draft' && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          brouillon
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.category_name ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Amount
                        cents={e.amount_cents}
                        tone={e.type === 'depense' ? 'negative' : 'positive'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
