import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';
import { listActiveTokensForUser } from '@/lib/services/oauth-access-tokens';
import { issuerUrlFromHeaders } from '@/lib/oauth/issuer';
import { revokeAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ConnexionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/moi/connexions');

  const tokens = await listActiveTokensForUser(session.user.id);
  const mcpUrl = `${await issuerUrlFromHeaders()}/api/mcp`;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">🤖 Pilote ta compta depuis Claude</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connecte Baloo à Claude (web ou Desktop) pour piloter ta trésorerie en langage naturel —
          par exemple : « quelles écritures manquent un justif ? », « lance une sync »,
          « crée la dépense de 42 € carte BNP ».
        </p>
      </header>

      <section className="rounded border border-amber-300 bg-amber-50 p-4 space-y-1 dark:border-amber-700 dark:bg-amber-950">
        <h2 className="font-medium">Prérequis</h2>
        <p className="text-sm">
          Un compte Claude qui autorise les connecteurs personnalisés (Pro, Max ou Team).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">Installation en 4 étapes</h2>
        <ol className="space-y-4">
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
              1
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">Copier l&apos;URL du connecteur Baloo</p>
              <code className="block bg-muted p-2 rounded font-mono text-sm select-all">
                {mcpUrl}
              </code>
            </div>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
              2
            </span>
            <div>
              <p className="text-sm">
                Dans Claude (web ou Desktop) : <strong>Réglages → Connecteurs → Ajouter un
                connecteur personnalisé</strong>. Coller l&apos;URL.
              </p>
            </div>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
              3
            </span>
            <div>
              <p className="text-sm">
                Claude te renvoie sur Baloo → autorise l&apos;accès (login OAuth).
              </p>
            </div>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
              4
            </span>
            <div>
              <p className="text-sm">
                Teste : tape « Montre-moi la vue d&apos;ensemble de la trésorerie ». ✅
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Que demander à Claude</h2>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
          <li>« Quelles écritures n&apos;ont pas encore de justificatif ? »</li>
          <li>« Lance une synchronisation avec Comptaweb. »</li>
          <li>« Montre-moi les remboursements en attente. »</li>
          <li>« Crée une dépense de 42,50 € carte BNP pour les achats du week-end. »</li>
        </ul>
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
