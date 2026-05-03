import { sendMail } from './transport';

interface InvitationMailParams {
  to: string;
  invitedName: string | null;
  inviterName: string | null;
  groupName: string;
  role: string;
  appUrl: string;
}

const ROLE_LABELS: Record<string, string> = {
  tresorier: 'trésorier',
  RG: 'responsable de groupe',
  chef: "chef d'unité",
  equipier: 'équipier',
  parent: 'parent',
};

interface Action {
  label: string;
  description: string;
}

const ROLE_ACTIONS: Record<string, Action[]> = {
  tresorier: [
    {
      label: 'Tenir la compta du groupe',
      description: 'écritures, caisse, rapprochement bancaire avec Comptaweb.',
    },
    {
      label: 'Valider les demandes',
      description: 'remboursements, abandons de frais, dépôts de justifs.',
    },
    {
      label: 'Inviter le reste du groupe',
      description: 'co-trésorier, RG, chefs, équipiers, parents.',
    },
  ],
  RG: [
    {
      label: 'Valider les demandes après le trésorier',
      description: 'remboursements et abandons (double validation).',
    },
    {
      label: 'Suivre la trésorerie du groupe',
      description: 'vue agrégée par unité, alertes sur ce qui traîne.',
    },
  ],
  chef: [
    {
      label: 'Voir la compta de ton unité',
      description: 'budget, dépenses, recettes filtrées sur ton scope.',
    },
    {
      label: 'Faire une demande de remboursement',
      description: "quand tu as avancé des frais — c'est rapide.",
    },
    {
      label: 'Déposer un justif',
      description: 'pour que le trésorier rapproche avec une écriture.',
    },
  ],
  equipier: [
    {
      label: 'Faire une demande de remboursement',
      description: "quand tu as avancé des frais — c'est rapide.",
    },
    {
      label: 'Déclarer un abandon de frais',
      description: 'renoncer au remboursement contre un reçu fiscal.',
    },
    {
      label: 'Déposer un justif',
      description: 'pour que le trésorier rapproche avec une écriture.',
    },
  ],
  parent: [
    {
      label: 'Suivre tes paiements',
      description: 'inscriptions, camps, activités de tes enfants.',
    },
    {
      label: 'Consulter tes reçus fiscaux',
      description: 'CERFA pour tes dons au groupe.',
    },
  ],
};

function actionsFor(role: string): Action[] {
  return ROLE_ACTIONS[role] ?? ROLE_ACTIONS.equipier;
}

function buildText(params: InvitationMailParams): string {
  const { to, invitedName, inviterName, groupName, role, appUrl } = params;
  const greeting = invitedName ? `Bonjour ${invitedName},` : 'Bonjour,';
  const inviter = inviterName ? `${inviterName} t'a` : 'Tu as été';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const loginUrl = `${appUrl.replace(/\/$/, '')}/login`;
  const aideUrl = `${appUrl.replace(/\/$/, '')}/aide`;

  const actions = actionsFor(role)
    .map((a) => `  • ${a.label} — ${a.description}`)
    .join('\n');

  return [
    greeting,
    '',
    `${inviter} invité à rejoindre Baloo, l'outil de compta du groupe ${groupName}.`,
    '',
    `Ton rôle : ${roleLabel}.`,
    '',
    'Ce que tu pourras faire :',
    actions,
    '',
    'Pour activer ton compte :',
    loginUrl,
    '',
    `(Saisis ton email — ${to} — puis clique sur "Recevoir un lien". Un lien de connexion arrive par mail, tu cliques, et tu es connecté.)`,
    '',
    `Une page d'aide détaillée est dispo : ${aideUrl}`,
    '',
    'À bientôt sur Baloo.',
  ].join('\n');
}

function buildHtml(params: InvitationMailParams): string {
  const { to, invitedName, inviterName, groupName, role, appUrl } = params;
  const greeting = invitedName ? `Bonjour ${escapeHtml(invitedName)},` : 'Bonjour,';
  const inviter = inviterName
    ? `<strong>${escapeHtml(inviterName)}</strong> t'a invité`
    : 'Tu as été invité';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const loginUrl = `${appUrl.replace(/\/$/, '')}/login`;
  const aideUrl = `${appUrl.replace(/\/$/, '')}/aide`;

  // Tokens couleur — bleu marine SGDF + accents.
  const brand = '#1a3a6c';
  const brandLight = '#e8eef7';
  const fg = '#1a1f2e';
  const fgMuted = '#5b6577';
  const fgSubtle = '#8a93a6';
  const border = '#e4e7ec';
  const bgSunken = '#f6f7f9';

  const actions = actionsFor(role)
    .map(
      (a) => `
        <tr>
          <td style="padding: 6px 0; vertical-align: top; width: 22px;">
            <div style="width: 6px; height: 6px; border-radius: 999px; background: ${brand}; margin-top: 7px;"></div>
          </td>
          <td style="padding: 6px 0; vertical-align: top; color: ${fg}; font-size: 14px; line-height: 1.5;">
            <strong style="color: ${fg};">${escapeHtml(a.label)}</strong>
            <span style="color: ${fgMuted};"> — ${escapeHtml(a.description)}</span>
          </td>
        </tr>
      `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Invitation Baloo</title>
</head>
<body style="margin: 0; padding: 0; background: ${bgSunken}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${fg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${bgSunken};">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border: 1px solid ${border}; border-radius: 12px; overflow: hidden;">
          <!-- Bandeau brand SGDF -->
          <tr>
            <td style="background: ${brand}; padding: 20px 24px; color: #ffffff;">
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">
                Baloo
              </div>
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: rgba(255,255,255,0.7); margin-top: 2px;">
                Compta · ${escapeHtml(groupName)}
              </div>
            </td>
          </tr>

          <!-- Corps -->
          <tr>
            <td style="padding: 28px 24px 8px;">
              <p style="margin: 0 0 12px; font-size: 15px; color: ${fg};">${greeting}</p>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: ${fg};">
                ${inviter} à rejoindre <strong style="color: ${brand};">Baloo</strong>, l'outil
                de compta du groupe SGDF <strong>${escapeHtml(groupName)}</strong>.
              </p>
              <p style="margin: 0 0 18px; font-size: 13.5px; line-height: 1.55; color: ${fgMuted};">
                Ton rôle : <strong style="color: ${fg};">${escapeHtml(roleLabel)}</strong>.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding: 4px 24px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: ${brand}; border-radius: 8px;">
                    <a href="${loginUrl}" style="display: inline-block; padding: 12px 28px; color: #ffffff; font-size: 14.5px; font-weight: 600; text-decoration: none; letter-spacing: 0.005em;">
                      Activer mon compte →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 12px 0 0; font-size: 11.5px; color: ${fgSubtle}; line-height: 1.5;">
                Sur la page de connexion, saisis ton email (${escapeHtml(to)})<br>
                puis clique sur « Recevoir un lien ».
              </p>
            </td>
          </tr>

          <!-- Que faire -->
          <tr>
            <td style="padding: 16px 24px;">
              <div style="background: ${brandLight}; border: 1px solid ${border}; border-radius: 10px; padding: 16px 18px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: ${brand}; margin-bottom: 8px;">
                  Ce que tu pourras faire
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${actions}
                </table>
              </div>
            </td>
          </tr>

          <!-- Lien aide -->
          <tr>
            <td style="padding: 8px 24px 24px;">
              <p style="margin: 0; font-size: 12.5px; color: ${fgMuted}; line-height: 1.55;">
                Pas sûr de comment ça marche ? La
                <a href="${aideUrl}" style="color: ${brand}; font-weight: 600; text-decoration: none;">page d'aide</a>
                explique le fonctionnement étape par étape.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 16px 24px 20px; border-top: 1px solid ${border}; background: ${bgSunken};">
              <p style="margin: 0; font-size: 11px; color: ${fgSubtle}; line-height: 1.55;">
                Baloo est l'outil de comptabilité du groupe SGDF
                <strong>${escapeHtml(groupName)}</strong>. Si tu n'as rien demandé, tu peux
                ignorer ce mail.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendInvitationEmail(params: InvitationMailParams): Promise<void> {
  const { to, groupName } = params;
  const text = buildText(params);
  const html = buildHtml(params);

  await sendMail({
    to,
    subject: `Invitation à rejoindre Baloo (${groupName})`,
    text,
    html,
  });
}
