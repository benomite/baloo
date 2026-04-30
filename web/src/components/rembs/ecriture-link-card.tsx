import Link from 'next/link';
import { ArrowRight, Receipt, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { findEcritureCandidatesForRembs } from '@/lib/services/remboursement-ecriture-link';
import {
  linkRemboursementToEcriture,
  unlinkRemboursementFromEcriture,
} from '@/lib/actions/remboursements';

// Server component : affiché dans la sidebar de la page détail rembs.
// Réservé aux admins (tresorier / RG).
//
// État :
//   - rembs.ecriture_id défini → affiche l'écriture liée + bouton "Délier".
//   - rembs.ecriture_id null   → présente le sélecteur des écritures
//     candidates (montant exact, dépense, fenêtre date ±120j) +
//     bouton "Lier".
//
// Si aucun candidat : message "aucune écriture ne matche, vérifie
// que le virement est bien importé en BDD".

interface EcritureLinkCardProps {
  rembsId: string;
  groupId: string;
  ecritureId: string | null;
  amountCents: number;
}

export async function EcritureLinkCard({
  rembsId,
  groupId,
  ecritureId,
  amountCents,
}: EcritureLinkCardProps) {
  if (ecritureId) {
    return <LinkedView rembsId={rembsId} ecritureId={ecritureId} amountCents={amountCents} />;
  }

  const candidates = await findEcritureCandidatesForRembs(groupId, rembsId);

  return (
    <Section
      title="Écriture comptable"
      subtitle="Lie cette demande au virement comptable correspondant."
    >
      {candidates.length === 0 ? (
        <Alert variant="info" icon={Receipt}>
          Aucune écriture trouvée avec ce montant exact dans une fenêtre de ±120 jours.
          Le virement n&apos;a peut-être pas encore été importé depuis Comptaweb.
        </Alert>
      ) : (
        <form action={linkRemboursementToEcriture.bind(null, rembsId)} className="space-y-3">
          <Field label="Écriture candidate" htmlFor={`ecriture-${rembsId}`}>
            <NativeSelect id={`ecriture-${rembsId}`} name="ecriture_id" defaultValue="" required>
              <option value="" disabled>
                — Choisir une écriture —
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.date_ecriture} · {(c.amount_cents / 100).toFixed(2).replace('.', ',')}
                  {c.unite_code ? ` · ${c.unite_code}` : ''} ·{' '}
                  {c.description.length > 50 ? c.description.slice(0, 50) + '…' : c.description}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex justify-end">
            <PendingButton size="sm" pendingLabel="Liaison…">
              Lier à cette écriture
            </PendingButton>
          </div>
        </form>
      )}
    </Section>
  );
}

async function LinkedView({
  rembsId,
  ecritureId,
  amountCents,
}: {
  rembsId: string;
  ecritureId: string;
  amountCents: number;
}) {
  return (
    <Section title="Écriture comptable liée">
      <Link
        href={`/ecritures/${ecritureId}`}
        className="flex items-center gap-2.5 rounded-md border border-brand-100 bg-brand-50/40 px-3 py-2.5 hover:bg-brand-50 transition-colors group"
      >
        <Receipt size={16} strokeWidth={1.75} className="text-brand shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium font-mono text-fg">{ecritureId}</div>
          <div className="text-[12px] text-fg-muted">
            <Amount cents={amountCents} tone="negative" />
          </div>
        </div>
        <ArrowRight
          size={14}
          strokeWidth={2}
          className="text-fg-subtle group-hover:text-brand transition-colors"
        />
      </Link>
      <form action={unlinkRemboursementFromEcriture.bind(null, rembsId)} className="pt-1">
        <PendingButton variant="ghost" size="sm" className="text-fg-muted hover:text-destructive">
          <Unlink size={13} strokeWidth={2} className="mr-1.5" />
          Délier
        </PendingButton>
      </form>
    </Section>
  );
}
