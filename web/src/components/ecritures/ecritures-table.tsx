'use client';

import { useMemo, useState } from 'react';
import { Landmark, Layers, Tag, Activity, Paperclip } from 'lucide-react';
import { UniteBadge } from '@/components/shared/unite-badge';
import { InlineSelect } from '@/components/shared/inline-select';
import { Amount } from '@/components/shared/amount';
import { BatchEditBar } from './batch-edit-bar';
import { updateEcritureField } from '@/lib/actions/ecritures';
import { suggestMatchForEcriture, type MatchDepot, type MatchRemboursement } from '@/lib/services/ecriture-match';
import { EcritureMatchBanner } from './ecriture-match-banner';
import { EcritureInlinePanel } from './ecriture-inline-panel';
import { computeReadiness } from '@/lib/sync-readiness';
import { ValiderCwButton } from './valider-cw-button';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

interface Props {
  ecritures: Ecriture[];
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  matchDepots: MatchDepot[];
  matchRembs: MatchRemboursement[];
  // Clés `rejetPairKey` des correspondances « ne plus proposer » du groupe.
  rejectedMatchKeys: string[];
  topCategoryIds: string[];
  // Rafraîchit une ligne précise après mutation (Lier, etc.).
  refreshRow: (id: string) => void | Promise<void>;
}

const MOIS_COURTS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
function moisCourt(dateIso: string): string {
  const m = parseInt(dateIso.slice(5, 7), 10);
  return MOIS_COURTS[m - 1] ?? '';
}

// Extrait l'intitulé parent bancaire depuis les notes de draft
// (format "… (intitulé parent: PAIEMENT C. PROC XXX).").
function parseIntituleParent(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/intitulé parent:\s*([^)]+)\)?/);
  return m ? m[1].trim().replace(/\s*\.\.\.$/, '') : null;
}

// Deux familles de regroupement, disjointes en pratique :
//   - 'bank' : sous-lignes d'un même paiement bancaire (ligne_bancaire_id) —
//     typiquement des brouillons issus du rapprochement, sans id Comptaweb.
//   - 'cw'   : ventilations d'une même écriture Comptaweb (comptaweb_ecriture_id) —
//     une écriture CW « 1171 € » éclatée en plusieurs lignes (568 Formation,
//     431 Participation, …), chacune une écriture Baloo distincte (grain
//     ventilation, cf. ADR-035).
type GroupKind = 'bank' | 'cw';

interface Group {
  kind: GroupKind;
  id: number;
  label: string;
  sublabel: string;
  totalCents: number; // signé (dépenses négatives, recettes positives)
  count: number;
}

const groupKey = (kind: GroupKind, id: number) => `${kind}-${id}`;

function signedTotal(entries: Ecriture[]): number {
  return entries.reduce((sum, e) => sum + (e.type === 'depense' ? -e.amount_cents : e.amount_cents), 0);
}

// Accent visuel par famille de groupe (rail du header + teinte). Le rail des
// LIGNES, lui, reste piloté par la couleur d'unité (lecture branche au scroll).
const GROUP_STYLE: Record<GroupKind, { rail: string; headerBg: string; rowBg: string; rowRail: string }> = {
  bank: {
    rail: 'rgb(148 163 184 / 0.55)', // slate
    headerBg: 'bg-muted/40 hover:bg-muted/60',
    rowBg: 'bg-slate-50/70 dark:bg-slate-900/30',
    rowRail: 'rgb(148 163 184 / 0.55)',
  },
  cw: {
    rail: 'rgb(79 70 229 / 0.62)', // indigo — « regroupé par écriture Comptaweb »
    headerBg: 'bg-indigo-50/60 hover:bg-indigo-100/60 dark:bg-indigo-950/25 dark:hover:bg-indigo-950/40',
    rowBg: 'bg-indigo-50/35 dark:bg-indigo-950/15',
    rowRail: 'rgb(99 102 241 / 0.5)',
  },
};

type Item =
  | { kind: 'header'; key: string; group: Group }
  | { kind: 'row'; key: string; ecriture: Ecriture; index: number; group: Group | null };

export function EcrituresTable({ ecritures, categories, unites, modesPaiement, activites, cartes, matchDepots, matchRembs, rejectedMatchKeys, topCategoryIds, refreshRow }: Props) {
  const rejectedMatchSet = useMemo(() => new Set(rejectedMatchKeys), [rejectedMatchKeys]);
  // Ouverture du panneau d'édition = état CLIENT pur (pas de navigation
  // `?detail` : elle relançait toute la page → lent, et `useSearchParams`
  // ne se mettait à jour qu'après le serveur, d'où le « refermer » cassé).
  const [openId, setOpenId] = useState<string | null>(null);
  const onRowClick = (id: string) => (ev: React.MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.button === 1) {
      window.open(`/ecritures/${id}`, '_blank');
      return;
    }
    setOpenId((prev) => (prev === id ? null : id));
  };
  const stop = (ev: React.MouseEvent | React.PointerEvent) => ev.stopPropagation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isEditable = (e: Ecriture) => e.status !== 'mirror' && e.status !== 'divergent';
  const editableIds = useMemo(() => ecritures.filter(isEditable).map((e) => e.id), [ecritures]);
  const allEditableSelected = editableIds.length > 0 && editableIds.every((id) => selected.has(id));

  // Pré-calcul des deux familles de groupes + items rendus (header + rows).
  const items = useMemo<Item[]>(() => {
    const byBank = new Map<number, Ecriture[]>();
    const byCw = new Map<number, Ecriture[]>();
    for (const e of ecritures) {
      if (e.ligne_bancaire_id) {
        (byBank.get(e.ligne_bancaire_id) ?? byBank.set(e.ligne_bancaire_id, []).get(e.ligne_bancaire_id)!).push(e);
      }
      if (e.comptaweb_ecriture_id != null) {
        (byCw.get(e.comptaweb_ecriture_id) ?? byCw.set(e.comptaweb_ecriture_id, []).get(e.comptaweb_ecriture_id)!).push(e);
      }
    }
    const isBankGrouped = (id: number): boolean => {
      const b = byBank.get(id) ?? [];
      return b.length > 1 || (b.length === 1 && b[0].ligne_bancaire_sous_index !== null);
    };
    const isCwGrouped = (id: number): boolean => (byCw.get(id)?.length ?? 0) >= 2;

    const groupFor = (e: Ecriture): Group | null => {
      if (e.ligne_bancaire_id && isBankGrouped(e.ligne_bancaire_id)) {
        const entries = byBank.get(e.ligne_bancaire_id)!;
        return {
          kind: 'bank',
          id: e.ligne_bancaire_id,
          label: parseIntituleParent(entries[0].notes) ?? `Ligne bancaire #${e.ligne_bancaire_id}`,
          sublabel: `#${e.ligne_bancaire_id}`,
          totalCents: signedTotal(entries),
          count: entries.length,
        };
      }
      if (e.comptaweb_ecriture_id != null && isCwGrouped(e.comptaweb_ecriture_id)) {
        const entries = byCw.get(e.comptaweb_ecriture_id)!;
        return {
          kind: 'cw',
          id: e.comptaweb_ecriture_id,
          label: entries[0].description,
          sublabel: entries[0].numero_piece ? `pièce ${entries[0].numero_piece}` : `écriture CW #${e.comptaweb_ecriture_id}`,
          totalCents: signedTotal(entries),
          count: entries.length,
        };
      }
      return null;
    };

    const seen = new Set<string>();
    const out: Item[] = [];
    for (let i = 0; i < ecritures.length; i++) {
      const e = ecritures[i];
      const group = groupFor(e);
      if (group) {
        const gk = groupKey(group.kind, group.id);
        if (!seen.has(gk)) {
          seen.add(gk);
          out.push({ kind: 'header', key: `h-${gk}`, group });
        }
      }
      out.push({ kind: 'row', key: e.id, ecriture: e, index: i, group });
    }
    return out;
  }, [ecritures]);

  const toggleRow = (index: number, shift: boolean) => {
    const row = ecritures[index];
    if (!row || !isEditable(row)) return;
    if (shift && anchorIndex !== null && anchorIndex !== index) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const r = ecritures[i];
          if (r && isEditable(r)) next.add(r.id);
        }
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
      return next;
    });
    setAnchorIndex(index);
  };

  const toggleAll = () => {
    if (allEditableSelected) setSelected(new Set());
    else setSelected(new Set(editableIds));
  };

  const clear = () => { setSelected(new Set()); setAnchorIndex(null); };

  const toggleGroup = (g: Group) => {
    const gk = groupKey(g.kind, g.id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gk)) next.delete(gk); else next.add(gk);
      return next;
    });
  };

  const groupEntries = (g: Group): Ecriture[] =>
    ecritures.filter((e) => (g.kind === 'bank' ? e.ligne_bancaire_id === g.id : e.comptaweb_ecriture_id === g.id));

  const selectGroup = (g: Group) => {
    const bucket = groupEntries(g).filter(isEditable);
    if (bucket.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allAlready = bucket.every((e) => next.has(e.id));
      if (allAlready) for (const e of bucket) next.delete(e.id);
      else for (const e of bucket) next.add(e.id);
      return next;
    });
  };

  return (
    <div>
      <div className="rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
        {editableIds.length > 0 && (
          <div className="flex items-center gap-2 px-3 h-9 border-b border-border-soft bg-bg-sunken/40 text-[11.5px] text-fg-muted">
            <input
              type="checkbox"
              aria-label="Tout sélectionner"
              checked={allEditableSelected}
              onChange={toggleAll}
            />
            <span>Tout sélectionner</span>
          </div>
        )}
        <div className="divide-y divide-border-soft">
          {items.map((item) => {
            if (item.kind === 'header') {
              const g = item.group;
              const gk = groupKey(g.kind, g.id);
              const isCollapsed = collapsed.has(gk);
              const style = GROUP_STYLE[g.kind];
              const editableInGroup = groupEntries(g).filter(isEditable);
              return (
                <div
                  key={item.key}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs text-muted-foreground ${style.headerBg}`}
                  onClick={() => toggleGroup(g)}
                  style={isCollapsed ? undefined : { boxShadow: `inset 3px 0 0 0 ${style.rail}` }}
                >
                  {editableInGroup.length > 0 ? (
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner le groupe ${gk}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => selectGroup(g)}
                      checked={editableInGroup.every((x) => selected.has(x.id))}
                    />
                  ) : (
                    <span className="w-[13px]" />
                  )}
                  <span className="text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  {g.kind === 'bank' ? (
                    <Landmark size={13} className="text-muted-foreground" />
                  ) : (
                    <Layers size={13} className="text-indigo-500 dark:text-indigo-400" />
                  )}
                  <span className="font-medium">
                    {g.kind === 'bank' ? 'Ligne bancaire' : 'Écriture Comptaweb'}
                  </span>
                  <code className="text-[11px]">{g.sublabel}</code>
                  <span>·</span>
                  <span className="truncate max-w-md">{g.label}</span>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline">
                    {g.count} {g.kind === 'bank' ? 'sous-ligne' : 'ventilation'}{g.count > 1 ? 's' : ''}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums">
                    <Amount cents={g.totalCents} tone="signed" />
                  </span>
                </div>
              );
            }

            const e = item.ecriture;
            const editable = isEditable(e);
            const isSelected = selected.has(e.id);
            const group = item.group;
            if (group && collapsed.has(groupKey(group.kind, group.id))) return null;

            // Fond teinté selon la famille de groupe ; rail vertical 3px à
            // gauche = couleur d'unité (lecture branche instantanée), avec
            // fallback sur l'accent du groupe pour les lignes sans unité.
            const style = group ? GROUP_STYLE[group.kind] : null;
            const rowBg = isSelected ? 'bg-primary/5' : style ? style.rowBg : '';
            const railColor = e.unite_couleur || (style ? style.rowRail : null);
            const railShadow = railColor ? { boxShadow: `inset 3px 0 0 0 ${railColor}` } : undefined;
            const match =
              !e.has_justificatif && !e.remboursement_id && (matchDepots.length > 0 || matchRembs.length > 0)
                ? suggestMatchForEcriture(
                    { id: e.id, amount_cents: e.amount_cents, date_ecriture: e.date_ecriture, type: e.type },
                    matchDepots,
                    matchRembs,
                    rejectedMatchSet,
                  )
                : null;
            const isOpen = openId === e.id;
            const readiness = computeReadiness(e, { categories, unites, modesPaiement, activites });
            const showValider = e.status === 'draft';
            // Un remboursement lié vaut justificatif (cf. badge « sans justif »).
            const hasJustif = !!e.has_justificatif || !!e.remboursement_id;
            return (
              <div key={item.key}>
                <div
                  className={`group/row flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${rowBg} ${isOpen ? 'bg-muted/40' : 'hover:bg-muted/30'}`}
                  style={railShadow}
                  onClick={onRowClick(e.id)}
                >
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    aria-label={`Sélectionner ${e.id}`}
                    checked={isSelected}
                    onClick={stop}
                    onChange={(ev) => toggleRow(item.index, (ev.nativeEvent as MouseEvent).shiftKey)}
                    disabled={!editable}
                    title={editable ? 'Shift+clic pour sélectionner une plage' : 'Écriture synchronisée Comptaweb — non modifiable'}
                  />
                  <div className="shrink-0 w-10 text-center leading-none pt-0.5">
                    <div className="text-[15px] font-semibold tabular-nums text-fg">{e.date_ecriture.slice(8, 10)}</div>
                    <div className="text-[9.5px] uppercase tracking-wide text-fg-subtle">{moisCourt(e.date_ecriture)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Clic = ouvre/ferme le panneau via la ligne (pas de
                        navigation) ; on laisse l'événement remonter au onClick
                        de la carte. */}
                    <span
                      className="block truncate font-medium text-[13.5px] text-fg hover:underline cursor-pointer"
                      title={e.description}
                    >
                      {e.description}
                    </span>
                    {/* Imputation complète et cohérente : unité + catégorie +
                        activité (les 3 requises pour valider), éditables inline.
                        Un champ manquant s'affiche en ambre. + présence justif. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]" onClick={stop}>
                      <InlineSelect
                        value={e.unite_id}
                        disabled={!editable}
                        placeholder="Aucune unité"
                        options={unites.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
                        display={
                          e.unite_id ? (
                            <UniteBadge code={e.unite_code} name={e.unite_name} couleur={e.unite_couleur} />
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">+ Unité</span>
                          )
                        }
                        onSave={async (v) => {
                          const r = await updateEcritureField(e.id, 'unite_id', v);
                          if (r.ok) void refreshRow(e.id);
                          return r;
                        }}
                      />
                      <InlineSelect
                        value={e.category_id}
                        disabled={!editable}
                        placeholder="Aucune"
                        options={categories.map((c) => ({ value: c.id, label: c.name }))}
                        display={
                          e.category_name ? (
                            <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                              <Tag size={11} className="shrink-0 text-fg-subtle" />
                              <span className="truncate max-w-[160px]" title={e.category_name}>{e.category_name}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Tag size={11} /> + Catégorie
                            </span>
                          )
                        }
                        onSave={async (v) => {
                          const r = await updateEcritureField(e.id, 'category_id', v);
                          if (r.ok) void refreshRow(e.id);
                          return r;
                        }}
                      />
                      <InlineSelect
                        value={e.activite_id}
                        disabled={!editable}
                        placeholder="Aucune"
                        options={activites.map((a) => ({ value: a.id, label: a.name }))}
                        display={
                          e.activite_name ? (
                            <span className="inline-flex items-center gap-1 text-fg-muted min-w-0">
                              <Activity size={11} className="shrink-0 text-fg-subtle" />
                              <span className="truncate max-w-[160px]" title={e.activite_name}>{e.activite_name}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Activity size={11} /> + Activité
                            </span>
                          )
                        }
                        onSave={async (v) => {
                          const r = await updateEcritureField(e.id, 'activite_id', v);
                          if (r.ok) void refreshRow(e.id);
                          return r;
                        }}
                      />
                      <span
                        className={`inline-flex items-center gap-1 ${hasJustif ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-subtle'}`}
                        title={hasJustif ? 'Justificatif présent' : 'Aucun justificatif'}
                      >
                        <Paperclip size={11} className={`shrink-0 ${hasJustif ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle/60'}`} />
                        {hasJustif ? 'justif' : 'sans justif'}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 w-[92px] text-right font-medium tabular-nums self-center">
                    <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} />
                  </div>
                  <div className="shrink-0 w-[88px] flex justify-end self-center" onClick={stop}>
                    {showValider && (
                      <ValiderCwButton
                        ecritureId={e.id}
                        disabled={readiness.level === 'incomplete'}
                        missing={readiness.missingFields}
                        onValidated={() => void refreshRow(e.id)}
                      />
                    )}
                  </div>
                </div>
                {match && (
                  <div className="px-3 pb-2 pl-16">
                    <EcritureMatchBanner match={match} ecritureId={e.id} refreshRow={refreshRow} />
                  </div>
                )}
                {isOpen && (
                  <div className="px-3 pb-2">
                    <EcritureInlinePanel
                      ecriture={e}
                      onCollapse={() => setOpenId(null)}
                      refreshRow={refreshRow}
                      categories={categories}
                      topCategoryIds={topCategoryIds}
                      unites={unites}
                      modesPaiement={modesPaiement}
                      activites={activites}
                      cartes={cartes}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {ecritures.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">Aucune écriture</div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <BatchEditBar
          selectedIds={Array.from(selected)}
          categories={categories}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          onApplied={clear}
          onCancel={clear}
        />
      )}
    </div>
  );
}
