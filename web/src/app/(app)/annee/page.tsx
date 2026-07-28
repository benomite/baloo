import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { Amount } from '@/components/shared/amount';
import { UniteBadge } from '@/components/shared/unite-badge';
import { Alert } from '@/components/ui/alert';
import {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { getCurrentContext } from '@/lib/context';
import { listActivites } from '@/lib/queries/reference';
import { currentExercice } from '@/lib/services/overview';
import { getAnneeOverview, defaultActivitesExcluesIds } from '@/lib/services/annee';
import { parseHors, horsParam, saisonOptions, ADMIN_ROLES } from '@/lib/annee-perimetre';

export const dynamic = 'force-dynamic';

interface SearchParams {
  exercice?: string;
  /** Ids d'activités exclues, séparés par des virgules. `-` = ne rien exclure. */
  hors?: string;
}

export default async function AnneePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/');
  }

  const sp = await searchParams;
  const exercice = sp.exercice ?? currentExercice();
  const activites = await listActivites();
  const exclus = parseHors(sp.hors, activites);

  const data = await getAnneeOverview(
    { groupId: ctx.groupId },
    { exercice, excludeActiviteIds: exclus },
  );

  const nomsExclus = data.activitesExclues.map((a) => a.name).join(', ');
  const options = saisonOptions();

  return (
    <div>
      <PageHeader
        title="Année"
        subtitle={
          exclus.length
            ? `Réalisé de l'exercice par unité, hors ${nomsExclus}.`
            : "Réalisé de l'exercice par unité, toutes activités confondues."
        }
      />

      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink
            key={o.value}
            href={`/annee?exercice=${o.value}${horsParam(sp.hors)}`}
            active={exercice === o.value}
          >
            {o.label}
          </TabLink>
        ))}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Recettes" value={<Amount cents={data.totalRecettes} tone="positive" />} />
        <StatCard label="Dépenses" value={<Amount cents={data.totalDepenses} tone="negative" />} />
        <StatCard
          label="Solde"
          value={<Amount cents={data.solde} tone="signed" />}
          sublabel={`Sept ${exercice.split('-')[0]} → Août ${exercice.split('-')[1]}`}
        />
      </div>

      {/* Jusqu'où vont réellement les données : sans ça, un total arrêté deux
          mois plus tôt se lit comme un total complet. */}
      {data.derniereEcriture && (
        <p className="mb-4 text-xs text-muted-foreground">
          Dernière écriture au {formatDate(data.derniereEcriture)}
          {data.dernierImport
            ? ` · dernier import Comptaweb le ${formatDate(data.dernierImport.date)}`
            : ' · aucun import Comptaweb enregistré'}
        </p>
      )}

      {data.nbDrafts > 0 && (
        <Alert variant="warning" className="mb-4">
          {data.nbDrafts === 1
            ? '1 écriture est encore en brouillon'
            : `${data.nbDrafts} écritures sont encore en brouillon`}{' '}
          : elles comptent dans les totaux ci-dessous, mais leur imputation n’est pas
          arrêtée. Les non imputées apparaissent sur la ligne « Non imputé ».
        </Alert>
      )}

      <Section
        title="Par unité"
        subtitle="Clique une unité pour le détail par activité et la liste des écritures."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unité</TableHead>
              <TableHead className="text-right">Recettes</TableHead>
              <TableHead className="text-right">Dépenses</TableHead>
              <TableHead className="text-right">Solde</TableHead>
              <TableHead className="text-right">Écritures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.parUnite.map((r) => {
              const href = `/annee/${r.unite_id ?? 'non-impute'}?exercice=${exercice}${horsParam(sp.hors)}`;
              return (
                <TableRow key={r.unite_id ?? 'non-impute'}>
                  <TableCell>
                    <Link href={href} className="hover:underline">
                      {r.unite_id ? (
                        <UniteBadge code={r.code} name={r.name} couleur={r.couleur} />
                      ) : (
                        <span className="text-muted-foreground italic">Non imputé</span>
                      )}
                      <span className="ml-2 text-muted-foreground">{r.unite_id ? r.name : ''}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.recettes ? <Amount cents={r.recettes} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.depenses ? <Amount cents={r.depenses} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount cents={r.solde} tone="signed" />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.nb}
                    {r.nb_drafts > 0 && (
                      <span className="ml-1 text-amber-600" title={`${r.nb_drafts} en brouillon`}>
                        ({r.nb_drafts} br.)
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="text-right"><Amount cents={data.totalRecettes} /></TableCell>
              <TableCell className="text-right"><Amount cents={data.totalDepenses} /></TableCell>
              <TableCell className="text-right"><Amount cents={data.solde} tone="signed" /></TableCell>
              <TableCell className="text-right text-muted-foreground">
                {data.parUnite.reduce((s, r) => s + r.nb, 0)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Section>

      <Section
        title="Périmètre"
        subtitle="Les activités décochées sont retirées de tous les chiffres de cette page."
        className="mt-8"
      >
        <div className="flex flex-wrap gap-2">
          {activites.map((a) => {
            const estExclu = exclus.includes(a.id);
            const suivants = estExclu ? exclus.filter((id) => id !== a.id) : [...exclus, a.id];
            const href = `/annee?exercice=${exercice}&hors=${suivants.length ? suivants.join(',') : '-'}`;
            return (
              <Link
                key={a.id}
                href={href}
                className={
                  estExclu
                    ? 'rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground line-through hover:bg-muted'
                    : 'rounded-full border bg-card px-3 py-1 text-sm hover:bg-muted'
                }
                title={estExclu ? 'Cliquer pour réintégrer' : 'Cliquer pour exclure'}
              >
                {a.name}
              </Link>
            );
          })}
        </div>
        {defaultActivitesExcluesIds(activites).length > 0 && sp.hors === undefined && (
          <p className="mt-3 text-xs text-muted-foreground">
            Par défaut, les activités de camp sont exclues — les camps ont leur propre
            suivi dans <Link href="/camps" className="underline">Camps</Link>.
          </p>
        )}
      </Section>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
