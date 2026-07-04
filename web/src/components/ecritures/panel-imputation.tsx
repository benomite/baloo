'use client';

import { Tag, Activity, CreditCard, Wallet, AlertTriangle } from 'lucide-react';
import { UniteBadge } from '@/components/shared/unite-badge';
import { InlineSelect } from '@/components/shared/inline-select';
import { updateEcritureField } from '@/lib/actions/ecritures';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

// Rappel d'imputation dans le panneau, en chips `InlineSelect` — les MÊMES
// que la ligne repliée (cohérence). L'imputation courante (unité/cat/activité)
// se fait surtout sur la ligne ; ici on complète mode / carte (absents de la
// ligne) et on garde un rappel éditable des 3 champs requis. Tout passe par
// `updateEcritureField` (whitelist stricte).

const MISSING = 'text-amber-600 dark:text-amber-400';

export function PanelImputation({
  ecriture,
  categories,
  unites,
  modesPaiement,
  activites,
  cartes,
  editable,
  missingFields,
  refreshRow,
}: {
  ecriture: Ecriture;
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  editable: boolean;
  missingFields: string[];
  refreshRow?: (id: string) => void | Promise<void>;
}) {
  const save = (field: 'unite_id' | 'category_id' | 'activite_id' | 'mode_paiement_id' | 'carte_id') =>
    async (v: string | null) => {
      const r = await updateEcritureField(ecriture.id, field, v);
      if (r.ok) void refreshRow?.(ecriture.id);
      return r;
    };

  return (
    <div className="space-y-2">
      {missingFields.length > 0 && (
        <p className={`flex items-center gap-1 text-[12px] ${MISSING}`}>
          <AlertTriangle size={12} strokeWidth={2.25} /> manque : {missingFields.join(', ')}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
        <InlineSelect
          value={ecriture.unite_id}
          disabled={!editable}
          options={unites.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
          onSave={save('unite_id')}
          display={
            ecriture.unite_id ? (
              <UniteBadge code={ecriture.unite_code} name={ecriture.unite_name} couleur={ecriture.unite_couleur} />
            ) : (
              <span className={MISSING}>+ Unité</span>
            )
          }
        />
        <InlineSelect
          value={ecriture.category_id}
          disabled={!editable}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          onSave={save('category_id')}
          display={
            ecriture.category_name ? (
              <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                <Tag size={12} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{ecriture.category_name}</span>
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 ${MISSING}`}><Tag size={12} /> + Catégorie</span>
            )
          }
        />
        <InlineSelect
          value={ecriture.activite_id}
          disabled={!editable}
          options={activites.map((a) => ({ value: a.id, label: a.name }))}
          onSave={save('activite_id')}
          display={
            ecriture.activite_name ? (
              <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                <Activity size={12} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{ecriture.activite_name}</span>
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 ${MISSING}`}><Activity size={12} /> + Activité</span>
            )
          }
        />
        <InlineSelect
          value={ecriture.mode_paiement_id}
          disabled={!editable}
          options={modesPaiement.map((m) => ({ value: m.id, label: m.name }))}
          onSave={save('mode_paiement_id')}
          display={
            ecriture.mode_paiement_name ? (
              <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                <Wallet size={12} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{ecriture.mode_paiement_name}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-fg-subtle"><Wallet size={12} /> Mode</span>
            )
          }
        />
        <InlineSelect
          value={ecriture.carte_id}
          disabled={!editable}
          options={cartes.map((c) => ({
            value: c.id,
            label: `${c.type === 'procurement' ? 'Procurement' : 'CB'} — ${c.porteur}${c.code_externe ? ` (${c.code_externe})` : ''}`,
          }))}
          onSave={save('carte_id')}
          display={
            ecriture.carte_porteur ? (
              <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                <CreditCard size={12} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{ecriture.carte_type === 'procurement' ? 'Procurement' : 'CB'} · {ecriture.carte_porteur}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-fg-subtle"><CreditCard size={12} /> Carte</span>
            )
          }
        />
      </div>
    </div>
  );
}
