import { sendMail } from './transport';
import { formatAmount } from '../format';

interface RelanceMailParams {
  to: string;
  ecritureDescription: string;
  ecritureAmountCents: number;
  ecritureType: 'depense' | 'recette';
  ecritureDate: string;
  inviterName: string | null;
  appUrl: string;
  customMessage?: string | null;
}

export async function sendRelanceJustifEmail(params: RelanceMailParams): Promise<void> {
  const {
    to, ecritureDescription, ecritureAmountCents, ecritureType, ecritureDate,
    inviterName, appUrl, customMessage,
  } = params;

  const sign = ecritureType === 'depense' ? '-' : '+';
  const depotUrl = `${appUrl.replace(/\/$/, '')}/depot`;
  const greeting = 'Bonjour,';
  const inviter = inviterName ?? 'Le trésorier du groupe';

  const lines = [
    greeting,
    '',
    `${inviter} a besoin du justificatif (photo / PDF) pour cette dépense :`,
    '',
    `  • ${ecritureDescription}`,
    `  • ${sign}${formatAmount(ecritureAmountCents)}`,
    `  • ${ecritureDate}`,
    '',
    customMessage ? customMessage + '\n' : '',
    `Pour le déposer, va sur :`,
    `  ${depotUrl}`,
    '',
    `(Connecte-toi avec ton email puis dépose la photo du ticket / de la facture.)`,
    '',
    `Merci !`,
  ].filter(Boolean);

  await sendMail({
    to,
    subject: `Justificatif demandé — ${ecritureDescription.slice(0, 50)}`,
    text: lines.join('\n'),
  });
}
