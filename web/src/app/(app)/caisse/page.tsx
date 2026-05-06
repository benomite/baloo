import { Coins, Plus, Banknote, ArrowDownToLine, Link2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import {
  listMouvementsCaisse,
  listDepotsAvecCandidates,
  countCaisseOrphans,
} from '@/lib/queries/caisse';
import { listSelectableUnites, listSelectableActivites } from '@/lib/queries/reference';
import {
  createMouvementCaisse,
  createDepotEspecesAction,
  rapprocherDepotEspecesAction,
  syncCaisseFromComptawebAction,
  archiveOrphanedCaisseRowsAction,
  quickAddCaisse,
} from '@/lib/actions/caisse';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import type { MouvementCaisseStatus, MouvementCaisseType } from '@/lib/types';

const TYPE_LABEL: Record<MouvementCaisseType, string> = {
  entree: '↗ Entrée',
  sortie: '↘ Sortie',
  depot: '🏦 Dépôt',
};

const STATUS_LABEL: Record<MouvementCaisseStatus, string> = {
  saisi: 'Saisi',
  depose: 'Déposé',
  rapproche: 'Rapproché',
};

const STATUS_TONE: Record<MouvementCaisseStatus, 'outline' | 'secondary' | 'default'> = {
  saisi: 'outline',
  depose: 'secondary',
  rapproche: 'default',
};

interface CaisseSearchParams {
  qa_ok?: string;
  qa_error?: string;
  qa_input?: string;
}

export default async function CaissePage({
  searchParams,
}: {
  searchParams: Promise<CaisseSearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const [{ mouvements, solde }, depotsPending, orphans, unites, activites] = await Promise.all([
    listMouvementsCaisse(),
    listDepotsAvecCandidates(),
    countCaisseOrphans(),
    listSelectableUnites(),
    listSelectableActivites(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const depotsEnAttente = depotsPending.length;
  const totalEnAttente = depotsPending.reduce((sum, d) => sum + d.depot.total_amount_cents, 0);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Caisse"
        subtitle="Mouvements en espèces du groupe (quêtes, ventes calendriers, dépôts en banque)."
        actions={
          <form action={syncCaisseFromComptawebAction}>
            <PendingButton
              variant="outline"
              size="sm"
              pendingLabel="Synchronisation…"
            >
              <RefreshCw size={14} strokeWidth={2} className="mr-1.5" />
              Synchroniser Comptaweb
            </PendingButton>
          </form>
        }
      />

      <QuickAddBox params={params} />

      {(orphans.mouvementsOrphelins > 0 || orphans.depotsOrphelins > 0) && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-amber-900">
              {orphans.mouvementsOrphelins + orphans.depotsOrphelins} ligne(s) potentiellement
              dupliquées avec Comptaweb
            </div>
            <div className="text-amber-800/80">
              {orphans.mouvementsOrphelins > 0 && (
                <>
                  {orphans.mouvementsOrphelins} mouvement(s) issu(s) de l'import historique sans
                  correspondance Comptaweb
                  {orphans.depotsOrphelins > 0 ? ' · ' : '.'}
                </>
              )}
              {orphans.depotsOrphelins > 0 && (
                <>{orphans.depotsOrphelins} dépôt(s) en attente déjà rapproché(s) côté Comptaweb.</>
              )}{' '}
              Archive-les pour aligner Baloo sur Comptaweb (les lignes restent en BDD, juste
              masquées).
            </div>
          </div>
          <form action={archiveOrphanedCaisseRowsAction}>
            <PendingButton variant="outline" size="sm" pendingLabel="Archivage…">
              <Trash2 size={14} strokeWidth={2} className="mr-1.5" />
              Nettoyer les doublons
            </PendingButton>
          </form>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Solde caisse" icon={Coins} value={<Amount cents={solde} tone="signed" />} />
        <StatCard
          label={`Dépôts en attente${depotsEnAttente ? ` (${depotsEnAttente})` : ''}`}
          icon={Banknote}
          value={<Amount cents={totalEnAttente} tone="muted" />}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Saisir une entrée / sortie"
          subtitle="Argent qui entre ou sort de la caisse en espèces."
        >
          <form action={createMouvementCaisse} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sens" htmlFor="sens" required>
                <NativeSelect id="sens" name="sens" defaultValue="entree">
                  <option value="entree">↗ Entrée (recette)</option>
                  <option value="sortie">↘ Sortie (dépense)</option>
                </NativeSelect>
              </Field>
              <Field label="Montant" htmlFor="montant" required hint="format 15,00">
                <Input
                  id="montant"
                  name="montant"
                  required
                  placeholder="15,00"
                  inputMode="decimal"
                  className="tabular-nums"
                />
              </Field>
            </div>
            <Field label="Date" htmlFor="date_mouvement" required>
              <Input
                type="date"
                id="date_mouvement"
                name="date_mouvement"
                required
                defaultValue={today}
              />
            </Field>
            <Field label="Description" htmlFor="description" required>
              <Input
                id="description"
                name="description"
                required
                placeholder="Ex. quête camp été"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unité" htmlFor="unite_id" hint="optionnel">
                <NativeSelect id="unite_id" name="unite_id">
                  <option value="">— Groupe —</option>
                  {unites.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Activité" htmlFor="activite_id" hint="optionnel">
                <NativeSelect id="activite_id" name="activite_id">
                  <option value="">— Aucune —</option>
                  {activites.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex justify-end">
              <PendingButton>
                <Plus size={14} strokeWidth={2} className="mr-1.5" />
                Enregistrer
              </PendingButton>
            </div>
          </form>
        </Section>

        <Section
          title="Faire un dépôt en banque"
          subtitle="Sortie d'espèces pour versement sur le compte. Crée le mouvement caisse négatif et le dépôt à rapprocher."
        >
          <form action={createDepotEspecesAction} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date du dépôt" htmlFor="date_depot" required>
                <Input
                  type="date"
                  id="date_depot"
                  name="date_depot"
                  required
                  defaultValue={today}
                />
              </Field>
              <Field label="Montant total" htmlFor="montant" required hint="format 250,00">
                <Input
                  id="montant"
                  name="montant"
                  required
                  placeholder="250,00"
                  inputMode="decimal"
                  className="tabular-nums"
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="description" hint="optionnel">
              <Input
                id="description"
                name="description"
                placeholder={`Ex. Dépôt ${today.split('-').reverse().slice(0, 2).join('/')}`}
              />
            </Field>
            <Field label="Notes" htmlFor="notes" hint="optionnel (détail billets, etc.)">
              <Input id="notes" name="notes" placeholder="Ex. 5×50€ + 5×20€ + ..." />
            </Field>
            <div className="flex justify-end">
              <PendingButton>
                <ArrowDownToLine size={14} strokeWidth={2} className="mr-1.5" />
                Enregistrer le dépôt
              </PendingButton>
            </div>
          </form>
        </Section>
      </div>

      {depotsPending.length > 0 && (
        <Section
          title={`Dépôts à rapprocher (${depotsPending.length})`}
          subtitle="Lie chaque dépôt à la ligne « Versement espèces » correspondante du compte bancaire (importée via Comptaweb)."
          className="mb-6"
        >
          <div className="space-y-3">
            {depotsPending.map(({ depot, candidates }) => (
              <div
                key={depot.id}
                className="rounded-lg border border-border bg-bg-base p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-medium tabular-nums">
                    <Amount cents={depot.total_amount_cents} />
                  </span>
                  <span className="text-sm text-fg-muted tabular-nums">
                    {depot.date_depot}
                  </span>
                  <span className="text-xs text-fg-muted">{depot.id}</span>
                  {depot.notes && (
                    <span className="text-xs text-fg-muted italic">{depot.notes}</span>
                  )}
                </div>
                {candidates.length === 0 ? (
                  <span className="text-sm text-fg-muted">
                    Aucune écriture banque candidate (importe / actualise Comptaweb).
                  </span>
                ) : (
                  <form
                    action={rapprocherDepotEspecesAction}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="depot_id" value={depot.id} />
                    <NativeSelect
                      name="ecriture_id"
                      defaultValue={candidates[0]?.id ?? ''}
                      className="min-w-64"
                    >
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.date_ecriture} · {(c.amount_cents / 100).toFixed(2).replace('.', ',')}
                          € · {c.description}
                        </option>
                      ))}
                    </NativeSelect>
                    <PendingButton variant="outline" size="sm">
                      <Link2 size={14} strokeWidth={2} className="mr-1.5" />
                      Rapprocher
                    </PendingButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {mouvements.length === 0 ? (
        <EmptyState
          emoji="🪙"
          title="Caisse encore vierge"
          description="Pas encore de mouvement enregistré. Saisis la première entrée ou le premier dépôt ci-dessus."
        />
      ) : (
        <Section
          title={`Historique (${mouvements.length})`}
          subtitle="Du plus récent au plus ancien."
          bodyClassName="px-0 pb-0"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>N° pièce</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right">Solde après</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mouvements.map((m) => {
                const t = m.type ?? (m.amount_cents >= 0 ? 'entree' : 'sortie');
                return (
                  <TableRow key={m.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {m.date_mouvement}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {TYPE_LABEL[t]}
                    </TableCell>
                    <TableCell>{m.description}</TableCell>
                    <TableCell className="text-xs text-fg-muted tabular-nums">
                      {m.numero_piece ?? '—'}
                    </TableCell>
                    <TableCell>{m.unite_code ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      <Amount cents={m.amount_cents} tone="signed" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.solde_apres_cents != null ? (
                        <Amount cents={m.solde_apres_cents} tone="muted" />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function QuickAddBox({ params }: { params: CaisseSearchParams }) {
  const okMsg = params.qa_ok;
  const errMsg = params.qa_error;
  const initialInput = params.qa_input ?? '';

  // Décode le message ok pour afficher l'unité détectée le cas échéant.
  let okDetails: string | null = null;
  if (okMsg && okMsg !== '1') {
    const uniteTag = okMsg.split('|').find((p) => p.startsWith('unite='));
    if (uniteTag) okDetails = `Unité détectée : ${uniteTag.slice(6)}`;
  }

  return (
    <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} strokeWidth={2} className="text-brand" />
        <h2 className="text-[13px] font-semibold text-fg">Saisie express</h2>
      </div>
      <form action={quickAddCaisse} className="flex flex-wrap items-center gap-2">
        <Input
          name="input"
          required
          autoFocus
          defaultValue={initialInput}
          placeholder="+180 extra-job rouges  ·  -25 chocolat caravelles  ·  +50 tombola"
          className="flex-1 min-w-[280px] font-mono"
          aria-label="Saisie rapide caisse"
        />
        <PendingButton size="sm">Saisir</PendingButton>
      </form>
      <p className="mt-1.5 text-[11.5px] text-fg-subtle">
        Format : <code className="font-mono">[+/-]montant description [unité]</code>{' '}
        — pas de signe = entrée. L&apos;unité (code, nom, ou couleur SGDF :
        rouges/oranges/bleus/verts/violets) est auto-détectée.
      </p>
      {okMsg && (
        <Alert variant="success" className="mt-3">
          ✨ Mouvement enregistré.
          {okDetails && <span className="ml-1 text-fg-muted">{okDetails}</span>}
          {okMsg.includes('warn') && (
            <span className="ml-1 text-amber-700">⚠ Voir les notes.</span>
          )}
        </Alert>
      )}
      {errMsg && (
        <Alert variant="error" className="mt-3">
          {errMsg}
        </Alert>
      )}
    </div>
  );
}
