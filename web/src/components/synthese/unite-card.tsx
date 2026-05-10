import Link from 'next/link';
import { FileQuestion, Upload } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { cn } from '@/lib/utils';

// Carte par unité affichée sur /synthese. Liseré à la couleur charte
// SGDF, totaux dépenses/recettes/solde, badges d'alertes optionnels,
// cliquable vers /synthese/unite/[id] en préservant l'exercice filtré.

export interface UniteCardData {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;
  budget_prevu_depenses: number;
}

interface Props {
  unite: UniteCardData;
  exerciceParam: string;
  alertes?: { sansJustif?: number; nonSync?: number };
}

export function UniteCard({ unite, exerciceParam, alertes }: Props) {
  const couleur = unite.couleur ?? '#C9C9C9';
  const href = `/synthese/unite/${unite.id}?exercice=${exerciceParam}`;
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-lg border bg-card p-4 transition-shadow',
        'hover:shadow-md hover:border-foreground/20',
      )}
      style={{
        boxShadow: `inset 3px 0 0 0 ${couleur}`,
        backgroundColor: `${couleur}0A`,
      }}
    >
      <div className="text-sm font-semibold mb-3">
        {unite.code} <span className="text-muted-foreground font-normal">— {unite.name}</span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Dépenses</dt>
          <dd className="tabular-nums"><Amount cents={unite.depenses} tone="negative" /></dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Recettes</dt>
          <dd className="tabular-nums"><Amount cents={unite.recettes} tone="positive" /></dd>
        </div>
        <div className="flex justify-between border-t pt-1.5 font-medium">
          <dt>Solde</dt>
          <dd className="tabular-nums"><Amount cents={unite.solde} tone="signed" /></dd>
        </div>
      </dl>
      {unite.budget_prevu_depenses > 0 && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Budget consommé</span>
            <span className="tabular-nums">
              <Amount cents={unite.depenses} /> / <Amount cents={unite.budget_prevu_depenses} />
            </span>
          </div>
          <div className="h-1.5 rounded bg-muted overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(100, Math.round((unite.depenses / unite.budget_prevu_depenses) * 100))}%`,
                backgroundColor: unite.depenses > unite.budget_prevu_depenses ? '#dc2626' : couleur,
              }}
            />
          </div>
        </div>
      )}
      {alertes && (alertes.sansJustif || alertes.nonSync) ? (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
          {alertes.sansJustif ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 text-amber-800 text-[11px] px-1.5 py-0.5">
              <FileQuestion size={11} strokeWidth={1.75} />
              {alertes.sansJustif} sans justif
            </span>
          ) : null}
          {alertes.nonSync ? (
            <span className="inline-flex items-center gap-1 rounded bg-blue-50 text-blue-800 text-[11px] px-1.5 py-0.5">
              <Upload size={11} strokeWidth={1.75} />
              {alertes.nonSync} non sync
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
