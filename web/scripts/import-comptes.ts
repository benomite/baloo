// Import des comptes bancaires depuis `mon-groupe/comptes.md`.
// Chaque sous-section ### sous une H2 "Comptes bancaires"/"Livrets"/"Caisse"
// devient une ligne `comptes_bancaires`. Les sections narratives deviennent
// des notes topic='comptes'.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';
import { getCliContext } from './cli-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface ParsedAttr { key: string; value: string; }

interface ParsedCompte {
  titre: string;
  attrs: ParsedAttr[];
  notesLines: string[];
}

interface ParsedSection {
  kind: 'compte' | 'section';
  title: string;
  comptes: ParsedCompte[];
  rawMd: string[];
}

function parseMd(raw: string): { sections: ParsedSection[]; preamble: string[] } {
  const lines = raw.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let currentCompte: ParsedCompte | null = null;
  const preamble: string[] = [];

  const flushCompte = () => {
    if (currentCompte && currentSection) {
      currentSection.comptes.push(currentCompte);
      currentCompte = null;
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);

    if (h2) {
      flushCompte();
      const title = h2[1].trim();
      currentSection = {
        kind:
          title.toLowerCase().startsWith('comptes bancaires') ||
          title.toLowerCase().startsWith('livrets') ||
          title.toLowerCase().startsWith('caisse')
            ? 'compte'
            : 'section',
        title,
        comptes: [],
        rawMd: [],
      };
      sections.push(currentSection);
      continue;
    }

    if (h3 && currentSection && currentSection.kind === 'compte') {
      flushCompte();
      currentCompte = { titre: h3[1].trim(), attrs: [], notesLines: [] };
      continue;
    }

    if (currentCompte) {
      const attrMatch = line.match(/^-\s+\*\*([^*:]+?)\*\*\s*:\s*(.+?)\s*$/);
      if (attrMatch) {
        currentCompte.attrs.push({ key: attrMatch[1].trim(), value: attrMatch[2].trim() });
        continue;
      }
      const trimmed = line.trim();
      if (trimmed && !trimmed.match(/^-{3,}$/) && !trimmed.startsWith('#')) {
        currentCompte.notesLines.push(trimmed);
      }
      continue;
    }

    if (currentSection) {
      currentSection.rawMd.push(line);
      continue;
    }

    preamble.push(line);
  }
  flushCompte();
  return { sections, preamble };
}

function mapAttrToColumn(key: string, value: string): Partial<Record<string, string>> {
  const k = key.toLowerCase();
  if (k === 'banque') return { banque: value };
  if (k === 'iban') return { iban: value.replace(/\s/g, '') };
  if (k === 'bic') return { bic: value };
  if (k === 'type') {
    const v = value.toLowerCase();
    if (v.includes('courant')) return { type_compte: 'courant' };
    if (v.includes('livret')) return { type_compte: 'livret' };
    if (v.includes('caisse')) return { type_compte: 'caisse' };
    return { type_compte: 'autre' };
  }
  return {};
}

function attrsToNotes(attrs: ParsedAttr[]): string {
  const lines: string[] = [];
  for (const attr of attrs) {
    const k = attr.key.toLowerCase();
    if (k === 'banque' || k === 'iban' || k === 'bic' || k === 'type') continue;
    lines.push(`- **${attr.key}** : ${attr.value}`);
  }
  return lines.join('\n');
}

async function main() {
  const path = resolve(REPO_ROOT, 'mon-groupe', 'comptes.md');
  const raw = readFileSync(path, 'utf-8');
  const { sections, preamble } = parseMd(raw);
  const ctx = await getCliContext();
  const db = getDb();
  const now = currentTimestamp();

  let comptesInserted = 0;
  let notesInserted = 0;

  // Préambule = note topique 'comptes' au niveau groupe
  const preambleText = preamble.join('\n').trim();
  if (preambleText) {
    const id = `note-comptes-preambule`;
    await db.prepare(
      `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
       VALUES (?, ?, NULL, 'comptes', 'Préambule et contexte', ?, ?, ?)`,
    ).run(id, ctx.groupId, preambleText, now, now);
    notesInserted++;
    console.log(`  + note ${id}`);
  }

  for (const section of sections) {
    if (section.kind === 'compte') {
      for (const c of section.comptes) {
        // Extraire le code/nom à partir du titre "Compte principal — BNP" ou similaire
        const titre = c.titre;
        const emDash = titre.indexOf(' — ');
        const nom = titre;
        const code = slugify(emDash !== -1 ? titre.slice(emDash + 3) : titre);
        const mapped: Record<string, string> = {};
        for (const attr of c.attrs) {
          Object.assign(mapped, mapAttrToColumn(attr.key, attr.value));
        }
        const extraNotes = attrsToNotes(c.attrs);
        const freeNotes = c.notesLines.filter((l) => !l.startsWith('> ')).join('\n').trim();
        const hints = c.notesLines.filter((l) => l.startsWith('> ')).join('\n').trim();
        const notesFull = [extraNotes, freeNotes, hints].filter(Boolean).join('\n\n');

        const id = `cpt-${code || 'compte'}`;
        await db.prepare(
          `INSERT OR REPLACE INTO comptes_bancaires (id, group_id, code, nom, banque, iban, bic, type_compte, statut, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?)`,
        ).run(
          id,
          ctx.groupId,
          code,
          nom,
          mapped.banque ?? null,
          mapped.iban ?? null,
          mapped.bic ?? null,
          mapped.type_compte ?? null,
          notesFull || null,
          now,
          now,
        );
        comptesInserted++;
        console.log(`  + compte ${id} : ${nom}`);
      }
    } else {
      // Section narrative → une note
      const content = section.rawMd.join('\n').trim();
      if (!content) continue;
      const id = `note-comptes-${slugify(section.title)}`;
      await db.prepare(
        `INSERT OR REPLACE INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
         VALUES (?, ?, NULL, 'comptes', ?, ?, ?, ?)`,
      ).run(id, ctx.groupId, section.title, content, now, now);
      notesInserted++;
      console.log(`  + note ${id} : ${section.title}`);
    }
  }

  console.log(`\nImport terminé : ${comptesInserted} comptes, ${notesInserted} notes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
