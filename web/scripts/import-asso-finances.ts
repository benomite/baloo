// Import des fichiers `mon-groupe/asso.md` et `mon-groupe/finances.md` :
// chaque section ## devient une note (topic 'asso' ou 'finances'), la
// section "Identité" met à jour le groupe, et la section "Budget 2025-2026"
// crée un budget vierge.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';
import { getCliContext } from './cli-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function splitMdByH2(raw: string): { preamble: string; sections: { title: string; content: string }[] } {
  const lines = raw.split('\n');
  const preambleLines: string[] = [];
  const sections: { title: string; content: string[] }[] = [];
  let current: { title: string; content: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1].trim(), content: [] };
      continue;
    }
    if (current) current.content.push(line);
    else preambleLines.push(line);
  }
  if (current) sections.push(current);
  return {
    preamble: preambleLines.join('\n').trim(),
    sections: sections.map((s) => ({ title: s.title, content: s.content.join('\n').trim() })),
  };
}

function extractEmailFromText(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

async function main() {
  const ctx = await getCliContext();
  const db = getDb();
  const now = currentTimestamp();

  // --- asso.md ---
  const assoPath = resolve(REPO_ROOT, 'mon-groupe', 'asso.md');
  if (existsSync(assoPath)) {
    const raw = readFileSync(assoPath, 'utf-8');
    const { sections } = splitMdByH2(raw);

    // Met à jour le groupe avec les infos trouvées dans la section "Identité"
    const identite = sections.find((s) => s.title.toLowerCase() === 'identité');
    if (identite) {
      const email = extractEmailFromText(identite.content.match(/Contact trésorerie[^\n]*/i)?.[0] ?? '');
      const territoire = identite.content.match(/Territoire SGDF de rattachement[^\n]*/i)?.[0]
        ?.match(/\*\*([^*]+)\*\*/)?.[1] ?? null;
      await db.prepare(
        `UPDATE groupes SET email_contact = COALESCE(?, email_contact), territoire = COALESCE(?, territoire), updated_at = ? WHERE id = ?`,
      ).run(email, territoire, now, ctx.groupId);
      console.log(`  ~ groupe ${ctx.groupId} : email=${email ?? '(inchangé)'}, territoire=${territoire ?? '(inchangé)'}`);
    }

    // Chaque section ≠ "Identité" devient une note topic='asso'
    for (const s of sections) {
      if (s.title.toLowerCase() === 'identité') continue;
      if (!s.content) continue;
      const id = `note-asso-${s.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)}`;
      await db.prepare(
        `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
         VALUES (?, ?, NULL, 'asso', ?, ?, ?, ?)`,
      ).run(id, ctx.groupId, s.title, s.content, now, now);
      console.log(`  + note ${id}`);
    }
  }

  // --- finances.md ---
  const finPath = resolve(REPO_ROOT, 'mon-groupe', 'finances.md');
  if (existsSync(finPath)) {
    const raw = readFileSync(finPath, 'utf-8');
    const { preamble, sections } = splitMdByH2(raw);

    // Préambule → note
    if (preamble) {
      await db.prepare(
        `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
         VALUES (?, ?, NULL, 'finances', 'Préambule et rappels', ?, ?, ?)`,
      ).run(`note-finances-preambule`, ctx.groupId, preamble, now, now);
      console.log(`  + note note-finances-preambule`);
    }

    // Crée le budget 2025-2026 s'il n'existe pas, avec les notes du poste budget
    const budget2526 = sections.find((s) => /budget.*2025-2026/i.test(s.title));
    if (budget2526) {
      const bdgId = `bdg-${ctx.groupId}-2025-2026`;
      await db.prepare(
        `INSERT OR IGNORE INTO budgets (id, group_id, saison, statut, notes, created_at, updated_at)
         VALUES (?, ?, '2025-2026', 'vote', ?, ?, ?)`,
      ).run(bdgId, ctx.groupId, budget2526.content, now, now);
      console.log(`  + budget ${bdgId} (contenu à raffiner en budget_lignes manuellement)`);
    }

    // Autres sections finances → notes
    for (const s of sections) {
      if (/budget.*2025-2026/i.test(s.title)) continue;
      if (!s.content) continue;
      const slug = s.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      const id = `note-finances-${slug}`;
      await db.prepare(
        `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
         VALUES (?, ?, NULL, 'finances', ?, ?, ?, ?)`,
      ).run(id, ctx.groupId, s.title, s.content, now, now);
      console.log(`  + note ${id}`);
    }
  }

  console.log(`\nImport terminé.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
