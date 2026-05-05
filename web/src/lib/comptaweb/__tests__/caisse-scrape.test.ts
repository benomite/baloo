import { describe, it, expect } from 'vitest';
import { parseCaisseGestionHtml, parseCaisseListHtml } from '../caisse-scrape';

const FIXTURE_GESTION = `<!doctype html><html><body>
<select name="caissegestion">
  <option value="0">— choisir —</option>
  <option value="141" selected>Caisse Groupe</option>
</select>
<table>
  <thead>
    <tr><th>Caisse</th><th>Gérant</th><th>Devise</th><th>Solde début</th><th>Dépenses</th><th>Recettes</th><th>Solde</th></tr>
  </thead>
  <tbody>
    <tr><td>Caisse Groupe</td><td>FOURNAND DAMIEN</td><td>EUR</td><td>0,00</td><td>2980,67</td><td>3093,67</td><td>113,00</td></tr>
  </tbody>
</table>
<table>
  <thead>
    <tr><th></th><th>Date</th><th>Type de transaction</th><th>Montant</th><th>Intitulé</th><th>N° de pièce</th><th>Catégorie de tiers</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="/recettedepense/2294715/actualiser">action</a></td>
      <td>20250927 27/09/2025</td>
      <td>Recette</td>
      <td>166,00</td>
      <td>Calendriers</td>
      <td>ESP-2503</td>
      <td>Autre : pas structure SGDF</td>
    </tr>
    <tr>
      <td><a href="/recettedepense/2311053/actualiser">action</a></td>
      <td>20251129 29/11/2025</td>
      <td>Transfert interne à la structure</td>
      <td>1110,00</td>
      <td>Dépot billet du 29/11</td>
      <td>DEP-2501</td>
      <td>Mon groupe</td>
    </tr>
    <tr>
      <td colspan="7">Ligne sans lien d'action — doit être ignorée</td>
    </tr>
  </tbody>
</table>
</body></html>`;

const FIXTURE_LIST = `<!doctype html><html><body>
<table>
  <thead>
    <tr><th>Libellé</th><th>Devise</th><th>Utilisateur qui la gère</th><th>Inactive</th><th></th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Caisse Groupe</td>
      <td>Euro</td>
      <td>FOURNAND DAMIEN</td>
      <td>Active</td>
      <td>
        <a href="/caisse/141/show">Voir</a>
        <a href="/caisse/141/edit">Modifier</a>
      </td>
    </tr>
  </tbody>
</table>
</body></html>`;

describe('parseCaisseGestionHtml', () => {
  const data = parseCaisseGestionHtml(FIXTURE_GESTION);

  it('détecte la caisse sélectionnée', () => {
    expect(data.caisseId).toBe(141);
    expect(data.libelle).toBe('Caisse Groupe');
  });

  it('parse le bloc solde', () => {
    expect(data.soldeDebutCentimes).toBe(0);
    expect(data.depensesCentimes).toBe(298067);
    expect(data.recettesCentimes).toBe(309367);
    expect(data.soldeCentimes).toBe(11300);
  });

  it('extrait les mouvements avec leur comptawebEcritureId', () => {
    expect(data.mouvements).toHaveLength(2);
    expect(data.mouvements[0]).toMatchObject({
      comptawebEcritureId: 2294715,
      date: '2025-09-27',
      type: 'recette',
      montantCentimes: 16600,
      numeroPiece: 'ESP-2503',
    });
    expect(data.mouvements[1]).toMatchObject({
      comptawebEcritureId: 2311053,
      date: '2025-11-29',
      type: 'transfert',
      montantCentimes: 111000,
      numeroPiece: 'DEP-2501',
    });
  });

  it('ignore les lignes sans /recettedepense/', () => {
    // 3 tr dans le tbody mais 1 sans lien → 2 mouvements parsés.
    expect(data.mouvements.length).toBe(2);
  });
});

describe('parseCaisseListHtml', () => {
  it('extrait les caisses depuis les liens /caisse/{id}/show', () => {
    const list = parseCaisseListHtml(FIXTURE_LIST);
    expect(list).toEqual([
      { id: 141, libelle: 'Caisse Groupe', gerant: 'FOURNAND DAMIEN', devise: 'Euro', inactif: false },
    ]);
  });
});
