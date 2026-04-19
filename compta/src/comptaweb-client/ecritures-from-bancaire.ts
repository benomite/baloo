import type {
  ComptawebConfig,
  CreateEcritureInput,
  CreateEcritureResult,
  EcritureBancaireNonRapprochee,
  EcritureType,
  SousLigneDsp2,
  VentilationInput,
} from './types.js';
import { createEcriture } from './ecritures-write.js';
import { listRapprochementBancaire } from './ecritures-bancaires.js';

export interface EcritureFromBancaireInput {
  ligneBancaireId: number;
  sousLigneIndex?: number;
  ventilation: VentilationInput;
  libelOverride?: string;
  modetransactionIdOverride?: string;
  numeropiece?: string;
  tiersCategId?: string;
  tiersStructureId?: string;
  dryRun?: boolean;
}

interface EcritureFromBancaireResult extends CreateEcritureResult {
  sourceLigneId: number;
  sourceSousLigneIndex: number | null;
  sourceMontantCentimes: number;
  inferredModetransactionId: string;
}

function isoToFr(dateIso: string): string {
  const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Date ISO invalide : ${dateIso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function centimesToMontantFr(centimes: number): string {
  const abs = Math.abs(centimes);
  const euros = Math.floor(abs / 100);
  const cts = String(abs % 100).padStart(2, '0');
  return `${euros},${cts}`;
}

function inferTypeFromCentimes(centimes: number): EcritureType {
  if (centimes === 0) throw new Error("Montant nul — impossible d'inférer dépense vs recette.");
  return centimes < 0 ? 'depense' : 'recette';
}

function cleanCommercantLabel(label: string): string {
  // Retire les longues chaînes numériques en fin (numéros de ref internes).
  return label
    .replace(/\s+\d{6,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function inferModetransaction(intitule: string): string {
  const i = intitule.toUpperCase();
  if (i.startsWith('VIR ') || i.includes(' VIR ') || i.includes('VIREMENT') || i.includes('VIR DE ')) {
    return '1'; // Virement
  }
  if (i.includes('PAIEMENT C. PROC') || i.includes('CARTE PROCUREMENT')) {
    return '9'; // Carte procurement
  }
  if (i.includes('PAIEMENT PAR CB') || i.includes('CB ') || i.includes('CARTE BANCAIRE')) {
    return '3'; // Carte bancaire
  }
  if (i.includes('PRLV') || i.includes('PRELEVEMENT')) {
    return '2'; // Chèque ? ou Prélèvement ?
  }
  // Défaut raisonnable : Virement.
  return '1';
}

function inferLibel(ligne: EcritureBancaireNonRapprochee, sousLigne: SousLigneDsp2 | null): string {
  if (sousLigne) return cleanCommercantLabel(sousLigne.commercant);
  return cleanCommercantLabel(ligne.intitule);
}

export async function createEcritureFromLigneBancaire(
  config: ComptawebConfig,
  input: EcritureFromBancaireInput,
): Promise<EcritureFromBancaireResult> {
  const rapprochement = await listRapprochementBancaire(config);
  const ligne = rapprochement.ecrituresBancaires.find((l) => l.id === input.ligneBancaireId);
  if (!ligne) {
    throw new Error(`Ligne bancaire ${input.ligneBancaireId} introuvable parmi les ${rapprochement.ecrituresBancaires.length} non rapprochées.`);
  }

  let sousLigne: SousLigneDsp2 | null = null;
  let montantCentimes = ligne.montantCentimes;
  if (input.sousLigneIndex !== undefined) {
    sousLigne = ligne.sousLignes[input.sousLigneIndex];
    if (!sousLigne) {
      throw new Error(`sous_ligne_index ${input.sousLigneIndex} hors bornes (la ligne a ${ligne.sousLignes.length} sous-lignes).`);
    }
    montantCentimes = sousLigne.montantCentimes;
  }

  const type = inferTypeFromCentimes(montantCentimes);
  const montant = centimesToMontantFr(montantCentimes);
  const dateFr = isoToFr(ligne.dateOperation);
  const libel = input.libelOverride ?? inferLibel(ligne, sousLigne);
  const modetransactionId = input.modetransactionIdOverride ?? inferModetransaction(ligne.intitule);

  const comptawebInput: CreateEcritureInput = {
    type,
    libel,
    dateecriture: dateFr,
    montant,
    numeropiece: input.numeropiece,
    modetransactionId,
    comptebancaireId: String(rapprochement.idCompte),
    tiersCategId: input.tiersCategId ?? '4', // 'Mon groupe' par défaut
    tiersStructureId: input.tiersStructureId ?? '498', // à adapter si multi-groupe
    ventilations: [
      {
        montant,
        natureId: input.ventilation.natureId,
        activiteId: input.ventilation.activiteId,
        brancheprojetId: input.ventilation.brancheprojetId,
      },
    ],
  };

  const result = await createEcriture(config, comptawebInput, { dryRun: input.dryRun !== false });
  return {
    ...result,
    sourceLigneId: ligne.id,
    sourceSousLigneIndex: input.sousLigneIndex ?? null,
    sourceMontantCentimes: montantCentimes,
    inferredModetransactionId: modetransactionId,
  };
}
