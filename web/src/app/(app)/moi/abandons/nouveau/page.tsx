import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { getCurrentContext } from '@/lib/context';
import { listUnites } from '@/lib/queries/reference';
import { createMyAbandon } from '@/lib/actions/abandons';

interface SearchParams {
  error?: string;
}

export default async function MyNouveauAbandonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') redirect('/moi');

  const params = await searchParams;
  const unites = await listUnites();
  const today = new Date().toISOString().split('T')[0];
  const defaultUnite = ctx.scopeUniteId ?? '';

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Mon espace', href: '/moi' }}
        title="Abandon de frais"
        subtitle="Tu as avancé des frais pour le groupe et tu en fais don plutôt que d'être remboursé. Tu recevras un reçu fiscal CERFA qui te permet de déduire 66 % du montant de tes impôts."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}

      <form action={createMyAbandon} encType="multipart/form-data" className="space-y-6">
        <Section title="La dépense" subtitle="Quoi, combien, quand.">
          <Field label="Nature de la dépense" htmlFor="nature" required>
            <Input
              id="nature"
              name="nature"
              required
              placeholder="Ex. tickets de métro, achat goûter, matériel"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Montant TTC" htmlFor="montant" required hint="format 42,50">
              <Input
                id="montant"
                name="montant"
                required
                placeholder="42,50"
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field label="Date de la dépense" htmlFor="date_depense" required>
              <Input
                id="date_depense"
                name="date_depense"
                type="date"
                required
                defaultValue={today}
              />
            </Field>
          </div>
          {!ctx.scopeUniteId && unites.length > 0 && (
            <Field label="Unité concernée" htmlFor="unite_id" hint="optionnel">
              <NativeSelect id="unite_id" name="unite_id" defaultValue={defaultUnite}>
                <option value="">— Aucune / groupe —</option>
                {unites.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </Section>

        <Section title="Justificatif" subtitle="Photo ou PDF de la pièce.">
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
        </Section>

        <Section title="Notes" subtitle="Pour mémoire — optionnel.">
          <Textarea id="notes" name="notes" rows={2} placeholder="Précisions libres" />
        </Section>

        <div className="flex justify-end pt-2">
          <Button type="submit" size="lg">
            Déclarer l&apos;abandon
          </Button>
        </div>
      </form>
    </div>
  );
}

