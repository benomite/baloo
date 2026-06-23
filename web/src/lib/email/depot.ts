import { sendMail } from './transport';
import { formatAmount } from '../format';

// Notification « nouveau dépôt de justificatif » aux trésoriers / RG du
// GROUPE concerné (multi-tenant : la liste des destinataires est résolue
// par group_id en amont, cf. listAdminEmails). Symétrique de la notif de
// création de remboursement.

interface DepotCreatedParams {
  to: string[]; // emails des admins (trésorier/RG) du groupe concerné
  depotId: string;
  titre: string;
  deposeur: string;
  amountCents?: number | null;
  dateEstimee?: string | null;
  appUrl: string;
}

export async function sendDepotCreatedEmail(params: DepotCreatedParams): Promise<void> {
  if (params.to.length === 0) return;
  const url = `${params.appUrl.replace(/\/$/, '')}/depots`;

  const lines = [
    `Bonjour,`,
    ``,
    `Un nouveau justificatif vient d'être déposé :`,
    ``,
    `  • Titre : ${params.titre}`,
    `  • Déposé par : ${params.deposeur}`,
  ];
  if (params.amountCents != null) lines.push(`  • Montant : ${formatAmount(params.amountCents)}`);
  if (params.dateEstimee) lines.push(`  • Date estimée : ${params.dateEstimee}`);
  lines.push(
    `  • Référence : ${params.depotId}`,
    ``,
    `Pour le rapprocher d'une écriture ou d'une demande :`,
    `  ${url}`,
    ``,
    `À bientôt sur Baloo.`,
  );
  const text = lines.join('\n');

  const montantSuffix = params.amountCents != null ? ` (${formatAmount(params.amountCents)})` : '';
  // Envoi individuel (pas de To groupé) pour ne pas faire fuiter les
  // adresses des autres admins.
  await Promise.all(
    params.to.map((to) =>
      sendMail({
        to,
        subject: `Nouveau justificatif déposé — ${params.titre}${montantSuffix}`,
        text,
      }),
    ),
  );
}
