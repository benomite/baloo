import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { FileMultiUploader } from '@/components/ui/file-multi-uploader';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listSelectableUnites } from '@/lib/queries/reference';
import { createAbandonForOther } from '@/lib/actions/abandons';

interface SearchParams {
  error?: string;
}

export default async function NouvelAbandonAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
  const unites = await listSelectableUnites();
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Dons au groupe', href: '/abandons' }}
        title="Enregistrer un don au groupe"
        subtitle="Saisie pour autrui — rattrapage d'historique ou aide à un donateur qui ne peut pas saisir lui-même. Les fichiers sont optionnels (à attacher après depuis la page détail si besoin)."
      />

      {params.error && (
        <Alert variant="error" className="mb-6">
          {params.error}
        </Alert>
      )}

      <form
        action={createAbandonForOther}
        encType="multipart/form-data"
        className="space-y-6"
      >
        <Section title="Donateur" subtitle="Personne qui a renoncé au remboursement.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prénom" htmlFor="prenom" required>
              <Input id="prenom" name="prenom" required />
            </Field>
            <Field label="Nom" htmlFor="nom" required>
              <Input id="nom" name="nom" required />
            </Field>
          </div>
          <Field label="Email" htmlFor="email" hint="optionnel — utile pour notifier le CERFA">
            <Input id="email" name="email" type="email" placeholder="prenom.nom@..." />
          </Field>
        </Section>

        <Section title="La dépense" subtitle="Quoi, combien, quand.">
          <Field label="Nature de la dépense" htmlFor="nature" required>
            <Input
              id="nature"
              name="nature"
              required
              placeholder="Ex. Frais km camp bleu — août 2025"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <Field
              label="Date de la dépense"
              htmlFor="date_depense"
              required
              hint="détermine l'année fiscale"
            >
              <Input
                id="date_depense"
                name="date_depense"
                type="date"
                required
                defaultValue={today}
              />
            </Field>
          </div>
          {unites.length > 0 && (
            <Field label="Unité concernée" htmlFor="unite_id" hint="optionnel">
              <NativeSelect id="unite_id" name="unite_id" defaultValue="">
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

        <Section
          title="Feuille d'abandon"
          subtitle="Le formulaire SGDF signé — optionnel à la saisie, attachable depuis la page détail."
        >
          <Field label="Fichier" htmlFor="feuille">
            <Input
              id="feuille"
              name="feuille"
              type="file"
              accept="application/pdf,image/*,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
            />
          </Field>
        </Section>

        <Section title="Justificatifs" subtitle="Tickets, factures, copie carte grise, etc. — optionnels.">
          <FileMultiUploader
            name="justifs"
            accept="image/*,application/pdf"
            helpText="Tu peux glisser-déposer plusieurs fichiers."
          />
        </Section>

        <Section title="Notes" subtitle="Pour mémoire — optionnel.">
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Ex. importé d'Airtable, signé RG le 26/01/2026..."
          />
        </Section>

        <div className="flex justify-end pt-2">
          <PendingButton size="lg" pendingLabel="Création…">
            Enregistrer le don
          </PendingButton>
        </div>
      </form>
    </div>
  );
}
