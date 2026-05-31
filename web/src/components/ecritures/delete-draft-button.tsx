'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteDraft } from '@/lib/actions/ecritures';

// Suppression d'un brouillon local. Visible uniquement sur les écritures
// status='draft' (jamais envoyées à Comptaweb). Confirmation obligatoire :
// l'action est définitive (cf. règle no-DELETE — c'est l'exception assumée).
export function DeleteDraftButton({ ecritureId }: { ecritureId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function confirmAndDelete() {
    if (!window.confirm('Supprimer définitivement ce brouillon ? Réservé aux brouillons locaux jamais envoyés à Comptaweb.')) return;
    const res = await deleteDraft(ecritureId);
    if (res.ok) {
      toast.success('Brouillon supprimé.');
      router.push('/ecritures');
      router.refresh();
    } else {
      toast.error(res.message ?? 'Suppression impossible.');
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-red-600 hover:text-red-700 dark:text-red-400"
      onClick={() => startTransition(async () => { await confirmAndDelete(); })}
    >
      <Trash2 size={14} strokeWidth={2} className="mr-1.5" />
      Supprimer le brouillon
    </Button>
  );
}
