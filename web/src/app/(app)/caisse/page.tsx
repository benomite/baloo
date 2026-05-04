import { Coins, Plus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { listMouvementsCaisse } from '@/lib/queries/caisse';
import { listSelectableUnites, listSelectableActivites } from '@/lib/queries/reference';
import { createMouvementCaisse } from '@/lib/actions/caisse';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';

export default async function CaissePage() {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);
  const [{ mouvements, solde }, unites, activites] = await Promise.all([
    listMouvementsCaisse(),
    listSelectableUnites(),
    listSelectableActivites(),
  ]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Caisse"
        subtitle="Mouvements en espèces du groupe (quêtes, achats au comptant, etc.)."
      />

      <div className="mb-6 max-w-xs">
        <StatCard label="Solde caisse" icon={Coins} value={<Amount cents={solde} tone="signed" />} />
      </div>

      <Section
        title="Nouveau mouvement"
        subtitle="Une entrée (recette) ou une sortie (dépense) en espèces."
        className="mb-6"
      >
        <form action={createMouvementCaisse} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Sens" htmlFor="sens" required>
              <NativeSelect id="sens" name="sens" defaultValue="sortie">
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
            <Field label="Date" htmlFor="date_mouvement" required>
              <Input
                type="date"
                id="date_mouvement"
                name="date_mouvement"
                required
                defaultValue={today}
              />
            </Field>
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
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
            <Field label="Description" htmlFor="description" required>
              <Input
                id="description"
                name="description"
                required
                placeholder="Ex. quête camp été"
              />
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
              Ajouter
            </PendingButton>
          </div>
        </form>
      </Section>

      {mouvements.length === 0 ? (
        <EmptyState
          emoji="🪙"
          title="Caisse encore vierge"
          description="Pas encore de mouvement enregistré. Ajoute le premier ci-dessus quand une recette ou une dépense en espèces passe par la caisse du groupe."
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
                <TableHead>Description</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead>Activité</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right">Solde après</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mouvements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {m.date_mouvement}
                  </TableCell>
                  <TableCell>{m.description}</TableCell>
                  <TableCell>{m.unite_code ?? '—'}</TableCell>
                  <TableCell>{m.activite_name ?? '—'}</TableCell>
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
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}
