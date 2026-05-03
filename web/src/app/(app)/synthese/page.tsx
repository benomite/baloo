import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { getOverview } from '@/lib/queries/overview';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  FileQuestion,
  Scale,
  Upload,
} from 'lucide-react';

export default async function SynthesePage() {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const data = await getOverview();

  return (
    <div>
      <PageHeader
        title="Synthèse"
        subtitle="Vue agrégée de la trésorerie du groupe — KPIs et répartition par unité."
      />

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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
      </div>

      <Section
        title="Par unité"
        subtitle="Vue agrégée des dépenses et recettes par unité du groupe."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unité</TableHead>
              <TableHead className="text-right">Dépenses</TableHead>
              <TableHead className="text-right">Recettes</TableHead>
              <TableHead className="text-right">Solde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.parUnite.map((u) => (
              <TableRow
                key={u.code}
                // Rail vertical 3px de la couleur de l'unité à gauche +
                // teinte de fond ultra-douce (~6% alpha) pour donner un
                // visuel "par unité" au coup d'œil sans nuire à la
                // lisibilité.
                style={
                  u.couleur
                    ? {
                        boxShadow: `inset 3px 0 0 0 ${u.couleur}`,
                        backgroundColor: `${u.couleur}0F`,
                      }
                    : undefined
                }
              >
                <TableCell className="font-medium">
                  {u.code} — {u.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Amount cents={u.depenses} tone="negative" />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Amount cents={u.recettes} tone="positive" />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  <Amount cents={u.solde} tone="signed" />
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
