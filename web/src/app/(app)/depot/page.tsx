import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';
import { requireCanSubmit } from '@/lib/auth/access';
import { listUnites, listCategories, listCartes } from '@/lib/queries/reference';
import { createDepot } from '@/lib/actions/depots';

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function DepotPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireCanSubmit(ctx.role);

  const params = await searchParams;
  const [unites, categories, cartes] = await Promise.all([
    listUnites(),
    listCategories(),
    listCartes(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const defaultUnite = ctx.scopeUniteId ?? '';

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Déposer un justificatif"
        subtitle="Photo ou PDF d'un ticket / facture. Le trésorier rapprochera ensuite le justif avec l'écriture comptable correspondante."
      />

      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      {params.success && (
        <Alert variant="success" className="mb-6">
          Justificatif déposé (réf. <b>{params.success}</b>). Tu peux en déposer un autre ci-dessous.
        </Alert>
      )}

      <form action={createDepot} encType="multipart/form-data" className="space-y-6">
        <Section title="Le justificatif" subtitle="Photo, PDF ou scan.">
          <Field label="Fichier" htmlFor="file" required>
            <Input
              id="file"
              name="file"
              type="file"
              accept="image/*,application/pdf"
              required
              className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
            />
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
              <NativeSelect id="category_id" name="category_id">
                <option value="">— Aucune —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
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
          <Button type="submit" size="lg">
            Déposer le justificatif
          </Button>
        </div>
      </form>
    </div>
  );
}
