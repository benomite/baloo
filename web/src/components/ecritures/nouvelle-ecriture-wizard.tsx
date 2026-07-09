'use client';

// Wizard client de saisie d'une nouvelle écriture — Task 8 du pivot
// miroir strict + MCP-first.
//
// Doctrine (cf. doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md
// "Le pattern interface Comptaweb assistée") : cette page n'écrit JAMAIS
// en local sans passer par Comptaweb d'abord. Le formulaire **prépare**
// un payload ; les 3 boutons `CwAssistActions` offrent 3 chemins (full
// auto via scraping, deep-link CW, copier-coller).
//
// Choix archi (cf. brief Task 8 sous-mission C, option (a)) : on retire
// la server action `createEcriture` ; le submit "Faire dans CW" passe
// par `fetch('/api/ecritures')` — le même endpoint que le MCP. Pattern
// cohérent avec la spec "MCP et front passent par les mêmes endpoints".

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { EcritureFormFields } from './ecriture-form';
import { CwAssistActions, type CwAssistPayload } from './cw-assist-actions';
import { ventilationsToPayload, type VentilationRow } from './ventilations-form';
import { parseAmount } from '@/lib/format';
import type { Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

interface Props {
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}

/**
 * Extrait le payload "Baloo-friendly" depuis un `<form>` DOM + l'état
 * contrôlé `vents` du répéteur de ventilations (Task 7, S0). Centralisé
 * pour que les 3 boutons (submit, copy, deeplink) voient la même chose.
 *
 * `vents` porte l'imputation (catégorie/unité/activité + montant par
 * ligne) — ce n'est plus lu depuis le FormData : `category_id`/
 * `unite_id`/`activite_id` n'existent plus comme champs racine dans le
 * DOM du wizard (cf. `EcritureFormFields` mode='wizard').
 */
function readPayloadFromForm(form: HTMLFormElement, vents: VentilationRow[]): CwAssistPayload {
  const fd = new FormData(form);
  const get = (k: string): string | null => {
    const v = fd.get(k);
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const ventilations = ventilationsToPayload(vents);
  const amount_cents = ventilations.reduce((s, v) => s + v.amount_cents, 0);
  // Mode dégradé "Copier" / deep-link (`CwAssistActions`, `hideCopy`) :
  // pertinent uniquement en mono-ventilation, on y reflète alors la
  // ligne unique. Sinon `null` — les boutons concernés sont masqués.
  const single = ventilations.length === 1 ? ventilations[0] : null;
  return {
    date_ecriture: (fd.get('date_ecriture') as string) ?? '',
    description: (fd.get('description') as string) ?? '',
    amount_cents,
    type: ((fd.get('type') as string) ?? 'depense') as 'depense' | 'recette',
    category_id: single?.category_id ?? null,
    unite_id: single?.unite_id ?? null,
    activite_id: single?.activite_id ?? null,
    mode_paiement_id: get('mode_paiement_id'),
    carte_id: get('carte_id'),
    numero_piece: get('numero_piece'),
    notes: get('notes'),
    justif_attendu: fd.has('justif_attendu'),
    ventilations,
  };
}

export function NouvelleEcritureWizard({
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  // Répéteur de ventilations (Task 7, S0) : levé ici (pas dans
  // `EcritureFormFields`) parce que ce composant en a besoin pour
  // construire le body POST et pour désactiver le bouton "Faire dans CW"
  // (cf. `submitDisabled` plus bas).
  const [vents, setVents] = useState<VentilationRow[]>(() => [
    { id: 'v0', amount: '', category_id: null, unite_id: null, activite_id: null },
  ]);
  // On garde un payload dans le state pour que `CwAssistActions` puisse le
  // lire au moment du clic. On le rafraîchit à chaque interaction du form
  // (onChange / onInput) et à chaque changement de `vents`.
  const [payload, setPayload] = useState<CwAssistPayload>(() => ({
    date_ecriture: new Date().toISOString().split('T')[0],
    description: '',
    amount_cents: 0,
    type: 'depense',
    justif_attendu: true,
    ventilations: [],
  }));

  const refreshPayload = () => {
    if (formRef.current) setPayload(readPayloadFromForm(formRef.current, vents));
  };

  // `vents` change en dehors des events DOM natifs du <form> (state React
  // contrôlé) — `onChange`/`onInput` ne se déclenchent donc pas pour lui.
  // On resynchronise `payload` explicitement à chaque changement.
  useEffect(() => {
    refreshPayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vents]);

  const noopAction = () => {
    // Le form n'utilise plus de server action — c'est le bouton "Faire
    // dans CW pour moi" qui pilote tout. On garde un handler vide pour
    // satisfaire la signature de `EcritureForm.action`.
  };

  const handleSubmitToCw = async (p: CwAssistPayload) => {
    // Garde-fou : description / montant obligatoires côté zod sur la
    // route. On laisse le 400 remonter, le message d'erreur sera affiché
    // par `CwAssistActions` dans la zone error.
    //
    // Multi-ventilation (S0) : plus de category_id/unite_id/activite_id
    // racine — l'imputation vit uniquement dans `ventilations[]` (cf.
    // schema Zod `/api/ecritures`, .refine somme = amount_cents).
    const body = {
      date_ecriture: p.date_ecriture,
      description: p.description,
      amount_cents: p.amount_cents,
      type: p.type,
      mode_paiement_id: p.mode_paiement_id ?? undefined,
      numero_piece: p.numero_piece ?? undefined,
      carte_id: p.carte_id ?? undefined,
      justif_attendu: !!p.justif_attendu,
      notes: p.notes ?? undefined,
      ventilations: p.ventilations ?? [],
    };
    const res = await fetch('/api/ecritures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; ecriture: { id: string } }
      | {
          ok: false;
          error: string;
          message?: string;
          ecriture_id?: string;
          fallback_status?: 'draft';
        }
      | null;

    if (res.ok && json && 'ok' in json && json.ok === true) {
      return {
        ok: true as const,
        ecriture_id: json.ecriture.id,
      };
    }

    // Échec : on extrait le message le plus parlant du body, sinon fallback HTTP.
    const message =
      (json && 'message' in json && json.message) ||
      (json && 'error' in json && json.error) ||
      `Échec HTTP ${res.status}`;
    return {
      ok: false as const,
      error: message,
      ecriture_id: json && 'ecriture_id' in json ? json.ecriture_id : undefined,
      fallback_status:
        json && 'fallback_status' in json ? json.fallback_status : undefined,
    };
  };

  // Gate du bouton "Faire dans CW" : chaque ligne doit être complète
  // (montant fini et > 0, catégorie, unité et activité choisies). Pas de
  // terme "reste à ventiler" ici : le total (`amount_cents`) est dérivé
  // des lignes (Σ ventilations, cf. `readPayloadFromForm`), donc le reste
  // est TOUJOURS 0 par construction dans ce wizard — ce cas ne peut
  // jamais désactiver le submit (cf. commentaire équivalent dans
  // `ecriture-form.tsx`, où l'affichage correspondant a été retiré).
  const hasIncompleteLine = vents.some((v) => {
    const cents = parseAmount(v.amount || '0');
    return (
      !v.amount ||
      !Number.isFinite(cents) ||
      cents <= 0 ||
      !v.category_id ||
      !v.unite_id ||
      !v.activite_id
    );
  });
  const submitDisabled = hasIncompleteLine;

  return (
    <div className="space-y-6">
      <Alert variant="info" icon={Info}>
        <p className="font-medium">
          Cette page <span className="font-semibold">prépare</span> une saisie dans Comptaweb.
        </p>
        <p className="mt-0.5 text-[12.5px] opacity-90">
          Baloo n&apos;écrit jamais en local sans passer par Comptaweb d&apos;abord.
          Choisis « Faire dans Comptaweb pour moi » (auto), ou « Tout copier » (manuel).
        </p>
      </Alert>

      <form
        ref={formRef}
        action={noopAction}
        onChange={refreshPayload}
        onInput={refreshPayload}
        className="space-y-6"
      >
        <EcritureFormFields
          mode="wizard"
          categories={categories}
          topCategoryIds={topCategoryIds}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          vents={vents}
          setVents={setVents}
        />
      </form>

      <CwAssistActions
        payload={payload}
        submitDisabled={submitDisabled}
        // Copier/deeplink masqués dès qu'il y a >1 ventilation : un
        // copier-coller qui ne reflète que le total + la 1ʳᵉ ligne
        // serait trompeur (cf. brief Task 7).
        hideCopy={vents.length > 1}
        onSubmitToCw={handleSubmitToCw}
        onSuccess={(r) => {
          // Pattern miroir : l'écriture est en `pending_sync` côté Baloo.
          // On route vers /ecritures qui montrera le badge "Envoyée à CW".
          // (Pas vers /ecritures/[id] : la page d'édition n'a pas grand
          // chose à montrer tant que la sync n'a pas confirmé le miroir.)
          if (r.ecriture_id) {
            router.push(`/ecritures/${r.ecriture_id}`);
          } else {
            router.push('/ecritures');
          }
          router.refresh();
        }}
      />
    </div>
  );
}

