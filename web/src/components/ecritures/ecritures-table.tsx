'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Landmark, Layers } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UniteBadge } from '@/components/shared/unite-badge';
import { InlineSelect } from '@/components/shared/inline-select';
import { Amount } from '@/components/shared/amount';
import { BatchEditBar } from './batch-edit-bar';
import { updateEcritureField } from '@/lib/actions/ecritures';
import { suggestMatchForEcriture, type MatchDepot, type MatchRemboursement } from '@/lib/services/ecriture-match';
import { EcritureMatchBanner } from './ecriture-match-banner';
import { EcritureInlinePanel } from './ecriture-inline-panel';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';
import type { EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import type { DepotEnriched } from '@/lib/services/depots';

interface Props {
  ecritures: Ecriture[];
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  matchDepots: MatchDepot[];
  matchRembs: MatchRemboursement[];
  detail: { ecriture: Ecriture; justifsBundle: EcritureJustifsBundle; pendingDepots: DepotEnriched[] } | null;
  topCategoryIds: string[];
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

export function EcrituresTable({ ecritures, categories, unites, modesPaiement, activites, cartes, matchDepots, matchRembs, detail, topCategoryIds }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailHref = (id: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('detail', id);
    return `${pathname}?${sp.toString()}`;
  };
  const onRowClick = (id: string) => (ev: React.MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.button === 1) {
      window.open(`/ecritures/${id}`, '_blank');
      return;
    }
    if (detail?.ecriture.id === id) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('detail');
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return;
    }
    router.push(detailHref(id), { scroll: false });
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
      {/* `table-fixed` : la largeur du tableau = celle du conteneur. Les
          colonnes ont des largeurs explicites (sauf Description, flexible),
          et le contenu long tronque au lieu d'élargir le tableau → jamais
          de scroll horizontal. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Tout sélectionner"
                checked={allEditableSelected}
                onChange={toggleAll}
                disabled={editableIds.length === 0}
              />
            </TableHead>
            <TableHead className="w-[92px] whitespace-nowrap">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-[92px] text-right whitespace-nowrap">Montant</TableHead>
            <TableHead className="w-[76px] whitespace-nowrap">Unité</TableHead>
            <TableHead className="w-[150px]">Catégorie</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            if (item.kind === 'header') {
              const g = item.group;
              const gk = groupKey(g.kind, g.id);
              const isCollapsed = collapsed.has(gk);
              const style = GROUP_STYLE[g.kind];
              const editableInGroup = groupEntries(g).filter(isEditable);
              return (
                <TableRow
                  key={item.key}
                  className={`${style.headerBg} cursor-pointer`}
                  onClick={() => toggleGroup(g)}
                >
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    style={isCollapsed ? undefined : { boxShadow: `inset 3px 0 0 0 ${style.rail}` }}
                  >
                    {editableInGroup.length > 0 ? (
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner le groupe ${gk}`}
                        onChange={() => selectGroup(g)}
                        checked={editableInGroup.every((x) => selected.has(x.id))}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground" colSpan={2}>
                    <span className="inline-flex items-center gap-1.5">
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
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate max-w-md">{g.label}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>
                        {g.count} {g.kind === 'bank' ? 'sous-ligne' : 'ventilation'}
                        {g.count > 1 ? 's' : ''}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Amount cents={g.totalCents} tone="signed" />
                  </TableCell>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground whitespace-nowrap">
                    {isCollapsed
                      ? 'cliquer pour déplier'
                      : g.kind === 'bank'
                        ? 'total des sous-lignes visibles'
                        : 'une écriture Comptaweb éclatée par ventilation'}
                  </TableCell>
                </TableRow>
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
                    { amount_cents: e.amount_cents, date_ecriture: e.date_ecriture },
                    matchDepots,
                    matchRembs,
                  )
                : null;
            const isOpen = detail?.ecriture.id === e.id;
            return (
              <Fragment key={item.key}>
                <TableRow
                  className={`${rowBg} ${isOpen ? 'bg-muted/40' : ''} cursor-pointer hover:bg-muted/30 transition-colors`}
                  onClick={onRowClick(e.id)}
                >
                  <TableCell style={railShadow} onClick={stop}>
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${e.id}`}
                      checked={isSelected}
                      onChange={(ev) => toggleRow(item.index, (ev.nativeEvent as MouseEvent).shiftKey)}
                      disabled={!editable}
                      title={editable ? 'Shift+clic pour sélectionner une plage' : 'Écriture synchronisée Comptaweb — non modifiable'}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{e.date_ecriture}</TableCell>
                  <TableCell>
                    <Link
                      href={detailHref(e.id)}
                      className="hover:underline block truncate"
                      title={`${e.description} — clic pour ouvrir le panneau d'édition`}
                      scroll={false}
                      onClick={stop}
                    >
                      {e.description}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} />
                  </TableCell>
                  <TableCell onClick={stop}>
                    <InlineSelect
                      value={e.unite_id}
                      disabled={!editable}
                      placeholder="Aucune unité"
                      options={unites.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
                      display={<UniteBadge code={e.unite_code} name={e.unite_name} couleur={e.unite_couleur} />}
                      onSave={(v) => updateEcritureField(e.id, 'unite_id', v)}
                    />
                  </TableCell>
                  <TableCell className="text-sm" onClick={stop}>
                    <InlineSelect
                      value={e.category_id}
                      disabled={!editable}
                      placeholder="Aucune"
                      options={categories.map((c) => ({ value: c.id, label: c.name }))}
                      display={
                        e.category_name ? (
                          <span className="block truncate" title={e.category_name}>{e.category_name}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )
                      }
                      onSave={(v) => updateEcritureField(e.id, 'category_id', v)}
                    />
                  </TableCell>
                </TableRow>
                {match && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-1.5">
                      <EcritureMatchBanner match={match} ecritureId={e.id} />
                    </TableCell>
                  </TableRow>
                )}
                {isOpen && detail && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0 pb-2">
                      <EcritureInlinePanel
                        ecriture={detail.ecriture}
                        justifsBundle={detail.justifsBundle}
                        pendingDepots={detail.pendingDepots}
                        categories={categories}
                        topCategoryIds={topCategoryIds}
                        unites={unites}
                        modesPaiement={modesPaiement}
                        activites={activites}
                        cartes={cartes}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {ecritures.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

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
