import { sendMail } from './transport';
import { formatAmount } from '../format';

// Adresse fixe SGDF pour l'envoi des abandons de frais. Toute demande
// validée doit être envoyée ici avec la feuille signée + justifs en
// pièce jointe pour que le national émette les CERFA. Confirmé par le
// trésorier (le mail n'est pas dans la doc sgdf-core publique).
export const SGDF_DONATEURS_EMAIL = 'donateurs@sgdf.fr';

interface AbandonCreatedParams {
  to: string[];
  abandonId: string;
  donateur: string;
  natureDescription: string;
  amountCents: number;
  dateDepense: string;
  appUrl: string;
}

export interface NationalMailtoParams {
  abandonId: string;
  donateur: string;
  natureDescription: string;
  amountCents: number;
  dateDepense: string;
  anneeFiscale: string;
  groupName?: string | null;
}

// Génère un `mailto:` pré-rempli pour l'envoi au national. Le PDF
// signé doit être attaché manuellement par l'admin (mailto: ne porte
// pas de pièce jointe, c'est une limite du protocole).
export function buildNationalMailto(params: NationalMailtoParams): string {
  const subject = `Abandon de frais ${params.anneeFiscale} — ${params.donateur} (${formatAmount(params.amountCents)})`;
  const lines = [
    `Bonjour,`,
    ``,
    `Vous trouverez en pièce jointe la feuille d'abandon de frais signée pour :`,
    ``,
    `  • Donateur : ${params.donateur}`,
    `  • Nature : ${params.natureDescription}`,
    `  • Montant : ${formatAmount(params.amountCents)}`,
    `  • Date : ${params.dateDepense}`,
    `  • Référence interne : ${params.abandonId}`,
    `  • Année fiscale : ${params.anneeFiscale}`,
    ``,
    params.groupName ? `Groupe : ${params.groupName}` : '',
    ``,
    `Merci de bien vouloir émettre le reçu fiscal CERFA correspondant.`,
    ``,
    `Cordialement.`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const params_url = new URLSearchParams({ subject, body: lines });
  return `mailto:${SGDF_DONATEURS_EMAIL}?${params_url.toString()}`;
}

export async function sendAbandonCreatedEmail(params: AbandonCreatedParams): Promise<void> {
  if (params.to.length === 0) return;
  const url = `${params.appUrl.replace(/\/$/, '')}/abandons`;

  const text = [
    `Bonjour,`,
    ``,
    `Une nouvelle déclaration d'abandon de frais a été déposée :`,
    ``,
    `  • Donateur : ${params.donateur}`,
    `  • Nature : ${params.natureDescription}`,
    `  • Montant : ${formatAmount(params.amountCents)}`,
    `  • Date de la dépense : ${params.dateDepense}`,
    `  • Référence : ${params.abandonId}`,
    ``,
    `Pour la traiter et préparer le reçu fiscal :`,
    `  ${url}`,
    ``,
    `À bientôt sur Baloo.`,
  ].join('\n');

  await Promise.all(params.to.map((to) =>
    sendMail({
      to,
      subject: `Nouvel abandon de frais — ${params.donateur} (${formatAmount(params.amountCents)})`,
      text,
    }),
  ));
}
