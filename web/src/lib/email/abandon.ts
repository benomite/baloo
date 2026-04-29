import { sendMail } from './transport';
import { formatAmount } from '../format';

interface AbandonCreatedParams {
  to: string[];
  abandonId: string;
  donateur: string;
  natureDescription: string;
  amountCents: number;
  dateDepense: string;
  appUrl: string;
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
