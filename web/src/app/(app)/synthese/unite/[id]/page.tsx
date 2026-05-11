import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileQuestion, Scale, Upload } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { TabLink } from '@/components/shared/tab-link';
import { RepartitionsList } from '@/components/synthese/repartitions-list';
import { getUniteOverview } from '@/lib/queries/overview';
import { listUnites } from '@/lib/queries/reference';
import { currentExercice } from '@/lib/services/overview';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';

interface SearchParams { exercice?: string }

function exerciceOptions(): { value: string; label: string }[] {
  const cur = currentExercice();
  const curStart = parseInt(cur.split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({ value: `${y}-${y + 1}`, label: `Sept ${y} → Août ${y + 1}` });
  }
  return opts;
}

export default async function UniteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const { id } = await params;
  const sp = await searchParams;
  const cur = currentExercice();
  const exerciceParam = sp.exercice ?? cur;
  const exerciceFilter = exerciceParam === 'tous' ? null : exerciceParam;

  const [data, unitesRef] = await Promise.all([
    getUniteOverview(id, { exercice: exerciceFilter }),
    listUnites(),
  ]);
  if (!data) notFound();

  const couleur = data.unite.couleur ?? '#C9C9C9';
  const options = exerciceOptions();

  return (
    <div>
      <Link
        href={`/synthese?exercice=${exerciceParam}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft size={14} /> Synthèse
      </Link>

      <div
        className="pl-3 mb-6"
        style={{ boxShadow: `inset 3px 0 0 0 ${couleur}` }}
      >
        <PageHeader
          title={`${data.unite.code} — ${data.unite.name}`}
          subtitle="Détail des dépenses, recettes et alertes pour cette unité."
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink
            key={o.value}
            href={`/synthese/unite/${id}?exercice=${o.value}`}
            active={exerciceParam === o.value}
          >
            {o.label}
          </TabLink>
        ))}
        <TabLink href={`/synthese/unite/${id}?exercice=tous`} active={exerciceParam === 'tous'}>
          Tous
        </TabLink>
      </div>

      <div className={`grid grid-cols-1 ${data.reallocNetCents !== 0 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'} gap-4 mb-6`}>
        <StatCard
          label="Dépenses"
          icon={ArrowDownCircle}
          value={<Amount cents={data.totalDepenses} tone="negative" />}
        />
        <StatCard
          label="Recettes"
          icon={ArrowUpCircle}
          value={<Amount cents={data.totalRecettes} tone="positive" />}
        />
        {data.reallocNetCents !== 0 && (
          <StatCard
            label="Réalloc"
            icon={ArrowLeftRight}
            value={<Amount cents={data.reallocNetCents} tone="signed" />}
            sublabel={
              data.reallocEntrantesCents > 0 && data.reallocSortantesCents > 0
                ? `+${(data.reallocEntrantesCents / 100).toFixed(0)} − ${(data.reallocSortantesCents / 100).toFixed(0)}`
                : data.reallocEntrantesCents > 0
                  ? 'entrées'
                  : 'sorties'
            }
          />
        )}
        <StatCard
          label="Solde"
          icon={Scale}
          value={<Amount cents={data.solde} tone="signed" />}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link href={`/ecritures?unite_id=${id}&incomplete=1`} className="block">
          <StatCard
            label="Sans justificatif"
            icon={FileQuestion}
            value={data.alertes.depensesSansJustificatif}
            sublabel="dépenses"
            className="hover:border-foreground/30 transition-colors cursor-pointer"
          />
        </Link>
        <Link href={`/ecritures?unite_id=${id}&status=valide`} className="block">
          <StatCard
            label="Non saisies Comptaweb"
            icon={Upload}
            value={data.alertes.nonSyncComptaweb}
            sublabel="écritures validées"
            className="hover:border-foreground/30 transition-colors cursor-pointer"
          />
        </Link>
      </div>

      <Section
        title="Par catégorie"
        subtitle="Répartition des dépenses et recettes de l'unité par nature comptable SGDF."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        {data.parCategorie.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Aucune écriture sur la période sélectionnée.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Dépenses</TableHead>
                <TableHead className="text-right">Recettes</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">CW#</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.parCategorie.map((c) => (
                <TableRow key={c.category_id ?? 'none'}>
                  <TableCell className="font-medium flex items-center gap-1.5">
                    {c.comptaweb_id === null && c.category_id !== null && (
                      <span
                        className="size-1.5 rounded-full bg-amber-500 shrink-0"
                        title="Pas de mapping Comptaweb — non synchronisable"
                      />
                    )}
                    {c.category_id === null && (
                      <span
                        className="size-1.5 rounded-full bg-rose-500 shrink-0"
                        title="Écritures sans catégorie — à compléter"
                      />
                    )}
                    {c.category_name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.depenses > 0 ? <Amount cents={c.depenses} tone="negative" /> : <span className="text-fg-subtle">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.recettes > 0 ? <Amount cents={c.recettes} tone="positive" /> : <span className="text-fg-subtle">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.budget_prevu_depenses + c.budget_prevu_recettes > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        <Amount cents={c.budget_prevu_depenses + c.budget_prevu_recettes} />
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[11px] text-fg-subtle">
                    {c.comptaweb_id ?? <span className="text-amber-700">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Par activité"
        subtitle="Comparaison prévu (budget) et réel par activité pour cette unité. La dualité activités d'année vs camps se lit dans le nom des activités."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        {data.parActivite.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Aucune activité avec budget ou réel sur la période.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Activité</TableHead>
                <TableHead className="text-right">Prévu dép.</TableHead>
                <TableHead className="text-right">Réel dép.</TableHead>
                <TableHead className="text-right">Prévu rec.</TableHead>
                <TableHead className="text-right">Réel rec.</TableHead>
                <TableHead className="text-right">Écart dép.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.parActivite.map((a) => {
                const ecartDep = a.reel_depenses - a.prevu_depenses;
                return (
                  <TableRow key={a.activite_id ?? '__none__'}>
                    <TableCell className="font-medium">
                      {a.activite_name ?? <span className="text-muted-foreground">— sans activité —</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.prevu_depenses > 0 ? <Amount cents={a.prevu_depenses} /> : <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.reel_depenses > 0 ? <Amount cents={a.reel_depenses} tone="negative" /> : <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.prevu_recettes > 0 ? <Amount cents={a.prevu_recettes} /> : <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.reel_recettes > 0 ? <Amount cents={a.reel_recettes} tone="positive" /> : <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {a.prevu_depenses > 0 ? <Amount cents={ecartDep} tone="signed" /> : <span className="text-fg-subtle">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={`Répartitions de la saison (${data.repartitions.length})`}
        subtitle="Mouvements internes entre unités impactant cette unité. Édition inline du libellé, du montant et de la date."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        <RepartitionsList
          repartitions={data.repartitions}
          unites={unitesRef}
          uniteCourante={id}
          canEdit={ctx.role === 'tresorier' || ctx.role === 'RG'}
        />
      </Section>

      <Section
        title={`Écritures récentes (${data.ecrituresRecentes.length} sur ${data.totalEcritures})`}
        subtitle="Les 50 dernières écritures rattachées à cette unité, dans la période sélectionnée."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        {data.ecrituresRecentes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Aucune écriture rattachée à cette unité sur la période.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ecrituresRecentes.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">{e.date_ecriture}</TableCell>
                    <TableCell>
                      <Link href={`/ecritures?detail=${e.id}`} className="hover:underline underline-offset-2">
                        {e.description}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.category_name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.totalEcritures > data.ecrituresRecentes.length && (
              <div className="px-5 py-3 border-t">
                <Link
                  href={`/ecritures?unite_id=${id}`}
                  className="text-sm text-brand hover:underline underline-offset-2"
                >
                  Voir toutes les écritures de l'unité ({data.totalEcritures}) →
                </Link>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
