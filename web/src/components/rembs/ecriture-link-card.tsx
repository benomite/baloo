import Link from 'next/link';
import { ArrowRight, Receipt, Unlink } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { formatAmount } from '@/lib/format';
import { type ComboboxItem } from '@/components/ui/combobox';
import {
  findEcritureCandidatesForRembs,
  getEcritureRembsCoverage,
} from '@/lib/services/remboursement-ecriture-link';
import {
  linkRemboursementToEcriture,
  unlinkRemboursementFromEcriture,
} from '@/lib/actions/remboursements';
import { EcritureLinkPicker } from './ecriture-link-picker';

// Server component : affiché dans la sidebar de la page détail rembs.
// Réservé aux admins (tresorier / RG).
//
// État :
//   - rembs.ecriture_id défini → affiche l'écriture liée + bouton "Délier".
//   - rembs.ecriture_id null   → présente le sélecteur des écritures
//     candidates (type dépense, fenêtre date ±365j, montant libre) +
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
    return <LinkedView rembsId={rembsId} ecritureId={ecritureId} amountCents={amountCents} groupId={groupId} />;
  }

  const candidates = await findEcritureCandidatesForRembs(groupId, rembsId);
  const items: ComboboxItem[] = candidates.map((c) => {
    const montant = (c.amount_cents / 100).toFixed(2).replace('.', ',');
    const desc = c.description.length > 40 ? c.description.slice(0, 40) + '…' : c.description;
    const dejaLie = c.linked_count > 0 ? ` · déjà ${c.linked_count} liée${c.linked_count > 1 ? 's' : ''}` : '';
    return {
      value: c.id,
      label: `${c.date_ecriture} · ${montant} €${c.unite_code ? ` · ${c.unite_code}` : ''} · ${desc}${dejaLie}`,
    };
  });

  return (
    <Section
      title="Écriture comptable"
      subtitle="Lie cette demande au virement comptable correspondant."
    >
      {candidates.length === 0 ? (
        <Alert variant="info" icon={Receipt}>
          Aucune écriture dépense trouvée dans une fenêtre de ±1 an. Le virement n&apos;a
          peut-être pas encore été importé depuis Comptaweb.
        </Alert>
      ) : (
        <EcritureLinkPicker
          rembsId={rembsId}
          items={items}
          action={linkRemboursementToEcriture.bind(null, rembsId)}
        />
      )}
    </Section>
  );
}

async function LinkedView({
  rembsId,
  ecritureId,
  amountCents,
  groupId,
}: {
  rembsId: string;
  ecritureId: string;
  amountCents: number;
  groupId: string;
}) {
  const cov = await getEcritureRembsCoverage(groupId, ecritureId);
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
        <ArrowRight size={14} strokeWidth={2} className="text-fg-subtle group-hover:text-brand transition-colors" />
      </Link>

      {cov.nbDemandes > 1 && (
        <p className="mt-2 text-[12px] text-fg-muted">
          Ce virement de {formatAmount(cov.montantVirementCents)} couvre {cov.nbDemandes} demandes ·{' '}
          {formatAmount(cov.sommeDemandesCents)}
          {!cov.depasse && cov.resteCents !== 0 && <> · reste {formatAmount(cov.resteCents)}</>}
        </p>
      )}
      {cov.depasse && (
        <Alert variant="warning" className="mt-2">
          La somme des demandes liées ({formatAmount(cov.sommeDemandesCents)}) dépasse le virement
          ({formatAmount(cov.montantVirementCents)}).
        </Alert>
      )}

      <form action={unlinkRemboursementFromEcriture.bind(null, rembsId)} className="pt-1">
        <PendingButton variant="ghost" size="sm" className="text-fg-muted hover:text-destructive">
          <Unlink size={13} strokeWidth={2} className="mr-1.5" />
          Délier
        </PendingButton>
      </form>
    </Section>
  );
}
