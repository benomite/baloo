import { describe, it, expect } from 'vitest';
import { slug, dossierEcriture, dossierRemboursement } from '../arborescence';

describe('slug', () => {
  it('translittère les accents', () => {
    expect(slug('Intermarché Péage')).toBe('intermarche-peage');
  });
  it('neutralise les caractères interdits par le système de fichiers', () => {
    expect(slug('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });
  it('écrase les séparateurs répétés et rogne les bords', () => {
    expect(slug('  --a   b--  ')).toBe('a-b');
  });
  it('tronque sans couper au milieu d\'un séparateur', () => {
    expect(slug('abcdefghij klmnop', 10)).toBe('abcdefghij');
    expect(slug('abcde fghijklmn', 6)).toBe('abcde');
  });
  it('ne renvoie jamais une chaîne vide', () => {
    expect(slug('///')).toBe('sans-titre');
    expect(slug('')).toBe('sans-titre');
  });
});

describe('dossierEcriture', () => {
  it('préfixe par la date pour un tri chronologique naturel', () => {
    expect(
      dossierEcriture({
        id: 'ECR-2026-042', date_ecriture: '2026-08-05',
        numero_piece: 'PI-17', description: 'Intermarché camp',
      }),
    ).toBe('2026-08-05-pi-17-intermarche-camp');
  });
  it('retombe sur l\'id quand la pièce manque', () => {
    expect(
      dossierEcriture({
        id: 'ECR-2026-042', date_ecriture: '2026-08-05',
        numero_piece: null, description: 'Essence',
      }),
    ).toBe('2026-08-05-ecr-2026-042-essence');
  });
  it('gère une écriture sans date', () => {
    expect(
      dossierEcriture({ id: 'ECR-1', date_ecriture: null, numero_piece: null, description: null }),
    ).toBe('sans-date-ecr-1-sans-titre');
  });
  it('slugifie numero_piece : un `/` ne doit pas créer de sous-dossier fantôme', () => {
    expect(
      dossierEcriture({
        id: 'ECR-2026-050', date_ecriture: '2026-08-05',
        numero_piece: 'PC25- 01 À 05', description: 'Lot de tickets',
      }),
    ).toBe('2026-08-05-pc25-01-a-05-lot-de-tickets');
  });
});

describe('dossierRemboursement', () => {
  it('combine id et demandeur', () => {
    expect(dossierRemboursement({ id: 'REMB-2026-007', demandeur: 'Pierre Dupont' }))
      .toBe('REMB-2026-007-pierre-dupont');
  });
  it('gère un demandeur absent', () => {
    expect(dossierRemboursement({ id: 'REMB-1', demandeur: null })).toBe('REMB-1-sans-titre');
  });
});
