// Comptages de contrôle (#55) : nombre de lignes de `ecritures` et de chaque
// table qui la référence par clé étrangère (remboursements, depots_*,
// justificatifs, mouvements_caisse…, trouvées par PRAGMA foreign_key_list,
// pas par une liste figée). Signale aussi une table `ecritures_new` restante
// (vestige des tentatives échouées de l'ancienne migration transfert interne).
//
// Lecture seule : aucune écriture, et la migration n'est PAS lancée par ce
// script. Sert à comparer les effectifs avant / après la migration sur une
// copie de la base de production :
//   1. lancer le script sur la copie, garder la sortie ;
//   2. lancer l'app (ou `ensureBusinessSchema`) sur cette copie ;
//   3. relancer le script et comparer : chaque nombre doit être identique.
//
// Usage :
//   DB_PATH=../data/copie-prod.db pnpm exec tsx scripts/check-ecritures-counts.ts
//   pnpm exec tsx --env-file=.env.copie scripts/check-ecritures-counts.ts   (DB_URL + DB_AUTH_TOKEN)
//
// Sortie : une ligne `<table> <nombre>` par table, ecritures en premier.
// Code de sortie 1 si la base n'a pas de table `ecritures`.

import { getDb } from '../src/lib/db';

async function main() {
  const db = getDb();
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  const noms = tables.map((t) => t.name);
  if (!noms.includes('ecritures')) {
    console.error('Pas de table ecritures dans cette base.');
    process.exit(1);
  }

  const referentes: string[] = [];
  for (const nom of noms) {
    const fks = await db.prepare(`PRAGMA foreign_key_list("${nom}")`).all<{ table: string }>();
    if (nom !== 'ecritures' && fks.some((f) => f.table === 'ecritures')) referentes.push(nom);
  }

  const aCompter = ['ecritures', ...referentes, ...(noms.includes('ecritures_new') ? ['ecritures_new'] : [])];
  const largeur = Math.max(...aCompter.map((n) => n.length));
  for (const nom of aCompter) {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM "${nom}"`).get<{ n: number }>();
    const suffixe = nom === 'ecritures_new' ? '   (vestige de l’ancienne migration)' : '';
    console.log(`${nom.padEnd(largeur)}  ${r?.n ?? 0}${suffixe}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
