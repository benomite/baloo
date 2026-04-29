export type EcritureType = 'depense' | 'recette';
export type EcritureStatus = 'brouillon' | 'valide' | 'saisie_comptaweb';
export type RemboursementStatus =
  | 'a_traiter'
  | 'valide_tresorier'
  | 'valide_rg'
  | 'virement_effectue'
  | 'termine'
  | 'refuse';
export type JustificatifStatus = 'oui' | 'en_attente' | 'non';
export type DepotType = 'banque' | 'ancv';

export interface Ecriture {
  id: string;
  group_id: string;
  unite_id: string | null;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: EcritureType;
  category_id: string | null;
  mode_paiement_id: string | null;
  activite_id: string | null;
  numero_piece: string | null;
  status: EcritureStatus;
  justif_attendu: number;
  comptaweb_synced: number;
  ligne_bancaire_id: number | null;
  ligne_bancaire_sous_index: number | null;
  comptaweb_ecriture_id: number | null;
  carte_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  unite_code?: string | null;
  unite_name?: string | null;
  unite_couleur?: string | null;
  category_name?: string | null;
  mode_paiement_name?: string | null;
  activite_name?: string | null;
  carte_porteur?: string | null;
  carte_type?: 'cb' | 'procurement' | null;
  has_justificatif?: boolean;
  // Calculated fields (listing only)
  missing_fields?: string[];
}

export interface Carte {
  id: string;
  type: 'cb' | 'procurement';
  porteur: string;
  comptaweb_id: number | null;
  code_externe: string | null;
  statut: 'active' | 'ancienne';
}

export interface Remboursement {
  id: string;
  group_id: string;
  demandeur: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  rib_texte: string | null;
  rib_file_path: string | null;
  amount_cents: number;
  total_cents: number;
  date_depense: string | null;
  nature: string | null;
  unite_id: string | null;
  justificatif_status: JustificatifStatus;
  status: RemboursementStatus;
  motif_refus: string | null;
  date_paiement: string | null;
  mode_paiement_id: string | null;
  comptaweb_synced: number;
  ecriture_id: string | null;
  notes: string | null;
  submitted_by_user_id: string | null;
  edit_token: string | null;
  validate_token: string | null;
  created_at: string;
  updated_at: string;
  unite_code?: string | null;
  mode_paiement_name?: string | null;
}

export interface MouvementCaisse {
  id: string;
  date_mouvement: string;
  description: string;
  amount_cents: number;
  unite_id?: string | null;
  activite_id?: string | null;
  solde_apres_cents: number | null;
  notes: string | null;
  created_at: string;
  unite_code?: string | null;
  activite_name?: string | null;
}

export interface Category {
  id: string;
  name: string;
  type: 'depense' | 'recette' | 'les_deux';
  comptaweb_nature: string | null;
}

export interface Unite {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
}

export interface ModePaiement {
  id: string;
  name: string;
}

export interface Activite {
  id: string;
  name: string;
}

export interface Justificatif {
  id: string;
  file_path: string;
  original_filename: string;
  mime_type: string | null;
  entity_type: string;
  entity_id: string;
  uploaded_at: string;
}
