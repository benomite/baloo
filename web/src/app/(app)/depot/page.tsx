import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { requireCanSubmit } from '@/lib/auth/access';
import { listUnites, listCategories, listCartes, getTopCategoryIds, listSelectableActivites } from '@/lib/queries/reference';
import { createDepot } from '@/lib/actions/depots';
import { CategoryPicker } from '@/components/shared/category-picker';
import { JustifMultiCapture } from '@/components/shared/justif-multi-capture';
import { keepSelectable, isUnmapped } from '@/lib/selectable';

interface SearchParams {
  error?: string;
  success?: string;
  activite?: string;
  unite?: string;
}

export default async function DepotPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireCanSubmit(ctx.role);

  const params = await searchParams;
  const [unitesAll, categoriesAll, cartesAll, topCategoryIds, activites] = await Promise.all([
    listUnites(),
    listCategories(),
    listCartes(),
    getTopCategoryIds(5),
    listSelectableActivites(),
  ]);
  // Pas de valeur courante (création), on filtre simplement les non-mappés.
  const unites = keepSelectable(unitesAll, null);
  const categories = keepSelectable(categoriesAll, null);
  const cartes = keepSelectable(cartesAll, null);

  const today = new Date().toISOString().split('T')[0];
  // Pré-sélection : l'unité de l'URL, sinon l'unique unité du chef (s'il n'en
  // a qu'une), sinon rien (choix libre / plusieurs unités).
  const defaultUnite = params.unite ?? (ctx.scopeUniteIds.length === 1 ? ctx.scopeUniteIds[0] : '');

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Déposer un justificatif"
        subtitle="Le justif d'une dépense déjà payée par le groupe (carte, virement…). Le trésorier le rapproche ensuite avec l'écriture. Ici, rien ne t'est reversé."
      />

      <Alert variant="info" className="mb-6">
        Tu as <b>avancé de l&apos;argent de ta poche</b> et tu veux être remboursé ?
        {' '}<Link href="/remboursements/nouveau" className="font-medium underline underline-offset-2">Fais plutôt une demande de remboursement</Link>.
      </Alert>

      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      {params.success && (
        <Alert variant="success" className="mb-6">
          Justificatif déposé (réf. <b>{params.success}</b>). Tu peux en déposer un autre ci-dessous.
        </Alert>
      )}

      <form action={createDepot} encType="multipart/form-data" className="space-y-6">
        <Section title="Le justificatif" subtitle="Photo, PDF ou scan. Tu peux joindre plusieurs pièces (ticket + facture, recto/verso…).">
          <Field label="Fichiers" htmlFor="file" required hint="une ou plusieurs pièces">
            <JustifMultiCapture name="file" required />
          </Field>
          <Field label="Titre" htmlFor="titre" required hint="ce qui aidera le trésorier à le retrouver">
            <Input
              id="titre"
              name="titre"
              required
              placeholder="Ex. Tickets métro week-end éclais"
            />
          </Field>
          <Field label="Description" htmlFor="description" hint="optionnel">
            <Textarea
              id="description"
              name="description"
              rows={2}
              placeholder="Détails utiles pour le trésorier"
            />
          </Field>
        </Section>

        <Section
          title="Informations comptables"
          subtitle="Tout est optionnel — aide à pré-rapprocher l'écriture, sinon le trésorier complétera."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Montant TTC" htmlFor="amount" hint="optionnel">
              <Input
                id="amount"
                name="amount"
                placeholder="42,50"
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field label="Date de la dépense" htmlFor="date_estimee" hint="optionnel">
              <Input
                id="date_estimee"
                name="date_estimee"
                type="date"
                defaultValue={today}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Catégorie" htmlFor="category_id">
              <CategoryPicker
                id="category_id"
                name="category_id"
                categories={categories.map((c) => ({
                  id: c.id,
                  name: c.name,
                  unmapped: isUnmapped(c),
                  type: c.type,
                }))}
                topIds={topCategoryIds}
              />
            </Field>
            <Field label="Unité" htmlFor="unite_id">
              <NativeSelect id="unite_id" name="unite_id" defaultValue={defaultUnite}>
                <option value="">— Aucune —</option>
                {unites.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Activité / camp" htmlFor="activite_id" hint="optionnel — ex. le camp">
            <NativeSelect id="activite_id" name="activite_id" defaultValue={params.activite ?? ''}>
              <option value="">— Aucune —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Carte utilisée" htmlFor="carte_id" hint="si paiement par CB ou procurement">
            <NativeSelect id="carte_id" name="carte_id">
              <option value="">— Aucune / Espèces / Virement —</option>
              {cartes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === 'cb' ? 'CB' : 'Procurement'} · {c.porteur}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </Section>

        <div className="flex justify-end pt-2">
          <PendingButton size="lg" pendingLabel="Dépôt en cours…">
            Déposer le justificatif
          </PendingButton>
        </div>
      </form>
    </div>
  );
}
