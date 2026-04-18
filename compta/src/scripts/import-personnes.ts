import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface ParsedPersonne {
  prenom: string;
  nom: string | null;
  role_groupe: string | null;
  notes: string | null;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapRole(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('co-responsable de groupe') || t.includes('co-rg')) return 'co-rg';
  if (t.includes('responsable de groupe')) return 'rg';
  if (t.includes('secrétaire principal')) return 'secretaire_principal';
  if (t.includes('secrétaire adjoint')) return 'secretaire_adjoint';
  if (t.includes('trésorier principal') || t.includes('trésorier')) return 'tresorier';
  if (t.includes('cotrésorier')) return 'cotresorier';
  if (t.includes('responsable com')) return 'responsable_com';
  if (t.includes('responsable matos') || t.includes('matos')) return 'responsable_matos';
  if (t.includes('chef') && t.includes('unité')) return 'chef_unite';
  return null;
}

function parsePersonnesMd(raw: string): ParsedPersonne[] {
  const lines = raw.split('\n');
  const out: ParsedPersonne[] = [];
  let current: ParsedPersonne | null = null;
  let currentNotes: string[] = [];

  const flush = () => {
    if (current) {
      current.notes = currentNotes.length ? currentNotes.join('\n').trim() || null : null;
      out.push(current);
    }
    current = null;
    currentNotes = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      flush();
      const raw = headingMatch[1].trim();
      // Ignore les titres placeholder type "[Utilisateur de Baloo]"
      if (raw.startsWith('[')) continue;
      // Sépare "Prénom Nom — rôle" ou "Prénom — rôle"
      const emDash = raw.indexOf(' — ');
      const namePart = emDash !== -1 ? raw.slice(0, emDash).trim() : raw;
      const rolePartRaw = emDash !== -1 ? raw.slice(emDash + 3).trim() : '';
      const nameParts = namePart.split(/\s+/);
      const prenom = nameParts[0];
      const nom = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
      current = {
        prenom,
        nom,
        role_groupe: mapRole(rolePartRaw),
        notes: null,
      };
      continue;
    }
    if (!current) continue;
    const attrMatch = line.match(/^-\s+(?:\*\*)?([^*:]+?)(?:\*\*)?\s*:\s*(.+?)(?:\*\*)?\s*$/);
    if (attrMatch) {
      const key = attrMatch[1].trim().toLowerCase();
      const value = attrMatch[2].trim();
      if (key.startsWith('rôle') || key.startsWith('role')) {
        const r = mapRole(value);
        if (r) current.role_groupe = r;
        continue;
      }
      currentNotes.push(`${key}: ${value}`);
      continue;
    }
    // Ligne non vide hors attribut : l'ajouter aux notes, sauf les séparateurs markdown
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.match(/^-{3,}$/)) {
      currentNotes.push(trimmed);
    }
  }
  flush();
  return out;
}

function main() {
  const path = resolve(REPO_ROOT, 'mon-groupe', 'personnes.md');
  const raw = readFileSync(path, 'utf-8');
  const personnes = parsePersonnesMd(raw);
  const ctx = getCurrentContext();
  const db = getDb();
  const now = currentTimestamp();

  let inserted = 0;
  let skipped = 0;

  for (const p of personnes) {
    const baseId = `per-${slugify(p.prenom)}${p.nom ? `-${slugify(p.nom)}` : ''}`;
    const existing = db
      .prepare('SELECT id FROM personnes WHERE group_id = ? AND prenom = ? AND (nom IS ? OR nom = ?)')
      .get(ctx.groupId, p.prenom, p.nom, p.nom ?? '') as { id: string } | undefined;
    if (existing) {
      console.log(`  . ${existing.id} (déjà présent) ${p.prenom} ${p.nom ?? ''}`);
      skipped++;
      continue;
    }
    db.prepare(
      `INSERT INTO personnes (id, group_id, prenom, nom, role_groupe, statut, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'actif', ?, ?, ?)`
    ).run(baseId, ctx.groupId, p.prenom, p.nom, p.role_groupe, p.notes, now, now);
    console.log(`  + ${baseId} [${p.role_groupe ?? 'sans rôle'}] ${p.prenom} ${p.nom ?? ''}`);
    inserted++;
  }

  console.log(`\nImport terminé : ${inserted} personnes importées, ${skipped} déjà présentes.`);
}

main();
