'use client';

import { useActionState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { createRepartitionAction, type RepartitionFormState } from '@/lib/actions/repartitions';
import type { Unite } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  unites: Unite[];
  saison: string;
  defaultSourceId?: string | null;
  defaultCibleId?: string | null;
}

const initialState: RepartitionFormState = { error: null };

// Drawer latéral pour la saisie d'une nouvelle répartition. Pattern
// cohérent avec ecriture-drawer.tsx. Utilise useActionState pour
// remonter les erreurs de validation côté serveur.
export function RepartitionDrawer({
  open,
  onClose,
  unites,
  saison,
  defaultSourceId,
  defaultCibleId,
}: Props) {
  const [state, formAction, isPending] = useActionState(createRepartitionAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  // Ferme + reset le form une fois la création réussie (state.error null
  // après une soumission). On compare via une ref pour détecter une
  // transition "submit terminé sans erreur".
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && state.error === null && open) {
      formRef.current?.reset();
      onClose();
    }
    wasPending.current = isPending;
  }, [isPending, state, open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-card w-full max-w-md h-full overflow-y-auto shadow-xl border-l">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold">Nouvelle répartition</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        <form ref={formRef} action={formAction} className="p-4 space-y-4">
          <input type="hidden" name="saison" value={saison} />

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Date</span>
            <Input type="date" name="date_repartition" defaultValue={today} required />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Source</span>
            <NativeSelect name="unite_source_id" defaultValue={defaultSourceId ?? ''}>
              <option value="">— Groupe (pot commun) —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </NativeSelect>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Cible</span>
            <NativeSelect name="unite_cible_id" defaultValue={defaultCibleId ?? ''}>
              <option value="">— Groupe (pot commun) —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </NativeSelect>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Montant (€)</span>
            <Input
              type="text"
              name="amount"
              placeholder="0,00"
              required
              className="text-right tabular-nums"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Libellé</span>
            <Input
              type="text"
              name="libelle"
              placeholder="ex: Quote-part inscriptions"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Notes (optionnel)</span>
            <Textarea name="notes" rows={3} />
          </label>

          {state.error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {state.error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Création…' : 'Créer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
