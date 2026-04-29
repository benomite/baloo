import { sendMail } from './transport';
import { formatAmount } from '../format';

interface RemboursementCreatedParams {
  to: string[];                  // emails des admins du groupe
  rbtId: string;
  demandeur: string;
  natureDescription: string;
  amountCents: number;
  dateDepense: string;
  appUrl: string;
}

export async function sendRemboursementCreatedEmail(params: RemboursementCreatedParams): Promise<void> {
  if (params.to.length === 0) return;
  const url = `${params.appUrl.replace(/\/$/, '')}/remboursements/${params.rbtId}`;

  const text = [
    `Bonjour,`,
    ``,
    `Une nouvelle demande de remboursement a été déposée :`,
    ``,
    `  • Demandeur : ${params.demandeur}`,
    `  • Nature : ${params.natureDescription}`,
    `  • Montant : ${formatAmount(params.amountCents)}`,
    `  • Date de la dépense : ${params.dateDepense}`,
    `  • Référence : ${params.rbtId}`,
    ``,
    `Pour la traiter, va sur :`,
    `  ${url}`,
    ``,
    `À bientôt sur Baloo.`,
  ].join('\n');

  // Envoi en parallèle (pas un seul mail multi-destinataires : on évite
  // de faire fuiter les adresses des autres admins dans le To).
  await Promise.all(params.to.map((to) =>
    sendMail({
      to,
      subject: `Nouvelle demande de remboursement — ${params.demandeur} (${formatAmount(params.amountCents)})`,
      text,
    }),
  ));
}

interface RemboursementStatusChangedParams {
  to: string;
  invitedName: string | null;
  rbtId: string;
  natureDescription: string;
  amountCents: number;
  newStatus: 'valide' | 'paye' | 'refuse';
  motif?: string | null;
  appUrl: string;
}

const STATUS_HUMAN: Record<RemboursementStatusChangedParams['newStatus'], string> = {
  valide: 'validée',
  paye: 'payée',
  refuse: 'refusée',
};

export async function sendRemboursementStatusChangedEmail(
  params: RemboursementStatusChangedParams,
): Promise<void> {
  const greeting = params.invitedName ? `Bonjour ${params.invitedName},` : 'Bonjour,';
  const statusH = STATUS_HUMAN[params.newStatus];
  const url = `${params.appUrl.replace(/\/$/, '')}/moi`;

  const lines = [
    greeting,
    '',
    `Ta demande de remboursement (${params.rbtId}) a été ${statusH} :`,
    ``,
    `  • Nature : ${params.natureDescription}`,
    `  • Montant : ${formatAmount(params.amountCents)}`,
    ``,
  ];

  if (params.newStatus === 'paye') {
    lines.push(`Le virement (ou paiement en espèces) a été effectué.`);
  } else if (params.newStatus === 'valide') {
    lines.push(`La demande sera payée prochainement.`);
  } else if (params.newStatus === 'refuse') {
    lines.push(`Motif : ${params.motif ?? '— non précisé.'}`);
  }

  lines.push(
    '',
    `Pour voir le détail, va sur :`,
    `  ${url}`,
    '',
    `À bientôt sur Baloo.`,
  );

  await sendMail({
    to: params.to,
    subject: `Remboursement ${statusH} — ${params.rbtId}`,
    text: lines.join('\n'),
  });
}
