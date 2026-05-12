import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { findClientByClientId, validateRedirectUri } from '@/lib/services/oauth-clients';
import { authorizeAction, denyAction } from './actions';

export const dynamic = 'force-dynamic';

interface SearchParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  if (params.response_type !== 'code') {
    return <ErrorBlock message="response_type doit être 'code'." />;
  }
  if (!params.client_id) return <ErrorBlock message="client_id manquant." />;
  if (!params.redirect_uri) return <ErrorBlock message="redirect_uri manquant." />;
  if (!params.code_challenge) return <ErrorBlock message="code_challenge manquant (PKCE requis)." />;
  if (params.code_challenge_method !== 'S256') {
    return <ErrorBlock message="code_challenge_method doit être S256." />;
  }
  const scope = params.scope ?? 'treso';
  if (scope !== 'treso') return <ErrorBlock message={`scope inconnu : ${scope}.`} />;

  await ensureBusinessSchema();
  const client = await findClientByClientId(params.client_id);
  if (!client) return <ErrorBlock message="Client OAuth inconnu." />;
  if (!validateRedirectUri(client, params.redirect_uri)) {
    return <ErrorBlock message="redirect_uri non autorisé pour ce client." />;
  }

  const session = await auth();
  if (!session?.user?.id) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    const callbackUrl = `/oauth/authorize?${qs}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold mb-2">Autoriser {client.client_name}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Cette application demande l&apos;accès à ton compte Baloo (
        <strong>{session.user.email}</strong>).
      </p>

      <div className="rounded border p-4 mb-6">
        <p className="font-medium mb-2">Permissions demandées :</p>
        <ul className="text-sm list-disc pl-5">
          <li>Trésorerie complète (lecture et écriture, selon ton rôle)</li>
        </ul>
      </div>

      <form action={authorizeAction} className="flex gap-2">
        <input type="hidden" name="client_id" value={params.client_id} />
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="state" value={params.state ?? ''} />
        <input type="hidden" name="code_challenge" value={params.code_challenge} />
        <input type="hidden" name="code_challenge_method" value={params.code_challenge_method} />
        <button type="submit" className="rounded bg-primary text-primary-foreground px-4 py-2">
          Autoriser
        </button>
      </form>
      <form action={denyAction} className="mt-3">
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        <input type="hidden" name="state" value={params.state ?? ''} />
        <button type="submit" className="rounded border px-4 py-2 text-muted-foreground">
          Refuser
        </button>
      </form>
    </main>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold mb-2 text-destructive">Erreur OAuth</h1>
      <p>{message}</p>
    </main>
  );
}
