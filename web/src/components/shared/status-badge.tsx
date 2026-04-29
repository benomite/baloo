import { Badge } from '@/components/ui/badge';

const ecritureColors: Record<string, string> = {
  brouillon: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
  valide: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  saisie_comptaweb: 'bg-green-100 text-green-700 hover:bg-green-100',
};

const ecritureLabels: Record<string, string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  saisie_comptaweb: 'Saisie Comptaweb',
};

const remboursementColors: Record<string, string> = {
  a_traiter: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  valide_tresorier: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  valide_rg: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100',
  virement_effectue: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  termine: 'bg-green-100 text-green-700 hover:bg-green-100',
  refuse: 'bg-red-100 text-red-700 hover:bg-red-100',
};

const remboursementLabels: Record<string, string> = {
  a_traiter: 'À traiter',
  valide_tresorier: 'Validé Trésorier',
  valide_rg: 'Validé RG',
  virement_effectue: 'Virement effectué',
  termine: 'Terminé',
  refuse: 'Refusé',
};

export function EcritureStatusBadge({ status }: { status: string }) {
  return <Badge className={ecritureColors[status] ?? ''}>{ecritureLabels[status] ?? status}</Badge>;
}

export function RemboursementStatusBadge({ status }: { status: string }) {
  return <Badge className={remboursementColors[status] ?? ''}>{remboursementLabels[status] ?? status}</Badge>;
}
