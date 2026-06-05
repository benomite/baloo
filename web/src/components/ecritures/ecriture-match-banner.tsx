import { Link2 } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { attachDepotFromEcriture, lierRemboursementDepuisEcriture } from '@/lib/actions/depots';
import type { EcritureMatch } from '@/lib/services/ecriture-match';

// Bannière « un dépôt / remboursement semble correspondre · Lier » affichée
// sous une écriture sans justif. Un seul bouton (form server action). Admin
// only (la page ne fournit les pools qu'aux admins).
export function EcritureMatchBanner({
  match,
  ecritureId,
}: {
  match: EcritureMatch;
  ecritureId: string;
}) {
  if (match.kind === 'depot') {
    return (
      <Banner
        text={
          <>
            Un dépôt <b className="font-medium">« {match.label} »</b> semble correspondre
          </>
        }
      >
        <form action={attachDepotFromEcriture}>
          <input type="hidden" name="depot_id" value={match.id} />
          <input type="hidden" name="ecriture_id" value={ecritureId} />
          <PendingButton size="xs">Lier</PendingButton>
        </form>
      </Banner>
    );
  }
  return (
    <Banner
      text={
        <>
          Un remboursement de <b className="font-medium">{match.label}</b> semble correspondre
        </>
      }
    >
      <form action={lierRemboursementDepuisEcriture}>
        <input type="hidden" name="remboursement_id" value={match.id} />
        <input type="hidden" name="ecriture_id" value={ecritureId} />
        <PendingButton size="xs">Lier</PendingButton>
      </form>
    </Banner>
  );
}

function Banner({ text, children }: { text: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/25 px-2.5 py-1.5 text-[12px] text-amber-900 dark:text-amber-200">
      <Link2 size={13} strokeWidth={2} className="shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  );
}
