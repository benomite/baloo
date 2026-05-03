'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

// Error boundary pour les pages app authentifiées. Sans ça, Next/Vercel
// affiche le générique "This page couldn't load. A server error
// occurred." sans le moindre détail. Avec ça :
//   - le user voit l'erreur exacte et un bouton retry
//   - le digest Next est affiché (utile pour relier aux logs Vercel)
//   - on peut copier-coller le message pour debug
//
// Composant client obligatoire (Next n'autorise que les error.tsx
// client). Donc pas d'écriture BDD ici (logError serveur) — la stack
// arrive en console côté Vercel.

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app/error.tsx]', error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-6">
        <div className="flex items-start gap-3 mb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle size={18} strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-[16px] font-semibold text-red-900 dark:text-red-100">
              Une erreur est survenue
            </h1>
            <p className="mt-1 text-[13px] text-red-800 dark:text-red-200/80">
              La page n&apos;a pas pu charger. Tu peux réessayer ou recharger l&apos;app.
            </p>
          </div>
        </div>

        <div className="rounded-md bg-white/60 dark:bg-black/30 border border-red-200 dark:border-red-900/40 p-3 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700 dark:text-red-300 mb-1">
            Détail technique
          </div>
          <pre className="text-[12px] font-mono text-red-900 dark:text-red-100 whitespace-pre-wrap break-words leading-relaxed">
            {error.message || '(message vide)'}
          </pre>
          {error.digest && (
            <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">
              digest&nbsp;: <code className="font-mono">{error.digest}</code>
            </div>
          )}
        </div>

        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-700 transition-colors"
        >
          <RotateCw size={13} strokeWidth={2} />
          Réessayer
        </button>
      </div>
    </div>
  );
}
