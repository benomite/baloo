import {
  ChevronDown,
  CreditCard,
  FolderTree,
  HandCoins,
  Layers,
  Link2,
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
  getReferentielsDetails,
  getUnitesGroupedByBranche,
  type ReferentielCount,
  type RefDetailRow,
  type BrancheGroup,
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
  const [imports, refCounts, refDetails, unitesGrouped] = await Promise.all([
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
    getReferentielsDetails({ groupId: ctx.groupId }),
    getUnitesGroupedByBranche({ groupId: ctx.groupId }),
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

      {/* === Bloc 1 : Configurations / Référentiels (usage récurrent) === */}
      <Section
        title="Configurations Comptaweb"
        subtitle="Branches, projets, natures, modes de paiement, cartes. À synchroniser dès qu une config bouge côté Comptaweb."
        action={<SyncReferentielsButton />}
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
          <strong>Mappées</strong> = liées à une entrée Comptaweb (sync faite).
          Le reste est local pur (créé côté Baloo, sans correspondance Comptaweb).
          Sync additive uniquement, rien n&apos;est jamais supprimé.
        </p>

        <div className="mt-4 pt-4 border-t border-border-soft space-y-1">
          <p className="text-[12px] uppercase tracking-wide font-medium text-fg-subtle mb-2">
            Inspecter le détail
          </p>
          <RefDetail label="Catégories" rows={refDetails.categories} icon={<Tags size={13} strokeWidth={2} />} />
          <RefDetail label="Modes de paiement" rows={refDetails.modes_paiement} icon={<HandCoins size={13} strokeWidth={2} />} />
          <RefDetail label="Unités" rows={refDetails.unites} icon={<FolderTree size={13} strokeWidth={2} />} />
          <RefDetail label="Activités" rows={refDetails.activites} icon={<Layers size={13} strokeWidth={2} />} />
          <RefDetail label="Cartes" rows={refDetails.cartes} icon={<CreditCard size={13} strokeWidth={2} />} />
        </div>
      </Section>

      {/* === Bloc 1bis : Unités groupées par branche SGDF === */}
      <Section
        title="Unités du groupe (par branche SGDF)"
        subtitle="1 ligne Comptaweb = 1 unité. Plusieurs unités peuvent partager la même branche d age (donc la même couleur de la charte)."
        className="mb-6"
      >
        {unitesGrouped.groups.length === 0 && unitesGrouped.orphans.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted italic">
            Aucune unité encore détectée. Lance la synchronisation des configurations ci-dessus.
          </p>
        ) : (
          <div className="space-y-2">
            {unitesGrouped.groups.map((g) => (
              <BrancheCard key={g.spec.code} group={g} />
            ))}
            {unitesGrouped.orphans.length > 0 && (
              <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide font-medium text-amber-800 dark:text-amber-300 mb-1.5">
                  Unités sans branche détectée ({unitesGrouped.orphans.length})
                </div>
                <p className="text-[11.5px] text-amber-800 dark:text-amber-300/90 mb-2">
                  Aucune branche SGDF n a pu être déduite du libellé. À mapper manuellement (édition unité à venir).
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5 text-[12px]">
                  {unitesGrouped.orphans.map((o) => (
                    <li key={o.id} className="text-fg flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-amber-500/60 shrink-0" />
                      {o.name}
                      <span className="text-fg-subtle font-mono text-[10.5px] ml-auto">
                        {o.code}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* === Bloc 2 : Historique des imports CSV === */}
      <Section
        title={`Historique des imports (${imports.length})`}
        subtitle="50 derniers imports CSV. Sert à tracer ce qui a été fait à l onboarding ou en réimport ponctuel."
        className="mb-6"
        bodyClassName={imports.length === 0 ? undefined : 'px-0 pb-0'}
      >
        {imports.length === 0 ? (
          <EmptyState
            emoji="📥"
            title="Aucun import pour le moment"
            description="Quand tu lanceras un import CSV, il apparaîtra ici avec son bilan."
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

      {/* === Bloc 3 : Import CSV (ponctuel, en repli) === */}
      <details className="rounded-xl border border-dashed border-border-soft bg-bg-elevated/40 px-5 py-4 group">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Upload size={14} strokeWidth={2} className="text-fg-subtle" />
            <div>
              <span className="text-[13.5px] font-semibold text-fg">
                Import CSV ponctuel
              </span>
              <span className="ml-2 text-[11.5px] text-fg-subtle">
                onboarding ou réimport spécial — rare
              </span>
            </div>
          </div>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className="text-fg-subtle transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-4 pt-4 border-t border-border-soft">
          <p className="text-[12.5px] text-fg-muted leading-relaxed mb-3">
            Exporte le fichier <em>« Gestion courante — Recettes/Dépenses »</em> depuis Comptaweb
            au format CSV (5 Mo max), puis dépose-le ici. L&apos;import crée les écritures
            manquantes et résout automatiquement les FK (catégorie / unité / mode de paiement)
            quand c&apos;est possible.
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
        </div>
      </details>
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

function BrancheCard({ group }: { group: BrancheGroup }) {
  const couleur = group.spec.couleur;
  return (
    <div className="rounded-lg border border-border-soft bg-bg-elevated overflow-hidden">
      <div
        className="px-3 py-2 flex items-center gap-2.5"
        style={{ boxShadow: `inset 3px 0 0 0 ${couleur}` }}
      >
        <span
          className="size-2.5 rounded-full shrink-0 ring-1 ring-black/5"
          style={{ backgroundColor: couleur }}
          aria-hidden
        />
        <span className="font-semibold text-[13.5px] text-fg">{group.spec.nom}</span>
        <span className="text-[10.5px] uppercase tracking-wide text-fg-subtle font-mono bg-bg-sunken rounded px-1">
          {group.spec.code}
        </span>
        <span className="text-[11.5px] text-fg-muted ml-auto">
          {group.unites.length} unité{group.unites.length > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="border-t border-border-soft divide-y divide-border-soft/60 bg-bg-sunken/30">
        {group.unites.map((u) => (
          <li key={u.id} className="px-3 py-1.5 flex items-center gap-2 text-[12.5px]">
            <span className="text-fg-muted font-mono text-[10.5px]">{u.code}</span>
            <span className="text-fg flex-1 truncate">{u.name}</span>
            {u.comptaweb_id !== null && (
              <span className="text-[10.5px] text-fg-subtle tabular-nums">
                cw#{u.comptaweb_id}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefDetail({
  label,
  rows,
  icon,
}: {
  label: string;
  rows: RefDetailRow[];
  icon: React.ReactNode;
}) {
  return (
    <details className="group/refdetail rounded-md hover:bg-bg-sunken/40 transition-colors">
      <summary className="cursor-pointer list-none px-2 py-1.5 flex items-center justify-between gap-2 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-fg">
          <ChevronDown
            size={11}
            strokeWidth={2.25}
            className="text-fg-subtle transition-transform -rotate-90 group-open/refdetail:rotate-0"
          />
          {icon}
          {label}
          <span className="text-fg-subtle font-normal">({rows.length})</span>
        </span>
      </summary>
      <div className="mt-1 ml-5 mr-2 mb-2">
        {rows.length === 0 ? (
          <p className="text-[11.5px] text-fg-subtle italic px-2 py-1">
            (vide — synchronise pour récupérer la liste)
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-1.5 text-[12px] py-0.5"
              >
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full shrink-0',
                    r.comptaweb_id !== null
                      ? 'bg-emerald-500'
                      : 'bg-fg-subtle/40',
                  )}
                  title={
                    r.comptaweb_id !== null
                      ? `Mappé Comptaweb #${r.comptaweb_id}`
                      : 'Local sans mapping'
                  }
                />
                <span className="text-fg truncate">{r.label}</span>
                {r.badge && (
                  <span className="text-[10px] uppercase tracking-wide text-fg-subtle bg-bg-sunken rounded px-1">
                    {r.badge}
                  </span>
                )}
                {r.comptaweb_id !== null && (
                  <span className="text-[10.5px] text-fg-subtle tabular-nums ml-auto inline-flex items-center gap-0.5">
                    <Link2 size={9} strokeWidth={2} />
                    {r.comptaweb_id}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
