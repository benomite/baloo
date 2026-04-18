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
  demande: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  valide: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  paye: 'bg-green-100 text-green-700 hover:bg-green-100',
  refuse: 'bg-red-100 text-red-700 hover:bg-red-100',
};

const remboursementLabels: Record<string, string> = {
  demande: 'Demandé',
  valide: 'Validé',
  paye: 'Payé',
  refuse: 'Refusé',
};

export function EcritureStatusBadge({ status }: { status: string }) {
  return <Badge className={ecritureColors[status] ?? ''}>{ecritureLabels[status] ?? status}</Badge>;
}

export function RemboursementStatusBadge({ status }: { status: string }) {
  return <Badge className={remboursementColors[status] ?? ''}>{remboursementLabels[status] ?? status}</Badge>;
}
