import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn } from '@/lib/auth/auth';
import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';

// Page de connexion (chantier 4, ADR-014). Magic link par email — l'user
// reçoit un lien dans sa boîte (ou en console en dev) puis clique pour
// activer sa session.

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect('/');
  const params = await searchParams;
  const errorMessage = params.error ? errorLabel(params.error) : null;

  async function loginAction(formData: FormData) {
    'use server';
    await signIn('email', formData);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connexion à Baloo</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={loginAction} className="space-y-4">
            <div>
              <label htmlFor="email" className="text-sm text-muted-foreground">
                Email
              </label>
              <Input id="email" name="email" type="email" placeholder="ton@email.fr" required />
            </div>
            <Button type="submit" className="w-full">
              Recevoir un lien de connexion
            </Button>
            {errorMessage ? (
              <p className="text-sm text-red-600">{errorMessage}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ton email doit déjà être enregistré côté trésorier — sinon demande qu&apos;on
                t&apos;invite. En dev, le lien est loggé sur la sortie du serveur Next.js.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'Accès refusé : email inconnu côté Baloo.';
    case 'Verification':
      return 'Lien de connexion invalide ou expiré. Demande un nouveau lien.';
    default:
      return `Erreur d'authentification (${code}).`;
  }
}
