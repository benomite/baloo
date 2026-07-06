'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';
import { Alert } from '@/components/ui/alert';
import type { CreateInvitationState } from '@/lib/actions/invitations';

interface UniteOption {
  id: string;
  code: string;
  name: string;
}

interface RoleOption {
  value: string;
  label: string;
}

interface Props {
  action: (
    prevState: CreateInvitationState,
    formData: FormData,
  ) => Promise<CreateInvitationState>;
  unites: UniteOption[];
  roles: RoleOption[];
}

const INITIAL: CreateInvitationState = { ok: false };

export function InvitationForm({ action, unites, roles }: Props) {
  const [role, setRole] = useState(roles[0]?.value ?? 'membre');
  const [state, formAction] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const needsUnit = role === 'chef';

  async function copyLink() {
    if (!state.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(state.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponible : le lien reste sélectionnable manuellement */
    }
  }

  return (
    <div className="space-y-4">
      {state.error && <Alert variant="error">{state.error}</Alert>}

      {state.ok && state.inviteUrl && (
        <Alert variant="success">
          <div className="space-y-2">
            <div>
              {state.reused ? 'Compte déjà existant' : 'Compte créé'} pour{' '}
              <b>{state.email}</b>
              {state.emailSent
                ? ' — mail envoyé avec le lien.'
                : " — mail non envoyé (cf. logs), copie le lien ci-dessous."}
            </div>
            <div className="text-[12px] font-medium text-fg-muted">
              Lien d&apos;accès direct (valable 7 jours) — à coller dans WhatsApp :
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={state.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="text-[12px]"
              />
              <Button type="button" variant="secondary" size="sm" onClick={copyLink}>
                {copied ? (
                  <Check size={14} strokeWidth={2} className="mr-1.5" />
                ) : (
                  <Copy size={14} strokeWidth={2} className="mr-1.5" />
                )}
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <form action={formAction} className="space-y-4">
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="prenom.nom@example.fr"
          />
        </Field>
        <Field label="Nom affiché" htmlFor="nom_affichage" hint="optionnel">
          <Input id="nom_affichage" name="nom_affichage" placeholder="Prénom Nom" />
        </Field>
        <Field label="Rôle" htmlFor="role" required>
          <NativeSelect
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {needsUnit && (
          <Field label="Unités du chef" hint="il ne voit/gère que ces unités — coche-en une ou plusieurs">
            <div className="grid grid-cols-2 gap-1.5">
              {unites.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] cursor-pointer hover:border-brand"
                >
                  <input type="checkbox" name="scope_unite_ids" value={u.id} className="h-4 w-4 rounded border-border-strong text-brand" />
                  <span>{u.code} — {u.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="flex justify-end pt-1">
          <PendingButton pendingLabel="Création…">
            <Send size={14} strokeWidth={2} className="mr-1.5" />
            Créer et générer le lien
          </PendingButton>
        </div>
      </form>
    </div>
  );
}
