import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { TabLink } from '@/components/shared/tab-link';
import { getOverview } from '@/lib/queries/overview';
import { currentExercice } from '@/lib/services/overview';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';
import { UnitesGrid } from '@/components/synthese/unites-grid';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  FileQuestion,
  Layers,
  Scale,
  Upload,
} from 'lucide-react';

interface SearchParams {
  exercice?: string; // ex: '2025-2026' = Sept 2025 → Août 2026 ; ou 'tous'
}

// Génère la liste des 3 derniers exercices SGDF + le courant.
function exerciceOptions(): { value: string; label: string }[] {
  const cur = currentExercice();
  const curStart = parseInt(cur.split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({
      value: `${y}-${y + 1}`,
      label: `Sept ${y} → Août ${y + 1}`,
    });
  }
  return opts;
}

export default async function SynthesePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const sp = await searchParams;
  // Par défaut : exercice courant (= comparable au compte de résultat
  // Comptaweb). Le user peut basculer sur "Tous" pour voir l'agrégat
  // historique total.
  const cur = currentExercice();
  const exerciceParam = sp.exercice ?? cur;
  const exerciceFilter = exerciceParam === 'tous' ? null : exerciceParam;
  const data = await getOverview({ exercice: exerciceFilter });

  const options = exerciceOptions();

  return (
    <div>
      <PageHeader
        title="Synthèse"
        subtitle="Vue agrégée de la trésorerie du groupe — KPIs et répartition par unité."
      />

      {/* Sélecteur d'exercice : pivote l'agrégation. Onglet "Tous"
          pour comparer historique total ; un par exercice SGDF récent
          pour comparer au compte de résultat Comptaweb (qui filtre
          aussi par exercice). */}
      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink
            key={o.value}
            href={`/synthese?exercice=${o.value}`}
            active={exerciceParam === o.value}
          >
            {o.label}
          </TabLink>
        ))}
        <TabLink href="/synthese?exercice=tous" active={exerciceParam === 'tous'}>
          Tous
        </TabLink>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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
        <StatCard
          label="Solde"
          icon={Scale}
          value={<Amount cents={data.solde} tone="signed" />}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Remb. en attente"
          icon={Clock}
          value={data.remboursementsEnAttente.count}
          sublabel={data.remboursementsEnAttente.totalFormatted}
        />
        <StatCard
          label="Sans justificatif"
          icon={FileQuestion}
          value={data.alertes.depensesSansJustificatif}
          sublabel="dépenses"
        />
        <StatCard
          label="Non saisies Comptaweb"
          icon={Upload}
          value={data.alertes.nonSyncComptaweb}
          sublabel="écritures validées"
        />
        <Link href="/ecritures?sans_unite=1" className="block">
          <StatCard
            label="Sans unité"
            icon={Layers}
            value={data.alertes.ecrituresSansUnite}
            sublabel={
              data.alertes.remboursementsSansUnite + data.alertes.caisseSansUnite > 0
                ? `+ ${data.alertes.remboursementsSansUnite} remb, ${data.alertes.caisseSansUnite} caisse`
                : 'écritures'
            }
            className="hover:border-foreground/30 transition-colors cursor-pointer"
          />
        </Link>
      </div>

      <Section
        title="Par unité"
        subtitle="Cliquez sur une unité pour voir le détail des dépenses et de la répartition par catégorie."
        className="mb-8"
      >
        <UnitesGrid
          unites={data.parUnite.map((u) => ({
            id: u.id,
            code: u.code,
            name: u.name,
            couleur: u.couleur,
            depenses: u.depenses,
            recettes: u.recettes,
            solde: u.solde,
          }))}
          exerciceParam={exerciceParam}
        />
      </Section>

      <Section
        title="Par catégorie (comparable au compte de résultat Comptaweb)"
        subtitle="Agrégat ligne par ligne. Une catégorie sans comptaweb_id ne sera jamais sync — ses montants peuvent expliquer un écart avec le CR Comptaweb."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-right">Dépenses</TableHead>
              <TableHead className="text-right">Recettes</TableHead>
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
                <TableCell className="text-right tabular-nums text-[11px] text-fg-subtle">
                  {c.comptaweb_id ?? <span className="text-amber-700">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {data.dernierImport ? (
        <p className="text-[12px] text-fg-muted inline-flex items-center gap-1.5">
          <AlertTriangle size={13} strokeWidth={1.75} className="text-fg-subtle" />
          Dernier import Comptaweb :{' '}
          <span className="tabular-nums">{data.dernierImport.date}</span> ({data.dernierImport.fichier})
        </p>
      ) : (
        <p className="text-[12px] text-fg-muted">
          Aucun import Comptaweb.{' '}
          <Link href="/import" className="text-brand hover:underline underline-offset-2">
            Importer un CSV
          </Link>
        </p>
      )}
    </div>
  );
}
