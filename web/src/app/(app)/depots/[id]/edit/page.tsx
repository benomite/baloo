import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { CategoryPicker } from '@/components/shared/category-picker';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { isAdminRole } from '@/components/layout/nav-config';
import { canEditDepot, canViewDepot, getDepot } from '@/lib/services/depots';
import {
  listUnites,
  listCategories,
  listCartes,
  getTopCategoryIds,
  listSelectableActivites,
} from '@/lib/queries/reference';
import { updateDepot } from '@/lib/actions/depots';
import { formatAmount } from '@/lib/format';
import { keepSelectable, isUnmapped } from '@/lib/selectable';

interface SearchParams {
  error?: string;
}

// Édition d'un dépôt par son déposeur (ou un admin) tant qu'il est « à
// traiter ». Les pièces jointes ne sont pas modifiables ici (hors périmètre v1).
export default async function EditDepotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const [sp, ctx] = await Promise.all([searchParams, getCurrentContext()]);

  const depot = await getDepot({ groupId: ctx.groupId }, id);
  if (!depot) notFound();
  const actor = { userId: ctx.userId, isAdmin: isAdminRole(ctx.role) };
  if (!canViewDepot(depot, actor)) notFound();
  if (!canEditDepot(depot, actor)) {
    redirect(
      `/depots/${id}?error=` +
        encodeURIComponent('Ce dépôt n’est plus modifiable (il n’est plus à traiter).'),
    );
  }

  const [unitesAll, categoriesAll, cartesAll, topCategoryIds, activites] = await Promise.all([
    listUnites(),
    listCategories(),
    listCartes(),
    getTopCategoryIds(5),
    listSelectableActivites(),
  ]);
  const unites = keepSelectable(unitesAll, depot.unite_id);
  const categories = keepSelectable(categoriesAll, depot.category_id);
  const cartes = keepSelectable(cartesAll, depot.carte_id);
  const amountInput =
    depot.amount_cents != null ? formatAmount(depot.amount_cents).replace(' €', '') : '';

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Dépôt', href: `/depots/${id}` }}
        title={`Modifier ${depot.id}`}
        subtitle="Tu peux corriger le dépôt tant que le trésorier ne l’a pas traité."
      />

      {sp.error && (
        <Alert variant="error" className="mb-6">
          {sp.error}
        </Alert>
      )}

      <form action={updateDepot} className="space-y-6">
        <input type="hidden" name="id" value={depot.id} />
        <input type="hidden" name="from" value="detail" />
        <Section title="Le dépôt">
          <Field label="Titre" htmlFor="titre" required>
            <Input id="titre" name="titre" required defaultValue={depot.titre} />
          </Field>
          <Field label="Description" htmlFor="description" hint="optionnel">
            <Textarea id="description" name="description" rows={2} defaultValue={depot.description ?? ''} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Montant TTC" htmlFor="amount" hint="optionnel">
              <Input
                id="amount"
                name="amount"
                defaultValue={amountInput}
                placeholder="42,50"
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field label="Date de la dépense" htmlFor="date_estimee">
              <Input id="date_estimee" name="date_estimee" type="date" defaultValue={depot.date_estimee ?? ''} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Catégorie" htmlFor="category_id">
              <CategoryPicker
                id="category_id"
                name="category_id"
                categories={categories.map((c) => ({ id: c.id, name: c.name, unmapped: isUnmapped(c), type: c.type }))}
                topIds={topCategoryIds}
                defaultValue={depot.category_id}
              />
            </Field>
            <Field label="Unité" htmlFor="unite_id">
              <NativeSelect id="unite_id" name="unite_id" defaultValue={depot.unite_id ?? ''}>
                <option value="">— Aucune —</option>
                {unites.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Activité / camp" htmlFor="activite_id" hint="optionnel">
              <NativeSelect id="activite_id" name="activite_id" defaultValue={depot.activite_id ?? ''}>
                <option value="">— Aucune —</option>
                {activites.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Carte utilisée" htmlFor="carte_id">
              <NativeSelect id="carte_id" name="carte_id" defaultValue={depot.carte_id ?? ''}>
                <option value="">— Aucune / Espèces / Virement —</option>
                {cartes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.type === 'cb' ? 'CB' : 'Procurement'} · {c.porteur}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </Section>
        <div className="flex justify-end">
          <PendingButton>Enregistrer les modifications</PendingButton>
        </div>
      </form>
    </div>
  );
}
