import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { libelleExercicesCouverts } from '@/lib/services/exercices-affichage';

// Bandeau de période de clôture (ADR-039). Purement présentationnel : il ne
// s'affiche QUE si le dernier cycle de sync a couvert au moins deux exercices,
// c'est-à-dire pendant la fenêtre où l'ancien exercice et le nouveau vivent en
// parallèle. Hors de cette fenêtre il ne rend rien — un bandeau permanent
// deviendrait invisible à force d'être là.
//
// Les données viennent du dernier `sync_runs` et du réglage du groupe : aucun
// appel à Comptaweb au rendu de la page.
export function ExercicesBanner({
  exercices,
  dernierExerciceClos,
  canDeclarer,
}: {
  /** Codes couverts par le dernier cycle, joints par des virgules. */
  exercices: string | null;
  dernierExerciceClos: string | null;
  /** Le lien de déclaration n'est proposé qu'aux trésoriers / RG. */
  canDeclarer: boolean;
}) {
  const codes = exercices ? exercices.split(',').map((c) => c.trim()).filter(Boolean) : [];
  if (libelleExercicesCouverts(codes) === null) return null;

  // Le plus ancien des exercices couverts est celui qu'on déclarera clos.
  const aClore = [...codes].sort()[0];
  const dejaDeclare = dernierExerciceClos !== null && dernierExerciceClos >= aClore;

  return (
    <div className="mb-4 rounded-xl border border-border-soft bg-bg-elevated px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex items-center justify-center size-7 shrink-0 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/30">
        <CalendarClock size={15} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">
          Période de clôture — Baloo suit {codes.join(' et ')}
        </div>
        <div className="text-[11.5px] text-fg-subtle">
          Les dépenses datées d&apos;avant le 1<sup>er</sup> septembre partent encore sur{' '}
          {aClore}.
        </div>
      </div>
      {canDeclarer && !dejaDeclare && (
        <Link
          href="/admin/parametres"
          className="shrink-0 text-[12px] font-medium text-brand hover:underline"
        >
          Déclarer {aClore} clos
        </Link>
      )}
    </div>
  );
}
