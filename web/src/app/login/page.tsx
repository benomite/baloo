import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { signIn, auth } from '@/lib/auth/auth';
import { getDb } from '@/lib/db';
import { logError } from '@/lib/log';
import { verifyLoginCode } from '@/lib/auth/login-codes';
import { createDbSession, buildSessionCookie } from '@/lib/auth/session-mint';
import { markUserConnected } from '@/lib/auth/invite-links';
import { LoginForm } from './login-form';
import { CodeForm } from './code-form';

export const metadata: Metadata = {
  title: 'Connexion',
  robots: { index: false, follow: false },
};

// Page de connexion (chantier 4, ADR-016). Magic link par email + code OTP
// à 6 chiffres dans le même mail. Le code est saisi DANS l'app : essentiel
// pour les PWA installées, où cliquer le lien ouvre un autre navigateur
// (conteneur de cookies isolé) et ne connecte jamais l'app. Cf. login-codes.ts.

interface SearchParams {
  error?: string;
  step?: string;
  email?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');
  const params = await searchParams;
  const errorMessage = params.error ? errorLabel(params.error) : null;
  const onCodeStep = params.step === 'code';
  const email = params.email ?? '';

  // Étape 1 : saisie de l'email → déclenche le mail (lien + code) via Auth.js,
  // puis bascule sur l'étape code en gardant l'email.
  async function requestCodeAction(formData: FormData) {
    'use server';
    const rawEmail = String(formData.get('email') ?? '').trim().toLowerCase();
    if (!rawEmail) redirect('/login');
    try {
      // redirect: false → on gère nous-mêmes la navigation (vers l'étape code).
      await signIn('email', { email: rawEmail, redirect: false });
    } catch (err) {
      // Une vraie redirection Auth.js doit remonter (ne pas l'avaler).
      if (isRedirectError(err)) throw err;
      // Sinon on logge mais on continue : ne rien révéler sur l'existence
      // de l'email (anti-énumération) — on affiche toujours l'étape code.
      logError('auth', 'signIn email (étape code) a échoué', err, { email: rawEmail });
    }
    redirect(`/login?step=code&email=${encodeURIComponent(rawEmail)}`);
  }

  // Étape 2 : saisie du code → vérification → session forgée dans CE contexte
  // (donc dans la PWA si on y est) + cookie posé.
  async function verifyCodeAction(formData: FormData) {
    'use server';
    const rawEmail = String(formData.get('email') ?? '').trim().toLowerCase();
    const code = String(formData.get('code') ?? '').trim();
    const back = (reason: string): never =>
      redirect(`/login?step=code&email=${encodeURIComponent(rawEmail)}&error=${reason}`);

    const result = await verifyLoginCode(getDb(), rawEmail, code);
    if (!result.ok) back(`code_${result.reason}`);

    const user = await getDb()
      .prepare("SELECT id FROM users WHERE lower(email) = ? AND statut = 'actif'")
      .get<{ id: string }>(rawEmail);
    if (!user) back('code_invalid');

    const { sessionToken, expires } = await createDbSession(getDb(), user!.id);
    await markUserConnected(getDb(), user!.id);

    const proto = (await headers()).get('x-forwarded-proto');
    const secure = proto === 'https';
    const cookie = buildSessionCookie(sessionToken, expires, secure);
    (await cookies()).set(cookie.name, cookie.value, cookie.options);

    redirect('/');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connexion à Baloo</CardTitle>
        </CardHeader>
        <CardContent>
          {onCodeStep ? (
            <CodeForm
              action={verifyCodeAction}
              resendAction={requestCodeAction}
              email={email}
              errorMessage={errorMessage}
            />
          ) : (
            <LoginForm action={requestCodeAction} errorMessage={errorMessage} />
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-fg-subtle">
        Tu découvres Baloo ?{' '}
        <Link href="/about" className="underline hover:text-fg-muted">
          À propos du projet
        </Link>
      </p>
    </div>
  );
}

// Détecte l'erreur spéciale lancée par `redirect()` pour ne pas l'avaler
// dans un catch (sinon la navigation est cassée silencieusement).
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'Accès refusé : email inconnu côté Baloo.';
    case 'Verification':
      return 'Lien de connexion invalide ou expiré. Demande un nouveau lien.';
    case 'InviteExpired':
      return "Ce lien d'accès direct a expiré ou n'est plus valide. Demande-en un nouveau au trésorier.";
    case 'InviteError':
      return "Impossible d'ouvrir ce lien d'accès direct. Réessaie ou demande un nouveau lien au trésorier.";
    case 'code_invalid':
      return 'Code incorrect. Vérifie les 6 chiffres reçus par mail.';
    case 'code_expired':
      return 'Ce code a expiré. Demande un nouveau code.';
    case 'code_too_many_attempts':
      return 'Trop de tentatives. Demande un nouveau code.';
    default:
      return `Erreur d'authentification (${code}).`;
  }
}
