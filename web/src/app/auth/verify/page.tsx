import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Vérifie ta boîte mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Si l&apos;email est connu côté Baloo, tu vas recevoir un lien de connexion.</p>
          <p>
            Le lien expire dans 24 heures. Si tu ne le reçois pas, vérifie tes spams ou
            recommence.
          </p>
          <p className="text-xs">
            En dev : le lien est loggé sur la sortie du serveur Next.js (pas envoyé par email tant
            qu&apos;<code>EMAIL_SERVER</code> n&apos;est pas configuré).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
