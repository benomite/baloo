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
import { getComptawebCredentialsStatus } from '@/lib/services/comptaweb-credentials';
import { saveAndTestComptawebCredentials } from '@/lib/actions/comptaweb-credentials';

export const dynamic = 'force-dynamic';

export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; cw_saved?: string; cw_error?: string }>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const [groupe, cwStatus] = await Promise.all([
    getGroupe({ groupId: ctx.groupId }),
    getComptawebCredentialsStatus(),
  ]);
  const tauxEuros = ((groupe?.taux_km_millicents ?? 354) / 1000).toFixed(3).replace('.', ',');

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Paramètres du groupe" subtitle="Réglages de la compta du groupe." />
      {params.saved && <Alert variant="success" className="mb-6">Taux kilométrique enregistré.</Alert>}
      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      {params.cw_saved === 'ok' && <Alert variant="success" className="mb-6">Identifiants Comptaweb enregistrés — connexion réussie.</Alert>}
      {params.cw_saved === 'failed' && <Alert variant="error" className="mb-6">Identifiants enregistrés, mais la connexion a échoué. Vérifie l&apos;identifiant et le mot de passe.</Alert>}
      {params.cw_error && <Alert variant="error" className="mb-6">{params.cw_error}</Alert>}
      <Section title="Frais kilométriques" subtitle="Taux de remboursement au kilomètre (barème SGDF).">
        <form action={updateTauxKm} className="flex items-end gap-3">
          <Field label="Taux (€ / km)" htmlFor="taux_km" required>
            <Input id="taux_km" name="taux_km" required inputMode="decimal" placeholder="0,354"
              defaultValue={tauxEuros} className="tabular-nums w-32" />
          </Field>
          <PendingButton pendingLabel="Enregistrement…">Enregistrer</PendingButton>
        </form>
      </Section>
      <Section
        title="Connexion Comptaweb"
        subtitle={
          cwStatus.configured
            ? `Configuré — identifiant ${cwStatus.username}${cwStatus.updated_at ? ` (modifié le ${cwStatus.updated_at.slice(0, 10)})` : ''}.`
            : 'Non configuré — utilise les variables d\'environnement.'
        }
        className="mt-6"
      >
        <form action={saveAndTestComptawebCredentials} className="space-y-3 max-w-md">
          <Field label="Identifiant Comptaweb" htmlFor="cw_username" required>
            <Input id="cw_username" name="username" required defaultValue={cwStatus.username ?? ''} placeholder="prenom.nom@exemple.fr" />
          </Field>
          <Field label="Mot de passe" htmlFor="cw_password" hint="laisser vide pour ne pas changer">
            <Input id="cw_password" name="password" type="password" placeholder="••••••••" autoComplete="off" />
          </Field>
          <PendingButton pendingLabel="Enregistrement et test…">Enregistrer et tester</PendingButton>
        </form>
      </Section>
    </div>
  );
}
