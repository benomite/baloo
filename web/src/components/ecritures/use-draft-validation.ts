'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';

// Orchestration de la validation d'un draft (matérialisation Comptaweb, lente
// + irréversible). UX optimiste : on verrouille la ligne dès le clic
// (`validatingIds`), puis au succès on laisse le parent la retirer de la liste
// (`onValidated`) — elle est bouclée, plus rien à faire. À l'échec on
// déverrouille et on signale ; la ligne reste éditable.
export function useDraftValidation(onValidated: (id: string) => void) {
  const [validatingIds, setValidatingIds] = useState<Set<string>>(new Set());

  const validate = useCallback(
    async (id: string) => {
      setValidatingIds((prev) => new Set(prev).add(id));
      try {
        const res = await syncDraftToComptaweb(id, { dryRun: false });
        if (res.ok) {
          onValidated(id);
          return;
        }
        toast.error(res.message);
      } catch {
        toast.error('La validation a échoué (Comptaweb injoignable ?). Réessaie.');
      } finally {
        setValidatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [onValidated],
  );

  return { validatingIds, validate };
}
