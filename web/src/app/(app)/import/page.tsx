import {
  CreditCard,
  FolderTree,
  HandCoins,
  Layers,
  Tags,
  Upload,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Field } from '@/components/shared/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/shared/empty-state';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { SyncReferentielsButton } from '@/components/config/sync-referentiels-button';
import { getDb } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { uploadComptawebCsv } from '@/lib/actions/comptaweb-import';
import {
  getReferentielsCounts,
  type ReferentielCount,
} from '@/lib/services/reference';
import { cn } from '@/lib/utils';

interface SearchParams {
  error?: string;
  imported?: string;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const [imports, refCounts] = await Promise.all([
    getDb()
      .prepare(
        'SELECT * FROM comptaweb_imports ORDER BY import_date DESC LIMIT 50',
      )
      .all<{
        id: string;
        import_date: string;
        source_file: string;
        row_count: number;
        total_depenses_cents: number;
        total_recettes_cents: number;
      }>(),
    getReferentielsCounts({ groupId: ctx.groupId }),
  ]);

  // Le flash "imported" encode "ecritures_creees|fichier".
  let importedFlash: { count: number; fichier: string } | null = null;
  if (params.imported) {
    const [countStr, ...rest] = params.imported.split('|');
    importedFlash = { count: parseInt(countStr, 10) || 0, fichier: rest.join('|') };
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Import Comptaweb"
        subtitle="Synchroniser les référentiels et importer les écritures depuis Comptaweb (Sirom)."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}
      {importedFlash && (
        <Alert variant="success" className="mb-6">
          Import OK :{' '}
          <strong>
            {importedFlash.count} écriture{importedFlash.count > 1 ? 's' : ''}
          </strong>{' '}
          créée{importedFlash.count > 1 ? 's' : ''} depuis{' '}
          <code className="font-mono text-[12.5px]">{importedFlash.fichier}</code>.
        </Alert>
      )}

      <Section
        title="Configurations en place"
        subtitle="Référentiels actuellement chargés. Si un compte est à zéro, lance la synchronisation ci-dessous."
        className="mb-6"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <RefCount
            label="Catégories"
            icon={<Tags size={14} strokeWidth={2} />}
            count={refCounts.categories}
            scope="national"
          />
          <RefCount
            label="Modes paiement"
            icon={<HandCoins size={14} strokeWidth={2} />}
            count={refCounts.modes_paiement}
            scope="national"
          />
          <RefCount
            label="Unités"
            icon={<FolderTree size={14} strokeWidth={2} />}
            count={refCounts.unites}
            scope="groupe"
          />
          <RefCount
            label="Activités"
            icon={<Layers size={14} strokeWidth={2} />}
            count={refCounts.activites}
            scope="groupe"
          />
          <RefCount
            label="Cartes"
            icon={<CreditCard size={14} strokeWidth={2} />}
            count={refCounts.cartes}
            scope="groupe"
          />
        </div>
        <p className="text-[11.5px] text-fg-subtle mt-3">
          <strong>Mappées</strong> = liées à une entrée Comptaweb (synchronisation faite).
          Le reste est local pur (créé côté Baloo, sans correspondance Comptaweb).
        </p>
      </Section>

      <div className="grid gap-6 md:grid-cols-2 mb-8 items-start">
        <Section
          title="Synchroniser les référentiels"
          subtitle="Branches / projets / natures / activités / modes de paiement."
        >
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Récupère depuis Comptaweb les configurations et les ajoute ou remappe en local. Additif
            uniquement — rien n&apos;est supprimé. À relancer après toute modification côté
            Comptaweb (ex. nouvelle branche « Groupe », nouveau projet de camp).
          </p>
          <div className="flex justify-end pt-2">
            <SyncReferentielsButton />
          </div>
        </Section>

        <Section
          title="Importer un fichier CSV"
          subtitle="Export Recettes / Dépenses Comptaweb (5 MB max)."
        >
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Exporte le fichier <em>« Gestion courante — Recettes/Dépenses »</em> depuis Comptaweb
            au format CSV, puis dépose-le ici. L&apos;import crée les écritures manquantes,
            résout les FK (catégorie / unité / mode de paiement) automatiquement quand c&apos;est
            possible.
          </p>
          <form action={uploadComptawebCsv} encType="multipart/form-data" className="space-y-3">
            <Field label="Fichier CSV" htmlFor="csv" required>
              <Input
                id="csv"
                name="csv"
                type="file"
                accept=".csv,text/csv"
                required
                className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
              />
            </Field>
            <div className="flex justify-end">
              <PendingButton size="sm" pendingLabel="Import en cours…">
                <Upload size={13} strokeWidth={2} className="mr-1.5" />
                Importer
              </PendingButton>
            </div>
          </form>
        </Section>
      </div>

      <Section
        title={`Historique des imports (${imports.length})`}
        subtitle="50 derniers imports."
        bodyClassName={imports.length === 0 ? undefined : 'px-0 pb-0'}
      >
        {imports.length === 0 ? (
          <EmptyState
            emoji="📥"
            title="Aucun import pour le moment"
            description="Quand tu lanceras un import (CSV ou via le MCP), il apparaîtra ici avec son bilan."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Fichier</TableHead>
                <TableHead className="text-right">Lignes</TableHead>
                <TableHead className="text-right">Dépenses</TableHead>
                <TableHead className="text-right">Recettes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {i.import_date}
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-muted truncate max-w-xs">
                    {i.source_file}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.row_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Amount cents={i.total_depenses_cents} tone="negative" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Amount cents={i.total_recettes_cents} tone="positive" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

function RefCount({
  label,
  icon,
  count,
  scope,
}: {
  label: string;
  icon: React.ReactNode;
  count: ReferentielCount;
  scope: 'national' | 'groupe';
}) {
  const empty = count.total === 0;
  const partial = !empty && count.mapped < count.total;
  const fullyMapped = !empty && count.mapped === count.total;

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-colors',
        empty
          ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20'
          : 'border-border-soft bg-bg-elevated',
      )}
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-fg-subtle font-medium">
        <span className="inline-flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0 text-[9.5px] font-semibold',
            scope === 'national'
              ? 'bg-bg-sunken text-fg-muted'
              : 'bg-brand/10 text-brand',
          )}
          title={scope === 'national' ? 'Référentiel national SGDF' : 'Spécifique au groupe'}
        >
          {scope === 'national' ? 'SGDF' : 'groupe'}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={cn(
            'tabular-nums font-semibold text-[20px] leading-none',
            empty ? 'text-amber-700 dark:text-amber-300' : 'text-fg',
          )}
        >
          {count.total}
        </span>
        {!empty && (
          <span className="text-[11px] text-fg-muted tabular-nums">
            dont{' '}
            <span
              className={cn(
                'font-medium',
                fullyMapped ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg',
              )}
            >
              {count.mapped} mappée{count.mapped > 1 ? 's' : ''}
            </span>
          </span>
        )}
      </div>
      {empty && (
        <p className="text-[10.5px] text-amber-700 dark:text-amber-400 mt-1">
          aucune entrée — synchronise
        </p>
      )}
      {partial && (
        <p className="text-[10.5px] text-fg-subtle mt-1">
          {count.total - count.mapped} local{count.total - count.mapped > 1 ? 'es' : 'e'} sans mapping
        </p>
      )}
    </div>
  );
}
