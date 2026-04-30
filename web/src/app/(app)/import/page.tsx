import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { EmptyState } from '@/components/shared/empty-state';
import { Amount } from '@/components/shared/amount';
import { SyncReferentielsButton } from '@/components/config/sync-referentiels-button';
import { getDb } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';

export default async function ImportPage() {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);
  const imports = await getDb()
    .prepare('SELECT * FROM comptaweb_imports ORDER BY import_date DESC')
    .all<{
      id: string;
      import_date: string;
      source_file: string;
      row_count: number;
      total_depenses_cents: number;
      total_recettes_cents: number;
    }>();

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Import Comptaweb"
        subtitle="Synchroniser les référentiels et importer les écritures depuis Comptaweb (Sirom)."
      />

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

        <Section title="Importer un fichier CSV" subtitle="Export Recettes / Dépenses Comptaweb.">
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Exporte le fichier <em>« Gestion courante — Recettes/Dépenses »</em> depuis Comptaweb
            au format CSV, puis dépose-le dans le dossier{' '}
            <code className="font-mono text-[12.5px] bg-bg-sunken px-1.5 py-0.5 rounded">
              inbox/
            </code>{' '}
            et utilise le MCP{' '}
            <code className="font-mono text-[12.5px] bg-bg-sunken px-1.5 py-0.5 rounded">
              import_comptaweb_csv
            </code>{' '}
            via Claude Code.
          </p>
          <p className="text-[12px] text-fg-subtle italic">
            L&apos;import par upload direct dans l&apos;interface arrive bientôt.
          </p>
        </Section>
      </div>

      <h2 className="text-h2 mb-4">Historique des imports</h2>
      {imports.length === 0 ? (
        <EmptyState
          emoji="📥"
          title="Aucun import pour le moment"
          description="Quand tu lanceras un import via le MCP, il apparaîtra ici avec son bilan."
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
                <TableCell>{i.import_date}</TableCell>
                <TableCell>{i.source_file}</TableCell>
                <TableCell className="text-right">{i.row_count}</TableCell>
                <TableCell className="text-right">
                  <Amount cents={i.total_depenses_cents} tone="negative" />
                </TableCell>
                <TableCell className="text-right">
                  <Amount cents={i.total_recettes_cents} tone="positive" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
