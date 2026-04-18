import { getDb, currentTimestamp } from '../db.js';
import { loadEnv, requireEnv } from '../config.js';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function upsertGroupe(
  db: ReturnType<typeof getDb>,
  id: string,
  code: string,
  nom: string,
  territoire: string | null,
  emailContact: string | null,
): void {
  const now = currentTimestamp();
  db.prepare(
    `INSERT INTO groupes (id, code, nom, territoire, email_contact, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       nom = excluded.nom,
       territoire = excluded.territoire,
       email_contact = excluded.email_contact,
       updated_at = excluded.updated_at`
  ).run(id, code, nom, territoire, emailContact, now, now);
}

function upsertPersonne(
  db: ReturnType<typeof getDb>,
  id: string,
  groupId: string,
  prenom: string,
  nom: string | null,
  email: string,
  roleGroupe: string,
): void {
  const now = currentTimestamp();
  db.prepare(
    `INSERT INTO personnes (id, group_id, prenom, nom, email, role_groupe, statut, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'actif', ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       prenom = excluded.prenom,
       nom = excluded.nom,
       email = excluded.email,
       role_groupe = excluded.role_groupe,
       updated_at = excluded.updated_at`
  ).run(id, groupId, prenom, nom, email, roleGroupe, now, now);
}

function upsertUser(
  db: ReturnType<typeof getDb>,
  id: string,
  groupId: string,
  personId: string | null,
  email: string,
  nomAffichage: string,
): void {
  const now = currentTimestamp();
  db.prepare(
    `INSERT INTO users (id, group_id, person_id, email, nom_affichage, role, statut, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'tresorier', 'actif', ?, ?)
     ON CONFLICT (group_id, email) DO UPDATE SET
       person_id = excluded.person_id,
       nom_affichage = excluded.nom_affichage,
       updated_at = excluded.updated_at`
  ).run(id, groupId, personId, email, nomAffichage, now, now);
}

function splitName(full: string): { prenom: string; nom: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { prenom: parts[0], nom: null };
  return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

function main() {
  loadEnv();
  const groupCode = requireEnv('BALOO_GROUP_CODE');
  const groupName = requireEnv('BALOO_GROUP_NAME');
  const userEmail = requireEnv('BALOO_USER_EMAIL');
  const userName = requireEnv('BALOO_USER_NAME');
  const groupTerritoire = loadEnv().BALOO_GROUP_TERRITOIRE ?? null;
  const groupContact = loadEnv().BALOO_GROUP_EMAIL_CONTACT ?? null;

  const db = getDb();
  const groupId = slugify(groupCode);
  const userId = slugify(userEmail.split('@')[0]);
  const personId = `per-${userId}`;
  const { prenom, nom } = splitName(userName);

  // Unités standards SGDF (5 branches). Chaque groupe peut en ajouter d'autres
  // via l'outil MCP (ex: une unité d'adultes propre au groupe).
  const UNITES_SGDF: [string, string][] = [
    ['FA', 'Farfadets'],
    ['LJ', 'Louveteaux-Jeannettes'],
    ['SG', 'Scouts-Guides'],
    ['PC', 'Pionniers-Caravelles'],
    ['CO', 'Compagnons'],
  ];
  const ACTIVITES_DEFAUT: string[] = [
    'Activités d\'année',
    'Fonctionnement',
    'Formation',
    'Camps',
  ];

  db.transaction(() => {
    upsertGroupe(db, groupId, groupCode, groupName, groupTerritoire, groupContact);
    upsertPersonne(db, personId, groupId, prenom, nom, userEmail, 'tresorier');
    upsertUser(db, userId, groupId, personId, userEmail, userName);

    const insertUnite = db.prepare(
      `INSERT OR IGNORE INTO unites (id, group_id, code, name) VALUES (?, ?, ?, ?)`
    );
    for (const [code, name] of UNITES_SGDF) {
      insertUnite.run(`u-${groupId}-${code.toLowerCase()}`, groupId, code, name);
    }

    const insertActivite = db.prepare(
      `INSERT OR IGNORE INTO activites (id, group_id, name) VALUES (?, ?, ?)`
    );
    for (const name of ACTIVITES_DEFAUT) {
      const slug = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      insertActivite.run(`act-${groupId}-${slug}`, groupId, name);
    }
  })();

  console.log(`Bootstrap OK. Groupe: ${groupId} (${groupName}), user: ${userId} (${userEmail}), personne: ${personId}.`);
  console.log(`Unités SGDF standards et 4 activités par défaut créées pour ${groupId}.`);
}

main();
