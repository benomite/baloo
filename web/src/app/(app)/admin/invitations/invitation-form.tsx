'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';

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
  action: (formData: FormData) => Promise<void>;
  unites: UniteOption[];
  roles: RoleOption[];
}

export function InvitationForm({ action, unites, roles }: Props) {
  const [role, setRole] = useState(roles[0]?.value ?? 'equipier');
  const needsUnit = role === 'chef';

  return (
    <form action={action} className="space-y-4">
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
        <Field label="Unité" htmlFor="scope_unite_id" required hint="le chef d'unité ne voit que son unité">
          <NativeSelect id="scope_unite_id" name="scope_unite_id" required defaultValue="">
            <option value="" disabled>
              — Choisir une unité —
            </option>
            {unites.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <div className="flex justify-end pt-1">
        <PendingButton pendingLabel="Envoi…">
          <Send size={14} strokeWidth={2} className="mr-1.5" />
          Envoyer l&apos;invitation
        </PendingButton>
      </div>
    </form>
  );
}
