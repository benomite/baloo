'use client';

import { useState } from 'react';
import { Mail, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { PendingButton } from '@/components/shared/pending-button';
import { sendRelance } from '@/lib/actions/relances';

// Relance par email pour un justificatif manquant. Extrait de l'ancienne page
// détail (`RelanceCard`) → réutilisable dans le panneau. Repliable, admin only
// (le parent ne le rend que pour les rôles admin). `defaultOpen` pour l'ouvrir
// directement au besoin.

export function PanelRelance({
  ecritureId,
  defaultOpen = false,
}: {
  ecritureId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-fg-muted hover:text-fg"
        aria-expanded={open}
      >
        <Mail size={13} strokeWidth={2} />
        Relancer pour le justif
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <form action={sendRelance} className="space-y-2 px-2.5 pb-2.5">
          <input type="hidden" name="ecriture_id" value={ecritureId} />
          <Field label="Destinataire" htmlFor={`relance-to-${ecritureId}`} required>
            <Input id={`relance-to-${ecritureId}`} name="destinataire" type="email" required placeholder="prenom@example.fr" />
          </Field>
          <Field label="Message" htmlFor={`relance-msg-${ecritureId}`} hint="optionnel">
            <Textarea id={`relance-msg-${ecritureId}`} name="message" rows={2} placeholder="Ex. Peux-tu me transmettre la facture stp ?" />
          </Field>
          <div className="flex justify-end">
            <PendingButton size="sm" pendingLabel="Envoi…">
              <Mail size={13} strokeWidth={2} className="mr-1.5" />
              Envoyer
            </PendingButton>
          </div>
        </form>
      )}
    </div>
  );
}
