'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required placeholder="prenom.nom@example.fr" />
      </div>
      <div>
        <Label htmlFor="nom_affichage">Nom affiché (optionnel)</Label>
        <Input id="nom_affichage" name="nom_affichage" placeholder="Prénom Nom" />
      </div>
      <div>
        <Label htmlFor="role">Rôle</Label>
        <select
          id="role"
          name="role"
          required
          className="w-full border rounded px-3 py-2 bg-background"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      {needsUnit && (
        <div>
          <Label htmlFor="scope_unite_id">Unité</Label>
          <select
            id="scope_unite_id"
            name="scope_unite_id"
            required
            className="w-full border rounded px-3 py-2 bg-background"
            defaultValue=""
          >
            <option value="" disabled>— Choisir une unité —</option>
            {unites.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </div>
      )}
      <Button type="submit">Envoyer l&apos;invitation</Button>
    </form>
  );
}
