import NextAuth from 'next-auth';
import type { EmailConfig } from 'next-auth/providers/email';
import { SqliteAdapter } from './adapter';
import { logError, logWarn } from '../log';
import { recordSigninAttempt } from './rate-limit';
import { getDb } from '../db';
import { createLoginCode } from './login-codes';

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

  // Auth.js v5 (Nodemailer provider) refuse de démarrer si `server` est
  // vide. En dev (pas de SMTP), on passe un dummy — l'override
  // `sendVerificationRequest` ci-dessous court-circuite l'envoi réel et
  // logge le lien sur stderr à la place.
  const serverConfig = smtp || 'smtp://localhost:25';

  return {
    id: 'email',
    type: 'email',
    name: 'Email',
    from,
    server: serverConfig,
    // 30 min : assez court pour qu'un lien intercepté ne soit pas
    // exploitable longtemps, assez long pour gérer le délai SMTP +
    // anti-spam + clic différé.
    maxAge: 60 * 30,
    options: {},
    async sendVerificationRequest({ identifier, url, provider }) {
      // Rate limit silencieux : on n'envoie pas le mail au-delà des
      // bornes (cf. rate-limit.ts) mais on ne signale rien au client
      // — pour éviter d'aider une énumération.
      const { allowed } = await recordSigninAttempt(identifier);
      if (!allowed) {
        logWarn('auth', 'Magic link bloqué (rate limit)', undefined, { identifier });
        return;
      }

      // Code OTP à 6 chiffres, dans le MÊME mail que le lien. Sur une PWA
      // installée, le lien s'ouvre dans un autre navigateur (conteneur de
      // cookies isolé) → l'utilisateur saisit plutôt ce code dans l'app
      // pour que la session se pose dans le bon conteneur. Cf.
      // login-codes.ts + page /login (étape code).
      const { code } = await createLoginCode(getDb(), identifier);

      if (smtp) {
        const { createTransport } = await import('nodemailer');
        // Timeouts courts pour éviter qu'une serverless function Vercel
        // attende 2 min sur un retry SMTP. Resend répond en <1s en
        // général ; 10s suffisent largement.
        const transport = createTransport(smtp, {
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
        });
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: 'Connexion à Baloo',
          text:
            `Bonjour,\n\n` +
            `Pour te connecter à Baloo, tu as deux possibilités :\n\n` +
            `1) Saisis ce code dans l'application :\n\n` +
            `   ${code}\n\n` +
            `   (À utiliser si tu es sur l'app installée sur ton téléphone.)\n\n` +
            `2) Ou clique sur ce lien (pratique sur ordinateur) :\n${url}\n\n` +
            `Code et lien expirent dans 30 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
        });
        return;
      }
      // Fallback dev : pas de SMTP configuré → log du lien ET du code dans
      // la sortie serveur. Le trésorier peut copier-coller l'un ou l'autre.
      logError(
        'auth',
        `Connexion Baloo en mode console (EMAIL_SERVER non défini) pour ${identifier} :\n  code = ${code}\n  lien = ${url}`,
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
