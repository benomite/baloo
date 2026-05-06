'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, Clock, Landmark, Paperclip, MinusCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EcritureStatePair } from '@/components/shared/status-badge';
import { UniteBadge } from '@/components/shared/unite-badge';
import { InlineSelect } from '@/components/shared/inline-select';
import { Amount } from '@/components/shared/amount';
import { BatchEditBar } from './batch-edit-bar';
import { updateEcritureField } from '@/lib/actions/ecritures';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

interface Props {
  ecritures: Ecriture[];
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}

// Extrait l'intitulé parent bancaire depuis les notes de draft
// (format "… (intitulé parent: PAIEMENT C. PROC XXX).").
function parseIntituleParent(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/intitulé parent:\s*([^)]+)\)?/);
  return m ? m[1].trim().replace(/\s*\.\.\.$/, '') : null;
}

interface GroupInfo {
  intitule: string;
  totalCents: number; // signé (dépenses négatives, recettes positives)
  count: number;
}

function buildGroupInfo(entries: Ecriture[]): GroupInfo {
  const intitule = parseIntituleParent(entries[0].notes) ?? `Ligne bancaire #${entries[0].ligne_bancaire_id ?? ''}`;
  const totalCents = entries.reduce(
    (sum, e) => sum + (e.type === 'depense' ? -e.amount_cents : e.amount_cents),
    0,
  );
  return { intitule, totalCents, count: entries.length };
}

type Item =
  | { kind: 'header'; key: string; ligneBancaireId: number; info: GroupInfo }
  | { kind: 'row'; key: string; ecriture: Ecriture; index: number; inGroup: boolean };

export function EcrituresTable({ ecritures, categories, unites, modesPaiement, activites, cartes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Préserve les filtres courants (?type=, ?incomplete=…) en ajoutant
  // ?detail= pour ouvrir le drawer sur cette écriture.
  const detailHref = (id: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('detail', id);
    return `${pathname}?${sp.toString()}`;
  };
  // Clic sur la ligne entière → ouvre le drawer. Cmd/Ctrl+clic =
  // nouvel onglet (page complète) pour l'usage rare où on veut
  // travailler sur 2 écritures côte à côte.
  const onRowClick = (id: string) => (ev: React.MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.button === 1) {
      window.open(`/ecritures/${id}`, '_blank');
      return;
    }
    router.push(detailHref(id), { scroll: false });
  };
  // Empêche le clic sur les zones interactives de déclencher l'ouverture
  // du drawer (checkbox, selects inline).
  const stop = (ev: React.MouseEvent | React.PointerEvent) => ev.stopPropagation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const isEditable = (e: Ecriture) => e.status !== 'saisie_comptaweb';
  const editableIds = useMemo(
    () => ecritures.filter(isEditable).map((e) => e.id),
    [ecritures],
  );
  const allEditableSelected = editableIds.length > 0 && editableIds.every((id) => selected.has(id));

  // Pré-calcul des groupes par ligne bancaire + items rendus (header + rows).
  // Un groupe est rendu comme tel dès qu'il y a >=2 entrées visibles pour la
  // même ligne bancaire, OU 1 entrée avec sous_index (= c'est bien une
  // sous-ligne DSP2 d'un paiement multi-commerçants).
  const { items, groupsById } = useMemo(() => {
    const buckets = new Map<number, Ecriture[]>();
    for (const e of ecritures) {
      if (e.ligne_bancaire_id) {
        if (!buckets.has(e.ligne_bancaire_id)) buckets.set(e.ligne_bancaire_id, []);
        buckets.get(e.ligne_bancaire_id)!.push(e);
      }
    }
    const groupsById = new Map<number, GroupInfo>();
    const isGrouped = (id: number): boolean => {
      const b = buckets.get(id) ?? [];
      return b.length > 1 || (b.length === 1 && b[0].ligne_bancaire_sous_index !== null);
    };

    const seen = new Set<number>();
    const out: Item[] = [];
    for (let i = 0; i < ecritures.length; i++) {
      const e = ecritures[i];
      const id = e.ligne_bancaire_id;
      if (id && isGrouped(id)) {
        if (!seen.has(id)) {
          seen.add(id);
          const info = buildGroupInfo(buckets.get(id)!);
          groupsById.set(id, info);
          out.push({ kind: 'header', key: `h-${id}`, ligneBancaireId: id, info });
        }
        out.push({ kind: 'row', key: e.id, ecriture: e, index: i, inGroup: true });
      } else {
        out.push({ kind: 'row', key: e.id, ecriture: e, index: i, inGroup: false });
      }
    }
    return { items: out, groupsById };
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

  const toggleGroup = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectGroup = (id: number) => {
    const bucket = ecritures.filter((e) => e.ligne_bancaire_id === id && isEditable(e));
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
      <Table>
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
            <TableHead className="whitespace-nowrap">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right whitespace-nowrap">Montant</TableHead>
            <TableHead className="whitespace-nowrap">Unité</TableHead>
            <TableHead>Catégorie</TableHead>
            <TableHead className="whitespace-nowrap">Statut</TableHead>
            <TableHead className="text-center whitespace-nowrap" title="Champs manquants">⚠</TableHead>
            <TableHead className="text-center whitespace-nowrap" title="Source / Comptaweb / Justificatif">État</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            if (item.kind === 'header') {
              const isCollapsed = collapsed.has(item.ligneBancaireId);
              const signed = item.info.totalCents;
              return (
                <TableRow
                  key={item.key}
                  className="bg-muted/40 hover:bg-muted/60 cursor-pointer"
                  onClick={() => toggleGroup(item.ligneBancaireId)}
                >
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    style={isCollapsed ? undefined : { boxShadow: 'inset 3px 0 0 0 rgb(148 163 184 / 0.55)' }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner le groupe ${item.ligneBancaireId}`}
                      onChange={() => selectGroup(item.ligneBancaireId)}
                      checked={(() => {
                        const bucket = ecritures.filter((x) => x.ligne_bancaire_id === item.ligneBancaireId && isEditable(x));
                        return bucket.length > 0 && bucket.every((x) => selected.has(x.id));
                      })()}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground" colSpan={2}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-xs">{isCollapsed ? '▶' : '▼'}</span>
                      <Landmark size={13} className="text-muted-foreground" />
                      <span>Ligne bancaire <code>#{item.ligneBancaireId}</code></span>
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate max-w-md font-medium">{item.info.intitule}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>{item.info.count} sous-ligne{item.info.count > 1 ? 's' : ''}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Amount cents={signed} tone="signed" />
                  </TableCell>
                  <TableCell colSpan={5} className="text-xs text-muted-foreground whitespace-nowrap">
                    {isCollapsed ? 'cliquer pour déplier' : 'total des sous-lignes visibles'}
                  </TableCell>
                </TableRow>
              );
            }

            const e = item.ecriture;
            const editable = isEditable(e);
            const isSelected = selected.has(e.id);
            const groupInfo = e.ligne_bancaire_id ? groupsById.get(e.ligne_bancaire_id) : undefined;
            if (groupInfo && collapsed.has(e.ligne_bancaire_id!)) return null;

            // Les sous-lignes d'un même paiement bancaire partagent un fond
            // légèrement teinté et un rail vertical (box-shadow inset sur la
            // première cellule) pour donner un groupement visible sans ajouter
            // d'icône parasite devant la description.
            const rowBg = isSelected
              ? 'bg-primary/5'
              : item.inGroup ? 'bg-slate-50/70 dark:bg-slate-900/30' : '';
            // Rail vertical 3px à gauche : couleur de l'unité
            // (lecture par unité instantanée au scroll). Fallback gris
            // pour les sous-lignes bancaires sans unité, sinon rien.
            const railColor = e.unite_couleur || (item.inGroup ? 'rgb(148 163 184 / 0.55)' : null);
            const railShadow = railColor
              ? { boxShadow: `inset 3px 0 0 0 ${railColor}` }
              : undefined;
            return (
              <TableRow
                key={item.key}
                className={`${rowBg} cursor-pointer hover:bg-muted/30 transition-colors`}
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
                <TableCell className="max-w-[280px]">
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
                    display={<span>{e.category_name ?? <span className="text-muted-foreground">—</span>}</span>}
                    onSave={(v) => updateEcritureField(e.id, 'category_id', v)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <EcritureStatePair
                    hasJustif={!!e.has_justificatif}
                    comptawebSynced={e.comptaweb_synced === 1}
                  />
                </TableCell>
                <TableCell className="text-xs text-center whitespace-nowrap">
                  {e.missing_fields && e.missing_fields.length > 0 ? (
                    <span
                      className="inline-block rounded bg-orange-100 text-orange-800 px-1.5 py-0.5"
                      title={`Champs manquants : ${e.missing_fields.join(', ')}`}
                    >
                      {e.missing_fields.length}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    {/* Comptaweb sync */}
                    {e.comptaweb_synced ? (
                      <CheckCircle2
                        size={14}
                        strokeWidth={2}
                        className="text-emerald-600"
                        aria-label="Synchronisée Comptaweb"
                      >
                        <title>Synchronisée Comptaweb</title>
                      </CheckCircle2>
                    ) : (
                      <Circle
                        size={14}
                        strokeWidth={1.75}
                        className="text-fg-subtle/40"
                        aria-label="Non synchronisée"
                      >
                        <title>Non synchronisée Comptaweb</title>
                      </Circle>
                    )}
                    {/* Justificatif */}
                    {e.has_justificatif ? (
                      <Paperclip
                        size={14}
                        strokeWidth={2}
                        className="text-emerald-600"
                        aria-label="Justificatif rattaché"
                      >
                        <title>Justificatif rattaché</title>
                      </Paperclip>
                    ) : e.justif_attendu === 0 ? (
                      <MinusCircle
                        size={14}
                        strokeWidth={1.75}
                        className="text-fg-subtle/40"
                        aria-label="Justif non attendu"
                      >
                        <title>Justif non attendu (prélèvement / flux territoire)</title>
                      </MinusCircle>
                    ) : e.numero_piece ? (
                      <Clock
                        size={14}
                        strokeWidth={2}
                        className="text-amber-600"
                        aria-label="En attente"
                      >
                        <title>{`En attente — code Comptaweb ${e.numero_piece}`}</title>
                      </Clock>
                    ) : (
                      <Paperclip
                        size={14}
                        strokeWidth={1.75}
                        className="text-fg-subtle/40"
                        aria-label="Justif manquant"
                      >
                        <title>Justif manquant</title>
                      </Paperclip>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {ecritures.length === 0 && (
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
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
