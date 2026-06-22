'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Étape 2 de la connexion : saisie du code à 6 chiffres reçu par mail.
// La session est forgée côté serveur dans CE contexte navigateur — donc
// dans la PWA installée si on y est, contrairement au clic sur le lien.
export function CodeForm({
  action,
  resendAction,
  email,
  errorMessage,
}: {
  action: (formData: FormData) => Promise<void>;
  resendAction: (formData: FormData) => Promise<void>;
  email: string;
  errorMessage: string | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        On a envoyé un mail à <span className="font-medium text-fg">{email || 'ton adresse'}</span>.
        Entre le code à 6 chiffres ci-dessous — c&apos;est la méthode à utiliser
        depuis l&apos;application installée sur ton téléphone.
      </p>

      <form action={action} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <div>
          <label htmlFor="code" className="text-sm text-muted-foreground">
            Code reçu par mail
          </label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            required
            autoFocus
            className="tracking-[0.4em] text-center text-lg tabular-nums"
          />
        </div>
        <SubmitButton />
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      </form>

      <div className="text-xs text-muted-foreground space-y-2">
        <p>
          Tu peux aussi cliquer sur le lien du mail (pratique sur ordinateur) — mais
          sur mobile, préfère le code.
        </p>
        <form action={resendAction}>
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="underline hover:text-fg-muted">
            Renvoyer un code
          </button>
        </form>
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Connexion…' : 'Me connecter'}
    </Button>
  );
}
