// Génère le PDF "feuille de remboursement" à partir d'une demande et
// de ses lignes. Reconstruit côté Baloo ce que valdesous demandait
// d'uploader en Excel/PDF (chantier 2-bis).
//
// Utilise pdfkit (impératif, sans React) — @react-pdf/renderer n'est
// pas encore compatible React 19 côté types.

import PDFDocument from 'pdfkit';
import type { Remboursement } from '../types';
import type { RemboursementLigne } from '../services/remboursements';
import type { Signature } from '../services/signatures';
import { formatAmount } from '../format';

const ROLE_LABEL: Record<string, string> = {
  demandeur: 'Demandeur',
  tresorier: 'Trésorier',
  RG: 'Responsable de groupe',
  cotresorier: 'Cotrésorier',
};

interface FeuilleProps {
  rbt: Remboursement;
  lignes: RemboursementLigne[];
  groupName: string;
  submittedAt: string;
  signatures?: Signature[];
}

export async function renderFeuilleRemboursementPdf(
  props: FeuilleProps,
): Promise<Buffer> {
  const { rbt, lignes, groupName, submittedAt, signatures = [] } = props;

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fullName = [rbt.prenom, rbt.nom].filter(Boolean).join(' ') || rbt.demandeur;
      const total = lignes.reduce((s, l) => s + l.amount_cents, 0);

      // Title
      doc.fontSize(18).font('Helvetica-Bold').text('Feuille de remboursement');
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica').fillColor('#555')
        .text(`${groupName} · Référence : ${rbt.id}`);
      doc.moveDown(1);

      // Demandeur
      doc.fillColor('black').fontSize(12).font('Helvetica-Bold').text('Demandeur');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      drawKV(doc, 'Nom', fullName);
      if (rbt.email) drawKV(doc, 'Email', rbt.email);
      drawKV(doc, 'Soumise le', submittedAt);
      doc.moveDown(0.8);

      // Tableau lignes
      doc.fontSize(12).font('Helvetica-Bold').text('Détail des dépenses');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const colDate = 40;
      const colNature = 120;
      const colAmount = 480;
      const tableWidth = 555 - 40;

      // Header
      doc.rect(40, tableTop, tableWidth, 18).fill('#f3f4f6');
      doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
      doc.text('Date', colDate + 4, tableTop + 5);
      doc.text('Nature', colNature, tableTop + 5);
      doc.text('Montant', colAmount, tableTop + 5, { width: 75, align: 'right' });

      let y = tableTop + 18;
      doc.font('Helvetica').fontSize(10);
      if (lignes.length === 0) {
        doc.fillColor('#999').text('(aucune ligne)', colNature, y + 4);
        y += 22;
      } else {
        for (const l of lignes) {
          const nature = l.notes ? `${l.nature} — ${l.notes}` : l.nature;
          const heightNeeded = doc.heightOfString(nature, { width: colAmount - colNature - 10 });
          const rowHeight = Math.max(18, heightNeeded + 6);

          doc.fillColor('black');
          doc.text(l.date_depense, colDate + 4, y + 4);
          doc.text(nature, colNature, y + 4, { width: colAmount - colNature - 10 });
          doc.text(formatAmount(l.amount_cents), colAmount, y + 4, { width: 75, align: 'right' });

          y += rowHeight;
          // line
          doc.strokeColor('#eee').lineWidth(0.5).moveTo(40, y).lineTo(40 + tableWidth, y).stroke();
        }
      }

      // Total
      const totalY = y;
      doc.rect(40, totalY, tableWidth, 22).fill('#f9fafb');
      doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
      doc.text('Total', colNature, totalY + 6);
      doc.text(formatAmount(total), colAmount, totalY + 6, { width: 75, align: 'right' });
      doc.font('Helvetica');
      y = totalY + 22;

      // RIB
      if (rbt.rib_texte || rbt.rib_file_path) {
        doc.y = y + 20;
        doc.fontSize(12).font('Helvetica-Bold').text('Coordonnées bancaires');
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');
        if (rbt.rib_texte) drawKV(doc, 'IBAN / BIC', rbt.rib_texte);
        if (rbt.rib_file_path) drawKV(doc, 'RIB joint', 'fichier joint à la demande');
      }

      // Certif
      doc.y = Math.max(doc.y + 20, 650);
      doc.fontSize(9).fillColor('#444').font('Helvetica');
      doc.text(
        `Le demandeur certifie l'exactitude des informations ci-dessus et déclare avoir avancé les frais listés pour le compte du groupe ${groupName}. Cette feuille est générée automatiquement par Baloo et signée électroniquement par les acteurs ci-dessous. Les justificatifs sont conservés en pièces jointes et accessibles via l'application.`,
        40, doc.y,
        { width: 515, lineGap: 1 },
      );
      doc.moveDown(1);

      // Signatures (audit trail SES + chaînage interne — ADR-023)
      doc.fontSize(11).font('Helvetica-Bold').fillColor('black').text('Signatures électroniques');
      doc.moveDown(0.3);
      if (signatures.length === 0) {
        doc.fontSize(9).fillColor('#999').font('Helvetica-Oblique')
          .text('(en attente de la première signature)');
      } else {
        doc.fontSize(8).fillColor('black').font('Helvetica');
        for (const s of signatures) {
          const role = ROLE_LABEL[s.signer_role] ?? s.signer_role;
          const name = s.signer_name ?? s.signer_email;
          const when = s.server_timestamp.replace('T', ' ').replace('Z', ' UTC');
          const ip = s.ip ?? '—';

          doc.font('Helvetica-Bold').text(`${role} : ${name}`, { continued: false });
          doc.font('Helvetica').fillColor('#444');
          doc.text(`   Signé le ${when} · email ${s.signer_email} · IP ${ip}`);
          doc.fillColor('#888');
          doc.text(`   data_hash : ${s.data_hash.slice(0, 32)}…${s.data_hash.slice(-8)}`);
          doc.text(`   chain_hash : ${s.chain_hash.slice(0, 32)}…${s.chain_hash.slice(-8)}`);
          doc.fillColor('black');
          doc.moveDown(0.4);
        }
      }

      // Footer
      doc.fontSize(8).fillColor('#999').font('Helvetica').text(
        `Document généré par Baloo le ${submittedAt} — ${rbt.id} · audit trail vérifiable côté application`,
        40, 800, { width: 515, align: 'center' },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawKV(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const y = doc.y;
  doc.fillColor('#666').text(label, 40, y, { width: 110, continued: false });
  doc.fillColor('black').text(value, 150, y, { width: 405 });
}
