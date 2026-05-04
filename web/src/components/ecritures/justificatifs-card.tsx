import Link from 'next/link';
import { ArrowRight, CreditCard, Paperclip } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { Field } from '@/components/shared/field';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { attachDepotFromEcriture } from '@/lib/actions/depots';
import { type EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import { type DepotEnriched } from '@/lib/services/depots';
import { formatAmount } from '@/lib/format';

// Bloc justificatifs d'une écriture : liste des fichiers rattachés
// (directs + via remboursements / RIB), upload d'un nouveau fichier,
// rattachement d'un dépôt en attente. Composant neutre (rendu serveur
// ou client) tant qu'il ne fait que du JSX.

export function JustificatifsCard({
  entityId,
  bundle,
  justifAttendu,
  numeroPiece,
  type,
  pendingDepots,
  ecritureAmountCents,
  ecritureDate,
}: {
  entityId: string;
  bundle: EcritureJustifsBundle;
  justifAttendu: boolean;
  numeroPiece: string | null;
  type: 'depense' | 'recette';
  pendingDepots: DepotEnriched[];
  ecritureAmountCents: number;
  ecritureDate: string;
}) {
  // Classement suggestions / autres : ±10 % sur montant et ±15 j sur date.
  const tolMontant = Math.max(100, Math.round(Math.abs(ecritureAmountCents) * 0.1));
  const ecritureDay = new Date(ecritureDate + 'T00:00:00Z').getTime();
  const matches = (d: DepotEnriched) => {
    if (d.amount_cents !== null && Math.abs(d.amount_cents - Math.abs(ecritureAmountCents)) > tolMontant) {
      return false;
    }
    if (d.date_estimee) {
      const dDay = new Date(d.date_estimee + 'T00:00:00Z').getTime();
      if (Math.abs(dDay - ecritureDay) > 15 * 86_400_000) return false;
    }
    return true;
  };
  const suggestions = pendingDepots.filter(matches);
  const suggestionIds = new Set(suggestions.map((d) => d.id));
  const otherDepots = pendingDepots.filter((d) => !suggestionIds.has(d.id));
  const depotLabel = (d: DepotEnriched) => {
    const titre = d.titre.length > 40 ? d.titre.slice(0, 40) + '…' : d.titre;
    const montant = d.amount_cents !== null ? formatAmount(d.amount_cents) : '—';
    const date = d.date_estimee ?? '?';
    return `${date} · ${montant} · ${titre}`;
  };
  const totalCount =
    bundle.direct.length +
    bundle.viaRemboursement.reduce((sum, r) => sum + r.justifs.length + r.rib.length, 0);

  return (
    <Section
      title={`Justificatifs (${totalCount})`}
      subtitle={!justifAttendu ? 'Non requis pour cette écriture' : undefined}
    >
      {totalCount === 0 && (
        <>
          {!justifAttendu && (
            <Alert variant="info" icon={null}>
              Justificatif non attendu (prélèvement auto / flux territoire).
            </Alert>
          )}
          {justifAttendu && numeroPiece && (
            <Alert variant="warning">
              En attente — code Comptaweb{' '}
              <code className="font-mono text-[12.5px]">{numeroPiece}</code>{' '}
              renseigné, document à rattacher.
            </Alert>
          )}
          {justifAttendu && !numeroPiece && type === 'depense' && (
            <Alert variant="warning">Justificatif manquant.</Alert>
          )}
        </>
      )}

      {bundle.direct.length > 0 && (
        <ul className="space-y-1.5">
          {bundle.direct.map((j) => (
            <li key={j.id}>
              <JustifLink filePath={j.file_path} filename={j.original_filename} />
            </li>
          ))}
        </ul>
      )}

      {bundle.viaRemboursement.map((rb) => (
        <div key={rb.remboursementId} className="rounded-md bg-brand-50/40 border border-brand-100 p-2.5 space-y-1.5">
          <Link
            href={`/remboursements/${rb.remboursementId}`}
            className="flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline underline-offset-2"
          >
            <span className="text-overline text-brand/80">Demande liée</span>
            <span className="font-mono">{rb.remboursementId}</span>
            {rb.demandeur && <span className="text-fg-muted font-normal">· {rb.demandeur}</span>}
            <ArrowRight size={11} strokeWidth={2.5} className="ml-auto" />
          </Link>
          {rb.justifs.length > 0 && (
            <ul className="space-y-1">
              {rb.justifs.map((j) => (
                <li key={j.id}>
                  <JustifLink filePath={j.file_path} filename={j.original_filename} />
                </li>
              ))}
            </ul>
          )}
          {rb.rib.map((j) => (
            <a
              key={j.id}
              href={`/api/justificatifs/${j.file_path}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-bg-elevated hover:text-brand transition-colors"
            >
              <CreditCard size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
              <span className="truncate">RIB · {j.original_filename}</span>
            </a>
          ))}
        </div>
      ))}

      <form action={uploadJustificatif} className="pt-2 border-t border-border-soft">
        <input type="hidden" name="entity_type" value="ecriture" />
        <input type="hidden" name="entity_id" value={entityId} />
        <Field label="Ajouter un fichier">
          <input
            type="file"
            name="file"
            className="block w-full text-[13px] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
          />
        </Field>
        <div className="flex justify-end mt-3">
          <PendingButton variant="outline" size="sm">
            Ajouter
          </PendingButton>
        </div>
      </form>

      {pendingDepots.length > 0 && (
        <form action={attachDepotFromEcriture} className="pt-2 border-t border-border-soft">
          <input type="hidden" name="ecriture_id" value={entityId} />
          <Field label="Rattacher un dépôt en attente" htmlFor={`depot-${entityId}`}>
            <NativeSelect
              id={`depot-${entityId}`}
              name="depot_id"
              required
              defaultValue=""
            >
              <option value="" disabled>
                — Choisir un dépôt —
              </option>
              <optgroup
                label={
                  suggestions.length > 0
                    ? `Suggestions (${suggestions.length})`
                    : 'Suggestions (aucune)'
                }
              >
                {suggestions.length === 0 && (
                  <option disabled>(rien ne matche dans la tolérance)</option>
                )}
                {suggestions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {depotLabel(d)}
                  </option>
                ))}
              </optgroup>
              {otherDepots.length > 0 && (
                <optgroup label={`Autres dépôts à traiter (${otherDepots.length})`}>
                  {otherDepots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {depotLabel(d)}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </Field>
          <div className="flex justify-end mt-3">
            <PendingButton variant="outline" size="sm">
              Rattacher
            </PendingButton>
          </div>
        </form>
      )}
    </Section>
  );
}

function JustifLink({ filePath, filename }: { filePath: string; filename: string }) {
  return (
    <a
      href={`/api/justificatifs/${filePath}`}
      target="_blank"
      rel="noopener"
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
    >
      <Paperclip size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
      <span className="truncate">{filename}</span>
    </a>
  );
}
