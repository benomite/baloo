import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';
import { listActiveTokensForUser } from '@/lib/services/oauth-access-tokens';
import { revokeAction } from './actions';

export const dynamic = 'force-dynamic';

function getMcpUrl(): string {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base}/api/mcp`;
}

export default async function ConnexionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/moi/connexions');

  const tokens = await listActiveTokensForUser(session.user.id);
  const mcpUrl = getMcpUrl();

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Connexions externes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Apps autorisées à accéder à ton compte via OAuth (notamment Claude Desktop).
        </p>
      </header>

      <section className="rounded border p-4 space-y-2">
        <h2 className="font-medium">Connecter Claude Desktop</h2>
        <p className="text-sm">
          Dans Claude Desktop : Settings → Connectors → Add custom connector → colle
          l&apos;URL ci-dessous. Tu seras renvoyé sur Baloo pour confirmer l&apos;autorisation.
        </p>
        <code className="block bg-muted p-2 rounded font-mono text-sm select-all">{mcpUrl}</code>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Apps autorisées</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune app autorisée. Quand tu en connectes une, elle apparaîtra ici.
          </p>
        ) : (
          <ul className="divide-y border rounded">
            {tokens.map((t) => (
              <li key={t.token_hash} className="p-3 flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{t.client_name}</div>
                  <div className="text-muted-foreground">
                    Connectée le {new Date(t.created_at).toLocaleDateString('fr-FR')} ·{' '}
                    Expire le {new Date(t.expires_at).toLocaleDateString('fr-FR')} ·{' '}
                    {t.last_used_at
                      ? `Utilisée le ${new Date(t.last_used_at).toLocaleDateString('fr-FR')}`
                      : 'Jamais utilisée'}
                  </div>
                </div>
                <form action={revokeAction}>
                  <input type="hidden" name="token_hash" value={t.token_hash} />
                  <button
                    type="submit"
                    className="text-sm text-destructive hover:underline"
                  >
                    Révoquer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
