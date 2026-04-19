import { getDb, currentTimestamp } from '../db.js';
import { withAutoReLogin, fetchReferentielsCreer } from '../comptaweb-client/index.js';
import type { RefOption } from '../comptaweb-client/index.js';

function normalise(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function findMatch(options: RefOption[], target: string): RefOption | null {
  const key = normalise(target);
  if (!key) return null;
  return options.find((o) => normalise(o.label) === key) ?? null;
}

async function main() {
  const db = getDb();
  const refs = await withAutoReLogin((cfg) => fetchReferentielsCreer(cfg));

  console.log(`Référentiels Comptaweb récupérés :`);
  console.log(`  natures=${refs.nature.length}, activités=${refs.activite.length}, branches=${refs.brancheprojet.length}, modes=${refs.modetransaction.length}`);

  let matched = 0;
  let unmatched = 0;
  const unmatchedList: string[] = [];

  // Catégories : matcher via comptaweb_nature (qui contient le label exact Comptaweb)
  // ou via name.
  const categories = db.prepare('SELECT id, name, comptaweb_nature FROM categories').all() as Array<{ id: string; name: string; comptaweb_nature: string | null }>;
  for (const c of categories) {
    const target = c.comptaweb_nature ?? c.name;
    const match = findMatch(refs.nature, target);
    if (match) {
      db.prepare('UPDATE categories SET comptaweb_id = ? WHERE id = ?').run(Number(match.value), c.id);
      matched++;
    } else {
      unmatched++;
      unmatchedList.push(`  nature   : ${c.id} ("${target}")`);
    }
  }

  // Activités : match par name.
  const activites = db.prepare('SELECT id, name FROM activites').all() as Array<{ id: string; name: string }>;
  for (const a of activites) {
    const match = findMatch(refs.activite, a.name);
    if (match) {
      db.prepare('UPDATE activites SET comptaweb_id = ? WHERE id = ?').run(Number(match.value), a.id);
      matched++;
    } else {
      unmatched++;
      unmatchedList.push(`  activité : ${a.id} ("${a.name}")`);
    }
  }

  // Unités (branches Comptaweb) : match par name (tolère singulier/pluriel,
  // ex. "Impeesa" local vs "Impeesas" Comptaweb).
  const unites = db.prepare('SELECT id, code, name FROM unites').all() as Array<{ id: string; code: string; name: string }>;
  for (const u of unites) {
    let match = findMatch(refs.brancheprojet, u.name);
    if (!match && !u.name.endsWith('s')) {
      match = findMatch(refs.brancheprojet, u.name + 's');
    }
    if (!match && u.name.endsWith('s')) {
      match = findMatch(refs.brancheprojet, u.name.slice(0, -1));
    }
    if (match) {
      db.prepare('UPDATE unites SET comptaweb_id = ? WHERE id = ?').run(Number(match.value), u.id);
      matched++;
    } else {
      unmatched++;
      unmatchedList.push(`  unité    : ${u.id} (${u.code} "${u.name}")`);
    }
  }

  // Modes de paiement : match par name, avec alias manuels pour les libellés
  // locaux qui ne correspondent pas littéralement à Comptaweb.
  const modeAliases: Record<string, string> = {
    'mp-cb-sgdf': 'Carte procurement',
    'mp-chequier': 'Chèque',
  };
  const modes = db.prepare('SELECT id, name FROM modes_paiement').all() as Array<{ id: string; name: string }>;
  for (const m of modes) {
    const targetLabel = modeAliases[m.id] ?? m.name;
    const match = findMatch(refs.modetransaction, targetLabel);
    if (match) {
      db.prepare('UPDATE modes_paiement SET comptaweb_id = ? WHERE id = ?').run(Number(match.value), m.id);
      matched++;
    } else {
      unmatched++;
      unmatchedList.push(`  mode     : ${m.id} ("${m.name}")`);
    }
  }

  console.log(`\nMapping : ${matched} matchés, ${unmatched} non-matchés.`);
  if (unmatchedList.length) {
    console.log(`\nEntrées sans équivalent Comptaweb :`);
    for (const u of unmatchedList) console.log(u);
    console.log(`\n(Normal pour des valeurs locales comme "CB SGDF" ou "Personnel (avance chef)". Vérifier sinon.)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
