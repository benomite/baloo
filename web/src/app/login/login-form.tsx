'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginForm({ action, errorMessage }: { action: (formData: FormData) => Promise<void>; errorMessage: string | null }) {
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="text-sm text-muted-foreground">
          Email
        </label>
        <Input id="email" name="email" type="email" placeholder="ton@email.fr" required />
      </div>
      <SubmitButton />
      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ton email doit déjà être enregistré côté trésorier — sinon demande qu&apos;on
          t&apos;invite. L&apos;envoi de l&apos;email peut prendre 10-20 secondes.
        </p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Envoi en cours…' : 'Recevoir un lien de connexion'}
    </Button>
  );
}
