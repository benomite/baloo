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
  chef: 'chef d\'unité',
  equipier: 'équipier',
  parent: 'parent',
};

export async function sendInvitationEmail(params: InvitationMailParams): Promise<void> {
  const { to, invitedName, inviterName, groupName, role, appUrl } = params;
  const greeting = invitedName ? `Bonjour ${invitedName},` : 'Bonjour,';
  const inviter = inviterName ? `${inviterName} t'a` : 'Tu as été';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const loginUrl = `${appUrl.replace(/\/$/, '')}/login`;

  const text =
    `${greeting}\n\n` +
    `${inviter} invité à rejoindre Baloo, l'outil de compta du groupe ${groupName}.\n\n` +
    `Pour activer ton compte, va sur :\n${loginUrl}\n\n` +
    `Saisis ton email (${to}) puis clique sur "Recevoir un lien" — tu recevras un lien magique pour te connecter.\n\n` +
    `Ton rôle : ${roleLabel}.\n\n` +
    `À bientôt sur Baloo !`;

  await sendMail({
    to,
    subject: `Invitation à rejoindre Baloo (${groupName})`,
    text,
  });
}
