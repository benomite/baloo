'use client';

// Wizard client de saisie d'un mouvement caisse — Task 9 du pivot
// miroir strict + MCP-first.
//
// Doctrine (cf. doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md
// "Aucun write Comptaweb pour la caisse") : la caisse Baloo est une
// saisie purement locale (CW ne supporte pas le scraping write des
// mouvements caisse). Pour rester cohérent avec le pivot "Baloo
// prépare, l'utilisateur valide dans CW", on garde la saisie locale
// **+** on affiche un bouton "Tout copier" pour la double saisie CW.
//
// Différent de Task 8 (écritures) : ici la saisie locale est OK, le
// `<form action={createMouvementCaisse}>` reste fonctionnel.

import { useRef, useState } from 'react';
import { Plus, Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/shared/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { CwAssistActions } from '@/components/ecritures/cw-assist-actions';
import { parseAmount } from '@/lib/format';
import {
  formatCaisseForClipboard,
  type CaissePayload,
} from './format-caisse-clipboard';
import type { CwAssistPayload } from '@/components/ecritures/cw-assist-actions';
import type { Unite, Activite } from '@/lib/types';

interface Props {
  unites: Unite[];
  activites: Activite[];
  defaultDate: string;
  /**
   * Server action de création locale (existante). Non modifiée par
   * cette Task — le wizard l'utilise tel quel via `<form action>`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMouvementAction: (formData: FormData) => any;
}

/**
 * Lit le payload courant du form (sens, montant, date, libellé,
 * unité, activité) pour le formatter clipboard côté CW.
 */
function readCaissePayload(
  form: HTMLFormElement,
  unites: Unite[],
  activites: Activite[],
): CaissePayload {
  const fd = new FormData(form);
  const sens = (fd.get('sens') as string | null) ?? 'entree';
  const montantStr = (fd.get('montant') as string | null) ?? '';
  const uniteId = (fd.get('unite_id') as string | null) || null;
  const activiteId = (fd.get('activite_id') as string | null) || null;

  const unite_label =
    uniteId == null ? null : (unites.find((u) => u.id === uniteId)?.code ?? null);
  const activite_label =
    activiteId == null
      ? null
      : (activites.find((a) => a.id === activiteId)?.name ?? null);

  return {
    date_mouvement: (fd.get('date_mouvement') as string | null) ?? '',
    amount_cents: parseAmount(montantStr),
    type: sens === 'sortie' ? 'sortie' : 'entree',
    description: (fd.get('description') as string | null) ?? '',
    unite_label,
    activite_label,
    notes: null,
  };
}

/**
 * Adapte un `CaissePayload` vers le payload générique `CwAssistPayload`
 * attendu par `<CwAssistActions>`. Le format clipboard est piloté via
 * la prop `formatForClipboard` — on n'utilise que les champs de base.
 */
function caisseToCwAssistPayload(p: CaissePayload): CwAssistPayload {
  return {
    date_ecriture: p.date_mouvement,
    description: p.description,
    // CW attend une "recette" / "dépense" — on map entrée → recette,
    // sortie → dépense pour ne pas surprendre. Mais ce champ n'est
    // pas utilisé par notre `formatForClipboard` custom.
    amount_cents: Math.abs(p.amount_cents),
    type: p.type === 'sortie' ? 'depense' : 'recette',
    notes: p.notes,
  };
}

export function CaisseMouvementWizard({
  unites,
  activites,
  defaultDate,
  createMouvementAction,
}: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [payload, setPayload] = useState<CaissePayload>(() => ({
    date_mouvement: defaultDate,
    amount_cents: 0,
    type: 'entree',
    description: '',
    unite_label: null,
    activite_label: null,
    notes: null,
  }));

  const refreshPayload = () => {
    if (formRef.current) {
      setPayload(readCaissePayload(formRef.current, unites, activites));
    }
  };

  return (
    <div className="space-y-4">
      <div data-testid="caisse-cw-info-banner">
        <Alert variant="info" icon={Info}>
          <p className="font-medium">
            Le mouvement est enregistré dans Baloo.
          </p>
          <p className="mt-0.5 text-[12.5px] opacity-90">
            Pense à le saisir aussi dans la caisse Comptaweb — Baloo ne sait
            pas l&apos;envoyer automatiquement (Comptaweb ne supporte pas
            l&apos;écriture caisse via API). Utilise{' '}
            <span className="font-medium">« Tout copier »</span> pour gagner du temps.
          </p>
        </Alert>
      </div>

      <form
        ref={formRef}
        action={createMouvementAction}
        onChange={refreshPayload}
        onInput={refreshPayload}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sens" htmlFor="sens" required>
            <NativeSelect id="sens" name="sens" defaultValue="entree">
              <option value="entree">↗ Entrée (recette)</option>
              <option value="sortie">↘ Sortie (dépense)</option>
            </NativeSelect>
          </Field>
          <Field label="Montant" htmlFor="montant" required hint="format 15,00">
            <Input
              id="montant"
              name="montant"
              required
              placeholder="15,00"
              inputMode="decimal"
              className="tabular-nums"
            />
          </Field>
        </div>
        <Field label="Date" htmlFor="date_mouvement" required>
          <Input
            type="date"
            id="date_mouvement"
            name="date_mouvement"
            required
            defaultValue={defaultDate}
          />
        </Field>
        <Field label="Description" htmlFor="description" required>
          <Input
            id="description"
            name="description"
            required
            placeholder="Ex. quête camp été"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unité" htmlFor="unite_id" hint="optionnel">
            <NativeSelect id="unite_id" name="unite_id">
              <option value="">— Groupe —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Activité" htmlFor="activite_id" hint="optionnel">
            <NativeSelect id="activite_id" name="activite_id">
              <option value="">— Aucune —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="flex justify-end">
          <PendingButton>
            <Plus size={14} strokeWidth={2} className="mr-1.5" />
            Enregistrer
          </PendingButton>
        </div>
      </form>

      <div className="border-t border-border pt-3">
        <p className="mb-2 text-[12px] text-fg-muted">
          Une fois enregistré, copie le récap pour le reporter dans la caisse
          Comptaweb :
        </p>
        <CwAssistActions
          payload={caisseToCwAssistPayload(payload)}
          formatForClipboard={() => formatCaisseForClipboard(payload)}
        />
      </div>
    </div>
  );
}
