import Link from 'next/link';
import { ArrowRight, CreditCard, Paperclip, Plus } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { attachDepotFromEcriture, shareDepotFromEcriture } from '@/lib/actions/depots';
import { type EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import { type DepotEnriched, type DepotForSharing } from '@/lib/services/depots';
import { formatAmount } from '@/lib/format';

// Bloc justificatifs COMPACT d'une écriture : liste des fichiers rattachés
// (directs + via remboursements / RIB) toujours visible ; les actions
// d'ajout / rattachement (upload, dépôt en attente, réutiliser un dépôt) sont
// repliées dans un <details> — dépliées seulement quand il manque un justif
// ou quand on ouvre le panneau via « sans justif » (defaultOpenActions).

export function JustificatifsCard({
  entityId,
  bundle,
  justifAttendu,
  numeroPiece,
  type,
  pendingDepots,
  shareableDepots = [],
  ecritureAmountCents,
  ecritureDate,
  defaultOpenActions = false,
}: {
  entityId: string;
  bundle: EcritureJustifsBundle;
  justifAttendu: boolean;
  numeroPiece: string | null;
  type: 'depense' | 'recette';
  pendingDepots: DepotEnriched[];
  shareableDepots?: DepotForSharing[];
  ecritureAmountCents: number;
  ecritureDate: string;
  defaultOpenActions?: boolean;
}) {
  // Classement suggestions / autres : ±10 % sur montant et ±15 j sur date.
  const tolMontant = Math.max(100, Math.round(Math.abs(ecritureAmountCents) * 0.1));
  const ecritureDay = new Date(ecritureDate + 'T00:00:00Z').getTime();
  const matches = (d: DepotEnriched) => {
    if (d.amount_cents !== null && Math.abs(d.amount_cents - Math.abs(ecritureAmountCents)) > tolMontant) return false;
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
    return `${d.date_estimee ?? '?'} · ${montant} · ${titre}`;
  };

  const totalCount = bundle.direct.length + bundle.viaRemboursement.reduce((s, r) => s + r.justifs.length + r.rib.length, 0);
  const openActions = totalCount === 0 || defaultOpenActions;

  return (
    <section>
      <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wide font-medium text-fg-subtle mb-1.5">
        <Paperclip size={11} strokeWidth={2} />
        Justificatifs · {totalCount}
        {!justifAttendu && <span className="normal-case tracking-normal text-fg-subtle/80">· non requis</span>}
      </div>

      {/* Fichiers rattachés directement */}
      {bundle.direct.length > 0 && (
        <ul className="space-y-1">
          {bundle.direct.map((j) => (
            <li key={j.id}>
              <JustifLink filePath={j.file_path} filename={j.original_filename} />
            </li>
          ))}
        </ul>
      )}

      {/* Justifs via remboursement lié */}
      {bundle.viaRemboursement.map((rb) => (
        <div key={rb.remboursementId} className="mt-1.5 rounded-md bg-brand-50/40 border border-brand-100 p-2 space-y-1">
          <Link
            href={`/remboursements/${rb.remboursementId}`}
            className="flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline underline-offset-2"
          >
            <span className="text-[10px] uppercase tracking-wide text-brand/80">Demande liée</span>
            <span className="font-mono">{rb.remboursementId}</span>
            {rb.demandeur && <span className="text-fg-muted font-normal">· {rb.demandeur}</span>}
            <ArrowRight size={11} strokeWidth={2.5} className="ml-auto" />
          </Link>
          {rb.justifs.map((j) => (
            <JustifLink key={j.id} filePath={j.file_path} filename={j.original_filename} />
          ))}
          {rb.rib.map((j) => (
            <a
              key={j.id}
              href={`/api/justificatifs/${j.file_path}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 px-2 py-1 rounded-md text-[12.5px] text-fg hover:bg-bg-elevated hover:text-brand transition-colors"
            >
              <CreditCard size={12} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
              <span className="truncate">RIB · {j.original_filename}</span>
            </a>
          ))}
        </div>
      ))}

      {/* Nudge une ligne quand il manque un justif attendu */}
      {totalCount === 0 && justifAttendu && type === 'depense' && (
        <p className="text-[12px] text-amber-700 dark:text-amber-300">
          Justificatif manquant{numeroPiece ? <> · code CW <code className="font-mono">{numeroPiece}</code></> : null}.
        </p>
      )}

      {/* Actions d'ajout / rattachement — repliées par défaut si un justif est déjà là */}
      <details open={openActions} className="group mt-1.5">
        <summary className="flex items-center gap-1 cursor-pointer list-none text-[12px] font-medium text-fg-muted hover:text-fg py-0.5">
          <Plus size={13} strokeWidth={2} className="transition-transform group-open:rotate-45" />
          Ajouter ou rattacher un justif
        </summary>
        <div className="mt-2 space-y-2.5">
          <form action={uploadJustificatif} className="flex items-center gap-2">
            <input type="hidden" name="entity_type" value="ecriture" />
            <input type="hidden" name="entity_id" value={entityId} />
            <input
              type="file"
              name="file"
              className="min-w-0 flex-1 text-[12.5px] file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[12px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
            />
            <PendingButton variant="outline" size="sm">Ajouter</PendingButton>
          </form>

          {pendingDepots.length > 0 && (
            <form action={attachDepotFromEcriture} className="flex items-center gap-2">
              <input type="hidden" name="ecriture_id" value={entityId} />
              <NativeSelect name="depot_id" required defaultValue="" className="min-w-0 flex-1" aria-label="Rattacher un dépôt en attente">
                <option value="" disabled>— Dépôt en attente —</option>
                <optgroup label={suggestions.length > 0 ? `Suggestions (${suggestions.length})` : 'Suggestions (aucune)'}>
                  {suggestions.length === 0 && <option disabled>(rien dans la tolérance)</option>}
                  {suggestions.map((d) => (
                    <option key={d.id} value={d.id}>{depotLabel(d)}</option>
                  ))}
                </optgroup>
                {otherDepots.length > 0 && (
                  <optgroup label={`Autres dépôts (${otherDepots.length})`}>
                    {otherDepots.map((d) => (
                      <option key={d.id} value={d.id}>{depotLabel(d)}</option>
                    ))}
                  </optgroup>
                )}
              </NativeSelect>
              <PendingButton variant="outline" size="sm">Rattacher</PendingButton>
            </form>
          )}

          {shareableDepots.length > 0 && (
            <form action={shareDepotFromEcriture} className="flex items-center gap-2">
              <input type="hidden" name="ecriture_id" value={entityId} />
              <NativeSelect name="depot_id" required defaultValue="" className="min-w-0 flex-1" aria-label="Réutiliser un justif déjà déposé (paiement scindé)">
                <option value="" disabled>— Réutiliser un justif (paiement scindé) —</option>
                {shareableDepots.map((d) => (
                  <option key={d.id} value={d.id}>{shareableDepotLabel(d)}</option>
                ))}
              </NativeSelect>
              <PendingButton variant="outline" size="sm">Réutiliser</PendingButton>
            </form>
          )}
        </div>
      </details>
    </section>
  );
}

function JustifLink({ filePath, filename }: { filePath: string; filename: string }) {
  return (
    <a
      href={`/api/justificatifs/${filePath}`}
      target="_blank"
      rel="noopener"
      className="flex items-center gap-2 px-2 py-1 rounded-md text-[12.5px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
    >
      <Paperclip size={12} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
      <span className="truncate">{filename}</span>
    </a>
  );
}

function shareableDepotLabel(d: DepotForSharing): string {
  const titre = d.titre.length > 32 ? d.titre.slice(0, 32) + '…' : d.titre;
  const montant = d.amount_cents !== null ? formatAmount(d.amount_cents) : '—';
  const origine = d.ecriture_description
    ? ` → ${d.ecriture_description.length > 22 ? d.ecriture_description.slice(0, 22) + '…' : d.ecriture_description}`
    : '';
  return `${d.date_estimee ?? '?'} · ${montant} · ${titre}${origine}`;
}
