import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared/field';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { getGroupe } from '@/lib/services/groupes';
import { updateTauxKm } from '@/lib/actions/parametres';

export const dynamic = 'force-dynamic';

export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const groupe = await getGroupe({ groupId: ctx.groupId });
  const tauxEuros = ((groupe?.taux_km_millicents ?? 354) / 1000).toFixed(3).replace('.', ',');

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Paramètres du groupe" subtitle="Réglages de la compta du groupe." />
      {params.saved && <Alert variant="success" className="mb-6">Taux kilométrique enregistré.</Alert>}
      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      <Section title="Frais kilométriques" subtitle="Taux de remboursement au kilomètre (barème SGDF).">
        <form action={updateTauxKm} className="flex items-end gap-3">
          <Field label="Taux (€ / km)" htmlFor="taux_km" required>
            <Input id="taux_km" name="taux_km" required inputMode="decimal" placeholder="0,354"
              defaultValue={tauxEuros} className="tabular-nums w-32" />
          </Field>
          <PendingButton pendingLabel="Enregistrement…">Enregistrer</PendingButton>
        </form>
      </Section>
    </div>
  );
}
