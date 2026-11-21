'use client';

// Transfert interne (#51) : sur un brouillon issu d'une ligne bancaire, le
// trésorier choisit la nature de l'opération (dépense, recette, ou transfert
// interne avec son mode) et, pour un dépôt / retrait d'espèces, lie le
// brouillon à l'opération de la caisse — ou la crée depuis le brouillon.

import { useEffect, useState, useTransition } from 'react';
import { Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';
import { Amount } from '@/components/shared/amount';
import {
  qualifierEcriture,
  fetchCaissePourTransfert,
  lierOperationCaisse,
  creerOperationCaisseDepuisEcriture,
  type CaissePourTransfert,
} from '@/lib/actions/transfert-interne';
import {
  NATURES_ECRITURE,
  natureDeEcriture,
  operationCaisseDuMode,
  vueDepot,
  vueRetrait,
  vueOperationLiee,
  type OperationCaisseVue,
} from '@/lib/transfert-interne';
import type { Ecriture } from '@/lib/types';

const LIBELLE_OPERATION = { depot: 'dépôt', retrait: 'retrait' } as const;

export function TransfertInterneCard({
  ecriture,
  onChanged,
}: {
  ecriture: Pick<Ecriture, 'id' | 'type' | 'mode_transfert'>;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [caisse, setCaisse] = useState<CaissePourTransfert | null>(null);
  // Jeton de rechargement : un nouvel objet relance la lecture de la caisse.
  const [reload, setReload] = useState({});
  const sens = operationCaisseDuMode(ecriture.mode_transfert);

  useEffect(() => {
    let annule = false;
    if (sens) {
      fetchCaissePourTransfert(ecriture.id).then((d) => {
        if (annule) return;
        setCaisse(d);
      });
    }
    return () => {
      annule = true;
    };
  }, [ecriture.id, sens, reload]);

  const executer = (action: () => Promise<{ ok: true } | { ok: false; message: string }>) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        setReload({});
        onChanged();
      } else {
        toast.error(r.message);
      }
    });

  const candidats: OperationCaisseVue[] = caisse
    ? [...caisse.depotsEnAttente.map(vueDepot), ...caisse.retraitsEnAttente.map(vueRetrait)]
    : [];
  const liee = caisse?.liee ? vueOperationLiee(caisse.liee) : null;

  return (
    <div className="space-y-3">
      <Field label="Nature de l’opération" htmlFor={`nature-${ecriture.id}`}>
        <NativeSelect
          id={`nature-${ecriture.id}`}
          value={natureDeEcriture(ecriture)}
          disabled={pending}
          onChange={(e) => executer(() => qualifierEcriture(ecriture.id, e.target.value))}
        >
          <option value="" disabled>
            Choisir le mode du transfert…
          </option>
          {NATURES_ECRITURE.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {sens ? (
        <div className="rounded-lg border border-border-soft p-3 space-y-2 text-[12.5px]">
          <div className="font-medium text-fg">Caisse</div>
          {liee ? (
            <p data-testid="operation-caisse-liee">
              Lié au {LIBELLE_OPERATION[sens]} {liee.id} du {liee.date} :{' '}
              <Amount cents={liee.amountCents} />
            </p>
          ) : (
            <>
              {candidats.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{c.date}</span>
                  <Amount cents={c.amountCents} />
                  <span className="text-fg-muted">{c.id}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => executer(() => lierOperationCaisse(ecriture.id, c.id))}
                  >
                    <Link2 size={14} strokeWidth={2} className="mr-1.5" />
                    Lier
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => executer(() => creerOperationCaisseDepuisEcriture(ecriture.id))}
              >
                <Plus size={14} strokeWidth={2} className="mr-1.5" />
                Créer le {LIBELLE_OPERATION[sens]} dans la caisse
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
