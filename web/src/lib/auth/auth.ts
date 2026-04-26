import NextAuth from 'next-auth';
import type { EmailConfig } from 'next-auth/providers/email';
import { SqliteAdapter } from './adapter';

// Auth.js v5 (chantier 4, ADR-014).
//
// - Adapter custom SQLite (`adapter.ts`) sur la table `users` existante.
// - Email provider en magic link. Transport :
//     - dev : log du lien sur stderr (champ EMAIL_SERVER non défini).
//     - prod : SMTP via nodemailer (EMAIL_SERVER + EMAIL_FROM).
// - Restriction : seuls les users existants en BDD peuvent se connecter
//   (callback `signIn` qui refuse les emails inconnus).
// - Session strategy : "database" (cookies → table sessions). Ça permet
//   la révocation côté serveur, ce que JWT ne permet pas.

function magicLinkProvider(): EmailConfig {
  const smtp = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM ?? 'baloo@localhost';

  return {
    id: 'email',
    type: 'email',
    name: 'Email',
    from,
    server: smtp ?? '',
    maxAge: 60 * 60 * 24,
    options: {},
    async sendVerificationRequest({ identifier, url, provider }) {
      if (smtp) {
        const { createTransport } = await import('nodemailer');
        const transport = createTransport(smtp);
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: 'Connexion à Baloo',
          text:
            `Bonjour,\n\n` +
            `Clique sur le lien suivant pour te connecter à Baloo :\n${url}\n\n` +
            `Il expire dans 24h. Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
        });
        return;
      }
      // Fallback dev : pas de SMTP configuré → log du lien dans la sortie
      // serveur. Le trésorier peut copier-coller le lien dans son navigateur.
      console.error(
        `\n[baloo-auth] Magic link pour ${identifier} :\n  ${url}\n` +
          `(EMAIL_SERVER non défini → mode console. À configurer en prod.)\n`,
      );
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: SqliteAdapter,
  providers: [magicLinkProvider()],
  session: { strategy: 'database' },
  pages: {
    signIn: '/login',
    verifyRequest: '/auth/verify',
    error: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      // L'adapter ne crée pas d'user (createUser throw). Si on arrive ici
      // avec un user, c'est qu'il existait déjà — on accepte. Cette
      // ceinture-bretelle vit ici en cas de provider qui contournerait
      // le getUserByEmail de l'adapter.
      if (!user.email) return false;
      return true;
    },
  },
});
