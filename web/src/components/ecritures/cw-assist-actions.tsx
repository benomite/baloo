'use client';

// Composant "interface Comptaweb assistée" — Task 8 du pivot miroir
// strict + MCP-first.
//
// Doctrine (cf. doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md
// section "Le pattern interface Comptaweb assistée") : Baloo n'écrit
// JAMAIS en local sans passer par Comptaweb d'abord. Pour préparer une
// saisie, on offre 3 chemins :
//
//   1. "Faire dans Comptaweb pour moi" — appelle le backend qui pilote
//      CW via scraping. La page parent fournit `onSubmitToCw`. Si le
//      backend ne sait pas faire (ex. mappings manquants), ce bouton
//      affiche le message d'erreur retourné par le 502.
//   2. "Ouvrir Comptaweb pré-rempli" — deep-link CW (target=_blank).
//      Affiché UNIQUEMENT si `deepLinkUrl` fourni — pas de deep-link
//      par défaut tant qu'on n'a pas confirmé une URL fiable côté CW.
//   3. "Tout copier" — copy un texte formaté lisible dans le clipboard,
//      l'utilisateur colle dans CW manuellement. Toujours dispo,
//      fallback ultime.
//
// Le formulaire parent (`/ecritures/nouveau`, `/ecritures/[id]`, …) construit
// le payload courant et le passe à ce composant. À chaque clic sur un
// bouton, le composant lit `payload` à l'instant T.

import { useState } from 'react';
import { Send, Copy, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CwAssistPayload {
  date_ecriture: string;
  amount_cents: number;
  description: string;
  type: 'depense' | 'recette';
  category_id?: string | null;
  mode_paiement_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  carte_id?: string | null;
  numero_piece?: string | null;
  notes?: string | null;
  justif_attendu?: boolean;
}

export interface CwAssistSubmitOk {
  ok: true;
  /** ID Baloo de l'écriture créée. Le caller peut router vers /ecritures/[id]. */
  ecriture_id?: string;
}

export interface CwAssistSubmitFail {
  ok: false;
  error: string;
  /** ID Baloo de l'écriture rétrogradée en draft (HTTP 502). */
  ecriture_id?: string;
  fallback_status?: 'draft';
}

export type CwAssistSubmitResult = CwAssistSubmitOk | CwAssistSubmitFail;

export interface CwAssistActionsProps {
  payload: CwAssistPayload;
  /** Si fourni, affiche le bouton "Ouvrir Comptaweb pré-rempli". Sinon, caché. */
  deepLinkUrl?: string;
  /**
   * Si fourni, affiche le bouton "Faire dans Comptaweb pour moi" — qui
   * appelle ce handler. Le handler doit retourner un `CwAssistSubmitResult`
   * (pas throw : on veut afficher une erreur typée). Si non fourni, le
   * bouton n'apparaît pas (mode dégradé pour la page d'édition sans CW write).
   */
  onSubmitToCw?: (payload: CwAssistPayload) => Promise<CwAssistSubmitResult>;
  /** Override du format clipboard. Par défaut, un texte multi-lignes lisible. */
  formatForClipboard?: (payload: CwAssistPayload) => string;
  /**
   * Optionnel : appelé après succès du submit (toast côté parent, redirection,
   * reset du form). Le composant n'appelle PAS de router lui-même.
   */
  onSuccess?: (result: CwAssistSubmitOk) => void;
  /** Optionnel : appelé après échec (gestion d'erreur côté parent). */
  onError?: (result: CwAssistSubmitFail) => void;
  className?: string;
}

const FR_DATE = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const FR_AMOUNT = (cents: number): string =>
  (cents / 100).toFixed(2).replace('.', ',');

const defaultFormatForClipboard = (p: CwAssistPayload): string => {
  const lines = [
    `Type        : ${p.type === 'depense' ? 'Dépense' : 'Recette'}`,
    `Date        : ${FR_DATE(p.date_ecriture)}`,
    `Montant     : ${FR_AMOUNT(p.amount_cents)} €`,
    `Libellé     : ${p.description}`,
  ];
  if (p.numero_piece) lines.push(`N° pièce    : ${p.numero_piece}`);
  if (p.notes) lines.push(`Notes       : ${p.notes}`);
  return lines.join('\n');
};

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

type CopyState = 'idle' | 'copied' | 'error';

export function CwAssistActions({
  payload,
  deepLinkUrl,
  onSubmitToCw,
  formatForClipboard,
  onSuccess,
  onError,
  className,
}: CwAssistActionsProps) {
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const formatter = formatForClipboard ?? defaultFormatForClipboard;

  const handleSubmit = async () => {
    if (!onSubmitToCw) return;
    setSubmitState({ kind: 'pending' });
    try {
      const result = await onSubmitToCw(payload);
      if (result.ok) {
        setSubmitState({ kind: 'success' });
        onSuccess?.(result);
      } else {
        setSubmitState({ kind: 'error', message: result.error });
        onError?.(result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmitState({ kind: 'error', message });
      onError?.({ ok: false, error: message });
    }
  };

  const handleCopy = async () => {
    const text = formatter(payload);
    try {
      // navigator.clipboard est dispo dans tous les navigateurs modernes
      // sur HTTPS et localhost. On ne fallback pas sur document.execCommand
      // (deprecated, et le user est tjr sur HTTPS / localhost via PWA).
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 3000);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {onSubmitToCw && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitState.kind === 'pending'}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all',
              'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:pointer-events-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            )}
            data-testid="cw-assist-submit"
          >
            <Send size={14} strokeWidth={2.25} />
            {submitState.kind === 'pending'
              ? 'Envoi à Comptaweb…'
              : 'Faire dans Comptaweb pour moi'}
          </button>
        )}

        {deepLinkUrl && (
          <a
            href={deepLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-all',
              'border-border bg-background hover:bg-muted',
            )}
            data-testid="cw-assist-deeplink"
          >
            <ExternalLink size={14} strokeWidth={2.25} />
            Ouvrir Comptaweb pré-rempli
          </a>
        )}

        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-all',
            'border-border bg-background hover:bg-muted',
          )}
          data-testid="cw-assist-copy"
        >
          {copyState === 'copied' ? (
            <>
              <CheckCircle2 size={14} strokeWidth={2.25} className="text-emerald-600" />
              <span data-testid="cw-assist-copy-feedback">Copié</span>
            </>
          ) : (
            <>
              <Copy size={14} strokeWidth={2.25} />
              Tout copier
            </>
          )}
        </button>
      </div>

      {submitState.kind === 'success' && (
        <div
          className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
          role="status"
          data-testid="cw-assist-success"
        >
          <CheckCircle2 size={14} strokeWidth={2.25} className="mt-0.5 shrink-0" />
          <span>Envoyée à Comptaweb. Sera visible dans Baloo après la prochaine sync.</span>
        </div>
      )}

      {submitState.kind === 'error' && (
        <div
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100"
          role="alert"
          data-testid="cw-assist-error"
        >
          <AlertCircle size={14} strokeWidth={2.25} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Échec de l&apos;envoi à Comptaweb.</p>
            <p className="text-[12.5px] opacity-90 mt-0.5">{submitState.message}</p>
            <p className="text-[12px] opacity-80 mt-1">
              L&apos;écriture est restée en brouillon — tu peux la retrouver dans /inbox,
              ou utiliser « Tout copier » pour saisir manuellement dans Comptaweb.
            </p>
          </div>
        </div>
      )}

      {copyState === 'error' && (
        <div
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900"
          role="alert"
        >
          <AlertCircle size={14} strokeWidth={2.25} className="mt-0.5 shrink-0" />
          <span>Impossible d&apos;accéder au presse-papiers. Sélectionne et copie à la main.</span>
        </div>
      )}
    </div>
  );
}
