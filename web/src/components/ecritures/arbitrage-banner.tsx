'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, RotateCcw, Link2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/shared/amount';
import {
  restaurerEnDraft,
  supprimerDefinitivement,
  confirmerLien,
  rejeterLien,
} from '@/lib/actions/ecritures-arbitrage';
import type { SupprimeeCwRow, LinkSuggestionView } from '@/lib/queries/sync-arbitrage';

interface Props {
  supprimees: SupprimeeCwRow[];
  suggestions: LinkSuggestionView[];
}

export function ArbitrageBanner({ supprimees, suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (supprimees.length === 0 && suggestions.length === 0) return null;

  function run(action: () => Promise<{ ok: boolean; message?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(res.message ?? 'Action impossible.');
      }
    });
  }

  return (
    <div className="mb-5 space-y-4">
      {supprimees.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900/40 dark:bg-red-950/20">
          <h3 className="mb-2 text-sm font-semibold text-red-900 dark:text-red-200">
            {supprimees.length} écriture{supprimees.length > 1 ? 's' : ''} supprimée{supprimees.length > 1 ? 's' : ''} dans Comptaweb — à arbitrer
          </h3>
          <ul className="space-y-1.5">
            {supprimees.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground tabular-nums">{e.date_ecriture}</span>{' '}
                  {e.description}{' '}
                  <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} className="text-xs" />
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => restaurerEnDraft(e.id), 'Restaurée en brouillon.')}
                  >
                    <RotateCcw size={13} className="mr-1" /> Restaurer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => supprimerDefinitivement(e.id), 'Supprimée définitivement.')}
                  >
                    <Trash2 size={13} className="mr-1" /> Supprimer
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <h3 className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            {suggestions.length} lien{suggestions.length > 1 ? 's' : ''} à confirmer (brouillon ↔ écriture Comptaweb)
          </h3>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">Brouillon :</span> {s.ecriture_description}{' '}
                  <Amount cents={s.ecriture_amount_cents} className="text-xs" />
                  <span className="text-muted-foreground"> ↔ CW :</span>{' '}
                  {s.cw_intitule ?? s.cw_numero_piece ?? `#${s.cw_ecriture_id}`}
                  {s.cw_montant_cents != null && (
                    <> <Amount cents={s.cw_montant_cents} className="text-xs" /></>
                  )}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => confirmerLien(s.id), 'Lien confirmé, écriture synchronisée.')}
                  >
                    <Link2 size={13} className="mr-1" /> Confirmer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => rejeterLien(s.id), 'Lien rejeté.')}
                  >
                    <X size={13} className="mr-1" /> Rejeter
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
