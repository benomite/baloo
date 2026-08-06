'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, RotateCcw, Link2, X, Unlink, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/shared/amount';
import {
  restaurerEnDraft,
  supprimerDefinitivement,
  supprimerTousArbitres,
  confirmerLien,
  rejeterLien,
} from '@/lib/actions/ecritures-arbitrage';
import { unlinkDepotFromEcriture } from '@/lib/actions/depots';
import type { SupprimeeCwRow, LinkSuggestionView } from '@/lib/queries/sync-arbitrage';

interface Props {
  supprimees: SupprimeeCwRow[];
  agregesRemplaces?: SupprimeeCwRow[];
  suggestions: LinkSuggestionView[];
}

export function ArbitrageBanner({ supprimees, agregesRemplaces = [], suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (supprimees.length === 0 && agregesRemplaces.length === 0 && suggestions.length === 0) return null;

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

  // Pièces qui bloquent la suppression, nommées — sinon le refus « une pièce est
  // attachée » ne dit ni laquelle, ni où aller la détacher. Un dépôt de justif
  // porte son propre bouton ; les autres pièces se traitent depuis leur écran.
  function Blockers({ row }: { row: SupprimeeCwRow }) {
    if (row.blockers.length === 0) return null;
    return (
      <ul className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5 text-[11.5px] text-muted-foreground">
        {row.blockers.map((b) => (
          <li key={`${b.kind}-${b.id}`} className="flex flex-wrap items-center gap-1.5">
            <Paperclip size={11} className="shrink-0" />
            <span>
              Suppression bloquée par {b.label} <span className="tabular-nums opacity-70">({b.id})</span>
            </span>
            {b.detachable ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11.5px]"
                disabled={pending}
                onClick={() =>
                  run(
                    () => unlinkDepotFromEcriture(b.id),
                    'Dépôt détaché : il est retourné dans « à traiter ».',
                  )
                }
              >
                <Unlink size={11} className="mr-1" /> Détacher
              </Button>
            ) : (
              <span className="opacity-70">— à retirer depuis sa propre fiche</span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  function runBatch(status: 'agrege_remplace' | 'supprimee_cw') {
    startTransition(async () => {
      const res = await supprimerTousArbitres(status);
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="mb-5 space-y-4">
      {supprimees.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900/40 dark:bg-red-950/20">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
              {supprimees.length} écriture{supprimees.length > 1 ? 's' : ''} supprimée{supprimees.length > 1 ? 's' : ''} dans Comptaweb — à arbitrer
            </h3>
            {supprimees.length > 1 && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => runBatch('supprimee_cw')}>
                <Trash2 size={13} className="mr-1" /> Tout supprimer ({supprimees.length})
              </Button>
            )}
          </div>
          <ul className="space-y-1.5">
            {supprimees.map((e) => (
              <li key={e.id} className="rounded-md bg-background/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                </div>
                <Blockers row={e} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {agregesRemplaces.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {agregesRemplaces.length} ligne{agregesRemplaces.length > 1 ? 's' : ''} « total » remplacée{agregesRemplaces.length > 1 ? 's' : ''} par le détail des ventilations — à supprimer
            </h3>
            {agregesRemplaces.length > 1 && (
              <Button size="sm" disabled={pending} onClick={() => runBatch('agrege_remplace')}>
                <Trash2 size={13} className="mr-1" /> Tout supprimer ({agregesRemplaces.length})
              </Button>
            )}
          </div>
          <p className="mb-2 text-[11.5px] text-amber-800/80 dark:text-amber-300/70">
            Ces lignes existent toujours dans Comptaweb : ce sont d&apos;anciens agrégats (le montant total) qui font doublon avec les lignes par ventilation. Tu peux les supprimer sans risque — le détail est conservé.
          </p>
          <ul className="space-y-1.5">
            {agregesRemplaces.map((e) => (
              <li key={e.id} className="rounded-md bg-background/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                      disabled={pending}
                      onClick={() => run(() => supprimerDefinitivement(e.id), 'Doublon supprimé.')}
                    >
                      <Trash2 size={13} className="mr-1" /> Supprimer le doublon
                    </Button>
                  </span>
                </div>
                <Blockers row={e} />
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
