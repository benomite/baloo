'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { batchUpdateEcritures, type BatchPatch } from '@/lib/actions/ecritures';
import { batchSyncDraftsToComptaweb } from '@/lib/actions/drafts';
import type { Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

const KEEP = '__keep__';
const CLEAR = '__clear__';

interface Props {
  selectedIds: string[];
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  onApplied: () => void;
  onCancel: () => void;
}

export function BatchEditBar({ selectedIds, categories, unites, modesPaiement, activites, cartes, onApplied, onCancel }: Props) {
  const [unite, setUnite] = useState(KEEP);
  const [category, setCategory] = useState(KEEP);
  const [activite, setActivite] = useState(KEEP);
  const [mode, setMode] = useState(KEEP);
  const [carte, setCarte] = useState(KEEP);
  const [justifAttendu, setJustifAttendu] = useState(KEEP);
  const [descPrefix, setDescPrefix] = useState('');
  const [pendingUpdate, startUpdateTransition] = useTransition();
  const [pendingSync, startSyncTransition] = useTransition();
  const pending = pendingUpdate || pendingSync;

  const resolve = (v: string): string | null | undefined => {
    if (v === KEEP) return undefined;
    if (v === CLEAR) return null;
    return v;
  };

  const hasChange =
    unite !== KEEP ||
    category !== KEEP ||
    activite !== KEEP ||
    mode !== KEEP ||
    carte !== KEEP ||
    justifAttendu !== KEEP ||
    descPrefix.trim().length > 0;

  const apply = () => {
    if (!hasChange) {
      toast.info('Aucune modification à appliquer.');
      return;
    }
    const patch: BatchPatch = {};
    const u = resolve(unite); if (u !== undefined) patch.unite_id = u;
    const c = resolve(category); if (c !== undefined) patch.category_id = c;
    const a = resolve(activite); if (a !== undefined) patch.activite_id = a;
    const m = resolve(mode); if (m !== undefined) patch.mode_paiement_id = m;
    const ca = resolve(carte); if (ca !== undefined) patch.carte_id = ca;
    if (justifAttendu !== KEEP) patch.justif_attendu = justifAttendu === '1' ? 1 : 0;
    if (descPrefix.trim()) patch.description_prefix = descPrefix.trim();

    startUpdateTransition(async () => {
      const res = await batchUpdateEcritures(selectedIds, patch);
      if (res.updated === 0 && res.skipped > 0) {
        toast.error(`Aucune mise à jour : ${res.skipped} écriture${res.skipped > 1 ? 's' : ''} déjà synchronisée${res.skipped > 1 ? 's' : ''} Comptaweb.`);
        return;
      }
      let msg = `${res.updated} écriture${res.updated > 1 ? 's' : ''} mise${res.updated > 1 ? 's' : ''} à jour`;
      if (res.skipped > 0) msg += ` · ${res.skipped} ignorée${res.skipped > 1 ? 's' : ''} (saisie Comptaweb)`;
      toast.success(msg);
      onApplied();
    });
  };

  const sync = () => {
    const n = selectedIds.length;
    const confirmed = window.confirm(
      `Synchroniser ${n} écriture${n > 1 ? 's' : ''} vers Comptaweb ?\n\n` +
      `Cette action crée les écritures en prod dans Comptaweb et passe les drafts en statut « saisie_comptaweb ». Irréversible depuis Baloo.\n\n` +
      `Les drafts incomplets (nature/activité/unité/mode/justif manquant) seront ignorés.`,
    );
    if (!confirmed) return;

    startSyncTransition(async () => {
      const t = toast.loading(`Synchronisation de ${n} écriture${n > 1 ? 's' : ''} vers Comptaweb…`);
      const res = await batchSyncDraftsToComptaweb(selectedIds);
      toast.dismiss(t);
      const parts: string[] = [];
      if (res.succeeded > 0) parts.push(`${res.succeeded} synchronisée${res.succeeded > 1 ? 's' : ''}`);
      if (res.incomplete > 0) parts.push(`${res.incomplete} à compléter`);
      if (res.failed > 0) parts.push(`${res.failed} en erreur`);
      const summary = parts.join(' · ') || 'aucune action';

      if (res.sessionExpired) {
        toast.error(`Session Comptaweb expirée après ${res.succeeded} synchro${res.succeeded > 1 ? 's' : ''}. Relance la synchro.`);
      } else if (res.failed > 0 || res.incomplete > 0) {
        const firstErr = res.errors[0];
        toast.warning(`${summary}${firstErr ? ` · ex: ${firstErr.id} — ${firstErr.message}` : ''}`);
      } else if (res.succeeded > 0) {
        toast.success(summary);
      } else {
        toast.info(summary);
      }
      if (res.succeeded > 0) onApplied();
    });
  };

  const selectClass = 'w-full border rounded px-2 py-1.5 text-sm bg-background';

  return (
    <div className="sticky bottom-4 z-20 mt-4 rounded-md border border-primary/40 bg-background px-4 py-3 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">
          {selectedIds.length} écriture{selectedIds.length > 1 ? 's' : ''} sélectionnée{selectedIds.length > 1 ? 's' : ''}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Désélectionner</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Unité</label>
          <select className={selectClass} value={unite} onChange={(e) => setUnite(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value={CLEAR}>— Vider —</option>
            {unites.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Catégorie (nature)</label>
          <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value={CLEAR}>— Vider —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Activité</label>
          <select className={selectClass} value={activite} onChange={(e) => setActivite(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value={CLEAR}>— Vider —</option>
            {activites.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Mode de paiement</label>
          <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value={CLEAR}>— Vider —</option>
            {modesPaiement.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Carte</label>
          <select className={selectClass} value={carte} onChange={(e) => setCarte(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value={CLEAR}>— Vider —</option>
            {cartes.map(c => (
              <option key={c.id} value={c.id}>
                {c.type === 'procurement' ? 'Procurement' : 'CB'} — {c.porteur}
                {c.code_externe ? ` (${c.code_externe})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Justificatif attendu</label>
          <select className={selectClass} value={justifAttendu} onChange={(e) => setJustifAttendu(e.target.value)} disabled={pending}>
            <option value={KEEP}>— Ne pas modifier —</option>
            <option value="1">Oui (justif requis)</option>
            <option value="0">Non (prélèvement auto / flux)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Préfixe description <span className="text-[10px]">(ajouté au début avec « — »)</span>
          </label>
          <Input
            value={descPrefix}
            onChange={(e) => setDescPrefix(e.target.value)}
            placeholder="ex : WE Pio 04/2026"
            className="h-[34px]"
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={apply} disabled={pending || !hasChange} size="sm">
          {pendingUpdate ? 'Application…' : `Appliquer à ${selectedIds.length} écriture${selectedIds.length > 1 ? 's' : ''}`}
        </Button>
        <Button onClick={sync} disabled={pending} size="sm" variant="secondary">
          {pendingSync ? 'Synchronisation…' : `Synchroniser ${selectedIds.length} vers Comptaweb`}
        </Button>
        <p className="text-xs text-muted-foreground ml-1">
          Les écritures déjà synchronisées sont ignorées. La synchro est séquentielle, compte ~2-3 s par ligne.
        </p>
      </div>
    </div>
  );
}
