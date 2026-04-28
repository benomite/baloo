import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { signIn } from '@/lib/auth/auth';
import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';

// Page de connexion (chantier 4, ADR-016). Magic link par email — l'user
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
          <LoginForm action={loginAction} errorMessage={errorMessage} />
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
