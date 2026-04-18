-- Seed data — catégories et modes de paiement SGDF (génériques, alignés avec Comptaweb).
-- Les unités et activités sont propres à chaque groupe et sont créées par le
-- bootstrap (compta/src/scripts/bootstrap.ts) ou manuellement via les outils MCP.

-- Catégories (alignées natures exactes Comptaweb, casse/ponctuation observées dans les exports)
INSERT OR IGNORE INTO categories (id, name, type, comptaweb_nature) VALUES
    ('cat-intendance', 'Intendance / alimentation', 'depense', 'Alimentation, Intendance'),
    ('cat-transport', 'Transport', 'depense', 'Remboursement via Ndf frais de transport'),
    ('cat-materiel-peda', 'Matériel pédagogique', 'depense', 'Achat Matériel Pédagogique'),
    ('cat-petit-materiel', 'Petit matériel', 'depense', 'Achat Petit Matériel'),
    ('cat-hebergement', 'Hébergement', 'depense', 'Hébergement, séminaire'),
    ('cat-formation', 'Formation', 'les_deux', 'Formation'),
    ('cat-admin', 'Administratif / affranchissement', 'depense', 'Affranchissement'),
    ('cat-assurance', 'Assurance', 'depense', 'Assurances'),
    ('cat-location-vehicule', 'Location véhicule', 'depense', 'Location Véhicule/Bateau'),
    ('cat-carburant', 'Carburant / gaz', 'depense', 'Carburant'),
    ('cat-cotisations', 'Cotisations SGDF', 'les_deux', 'Cotisations SGDF'),
    ('cat-participation', 'Participation activités', 'les_deux', 'Participation Activités (camp, we...)'),
    ('cat-subvention-caf', 'Subventions CAF / PSCAF', 'recette', 'CAF : PSCAF'),
    ('cat-extra-jobs', 'Extra-jobs', 'recette', 'Extra-Jobs'),
    ('cat-dons', 'Dons / calendriers (sans reçu fiscal)', 'recette', 'Dons, calendriers (sans reçu fiscal)'),
    ('cat-dons-fiscal', 'Dons avec reçu fiscal', 'recette', 'Dons avec Reçu Fiscal'),
    ('cat-boutique-achat', 'Achat destiné à la revente', 'depense', 'Achat destiné à la revente'),
    ('cat-boutique-vente', 'Vente article boutique', 'recette', 'Vente article boutique'),
    ('cat-flux-structures', 'Flux financiers entre structures', 'les_deux', 'Flux financiers entre structures ( SAUF la participation aux activités)'),
    ('cat-peage-parking', 'Péage / parking', 'depense', 'Péage-Parking'),
    ('cat-fournitures-admin', 'Fournitures administratives', 'depense', 'Achat Fournitures administratives'),
    ('cat-depot-especes', 'Dépôts / retraits espèces', 'les_deux', 'Dépôts, retrait espèces'),
    ('cat-perequation', 'Péréquation (FDP)', 'depense', 'Péréquation'),
    ('cat-fct-territoire', 'Participation au fonctionnement du territoire', 'depense', 'Participation au Fct du Territoire'),
    ('cat-fct-mouvement', 'Participation au fonctionnement du mouvement', 'depense', 'Participation au Fct du Mouvement'),
    ('cat-fsi', 'Participation au FSI', 'depense', 'Participation au FSI');

-- Alignement des comptaweb_nature sur les entrées existantes (évolution du mapping après observation d'exports réels).
-- Idempotent : met à jour chaque nature vers la forme exacte renvoyée par Comptaweb.
UPDATE categories SET comptaweb_nature = 'Alimentation, Intendance' WHERE id = 'cat-intendance';
UPDATE categories SET comptaweb_nature = 'Remboursement via Ndf frais de transport' WHERE id = 'cat-transport';
UPDATE categories SET comptaweb_nature = 'Achat Matériel Pédagogique' WHERE id = 'cat-materiel-peda';
UPDATE categories SET comptaweb_nature = 'Achat Petit Matériel' WHERE id = 'cat-petit-materiel';
UPDATE categories SET comptaweb_nature = 'Location Véhicule/Bateau' WHERE id = 'cat-location-vehicule';
UPDATE categories SET comptaweb_nature = 'Participation Activités (camp, we...)' WHERE id = 'cat-participation';
UPDATE categories SET comptaweb_nature = 'Extra-Jobs' WHERE id = 'cat-extra-jobs';
UPDATE categories SET comptaweb_nature = 'Dons avec Reçu Fiscal' WHERE id = 'cat-dons-fiscal';
UPDATE categories SET comptaweb_nature = 'Flux financiers entre structures ( SAUF la participation aux activités)' WHERE id = 'cat-flux-structures';
UPDATE categories SET comptaweb_nature = 'Péage-Parking' WHERE id = 'cat-peage-parking';
UPDATE categories SET comptaweb_nature = 'Achat Fournitures administratives' WHERE id = 'cat-fournitures-admin';
-- Si une ancienne cat-boutique existe (libellé fusionné), on ne la supprime pas (risque de casser des FK éventuelles) mais on désaligne sa nature pour éviter tout matching ambigu.
UPDATE categories SET comptaweb_nature = NULL WHERE id = 'cat-boutique';

-- Modes de paiement (du Sheet "Compta Unités")
INSERT OR IGNORE INTO modes_paiement (id, name) VALUES
    ('mp-cb-sgdf', 'CB SGDF'),
    ('mp-caisse', 'Caisse'),
    ('mp-personnel', 'Personnel (avance chef)'),
    ('mp-chequier', 'Chéquier'),
    ('mp-prelevement', 'Prélèvement'),
    ('mp-virement', 'Virement');

-- Les unités (5 branches SGDF standards) et activités sont peuplées par le
-- bootstrap avec le group_id du groupe courant. Voir bootstrap.ts.
