import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  ComptawebSessionExpiredError,
} from '@/lib/comptaweb';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';
import { formatAmount } from '@/lib/format';

ensureComptawebEnv();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  try {
    const data = await withAutoReLogin((cfg) => listRapprochementBancaire(cfg));
    return Response.json({
      compte: { id: data.idCompte, libelle: data.libelleCompte },
      ecritures_comptables_non_rapprochees: data.ecrituresComptables.map((e) => ({
        id: e.id,
        date_ecriture: e.dateEcriture,
        type: e.type,
        intitule: e.intitule,
        devise: e.devise,
        montant: formatAmount(e.montantCentimes),
        montant_centimes: e.montantCentimes,
        numero_piece: e.numeroPiece,
        mode_transaction: e.modeTransaction,
        tiers: e.tiers,
      })),
      ecritures_bancaires_non_rapprochees: data.ecrituresBancaires.map((e) => ({
        id: e.id,
        date_operation: e.dateOperation,
        intitule: e.intitule,
        montant: formatAmount(e.montantCentimes),
        montant_centimes: e.montantCentimes,
        sous_lignes: e.sousLignes.map((sl) => ({
          montant: formatAmount(sl.montantCentimes),
          montant_centimes: sl.montantCentimes,
          commercant: sl.commercant,
        })),
      })),
    });
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) {
      return jsonError('Session Comptaweb expirée et re-login automatique impossible.', 502);
    }
    return jsonError(err instanceof Error ? err.message : String(err), 502);
  }
}
