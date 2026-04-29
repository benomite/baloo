// Helper d'envoi d'email (chantier 0.2, ADR-020).
//
// Réutilise le même mécanisme que `auth.ts` (magic link Auth.js) pour
// rester cohérent : SMTP via nodemailer en prod (EMAIL_SERVER configuré),
// fallback console en dev.

interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail({ to, subject, text, html }: SendMailParams): Promise<void> {
  const smtp = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM ?? 'baloo@localhost';

  if (smtp) {
    const { createTransport } = await import('nodemailer');
    const transport = createTransport(smtp, {
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({ to, from, subject, text, html });
    return;
  }

  // Dev : log sur stderr (cohérent avec auth.ts).
  console.error(
    `\n[baloo-email] Email pour ${to} (sujet: "${subject}") :\n${text}\n` +
      `(EMAIL_SERVER non défini → mode console.)\n`,
  );
}
