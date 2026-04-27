// Import de la todo `mon-groupe/todo.md` dans la table `todos`.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';
import { getCliContext } from './cli-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function parseDueDate(title: string): string | null {
  const match = title.match(/\[(\d{4}-\d{2}-\d{2})\]/);
  return match ? match[1] : null;
}

interface ParsedTodo {
  checked: boolean;
  section: string;
  title: string;
  description: string | null;
  due_date: string | null;
}

function parseTodoMd(raw: string): ParsedTodo[] {
  const lines = raw.split('\n');
  const todos: ParsedTodo[] = [];
  let currentSection = '';
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    const todoMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (!todoMatch) continue;
    const checked = todoMatch[1] === 'x';
    const body = todoMatch[2].trim();
    let title = body;
    let description: string | null = null;
    // Si le début est en gras (**...**), le titre = contenu du gras, le reste = description.
    const boldMatch = body.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (boldMatch) {
      title = boldMatch[1].trim();
      const rest = boldMatch[2].trim();
      if (rest) description = rest.replace(/^—\s*/, '').trim();
    } else {
      // Pas de gras : sépare titre (avant —) et description (après).
      const emDash = body.indexOf(' — ');
      if (emDash !== -1) {
        title = body.slice(0, emDash).trim();
        description = body.slice(emDash + 3).trim();
      }
    }
    todos.push({
      checked,
      section: currentSection,
      title,
      description,
      due_date: parseDueDate(body),
    });
  }
  return todos;
}

function sectionToStatus(
  section: string,
  checked: boolean,
): 'en_cours' | 'bientot' | 'fait' | 'recurrent' {
  if (checked || section.toLowerCase().startsWith('fait')) return 'fait';
  if (section.toLowerCase().startsWith('bientot') || section.toLowerCase().startsWith('bientôt'))
    return 'bientot';
  if (section.toLowerCase().includes('récurrent') || section.toLowerCase().includes('recurrent'))
    return 'recurrent';
  return 'en_cours';
}

function nextTodoId(groupId: string, year: number): string {
  const prefix = `TODO-${year}-`;
  const row = getDb()
    .prepare(`SELECT id FROM todos WHERE group_id = ? AND id LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(groupId, `${prefix}%`) as { id: string } | undefined;
  const next = row ? parseInt(row.id.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function main() {
  const path = resolve(REPO_ROOT, 'mon-groupe', 'todo.md');
  const raw = readFileSync(path, 'utf-8');
  const todos = parseTodoMd(raw);
  const ctx = getCliContext();
  const db = getDb();
  const now = currentTimestamp();
  const year = new Date().getFullYear();

  let inserted = 0;
  let skipped = 0;

  for (const todo of todos) {
    const status = sectionToStatus(todo.section, todo.checked);
    const existing = db
      .prepare('SELECT id FROM todos WHERE group_id = ? AND title = ?')
      .get(ctx.groupId, todo.title);
    if (existing) {
      skipped++;
      continue;
    }
    const id = nextTodoId(ctx.groupId, year);
    db.prepare(
      `INSERT INTO todos (id, group_id, user_id, title, description, status, due_date, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ctx.groupId,
      ctx.userId,
      todo.title,
      todo.description,
      status,
      todo.due_date,
      status === 'fait' ? now : null,
      now,
      now,
    );
    console.log(`  + ${id} [${status}] ${todo.title}`);
    inserted++;
  }

  console.log(`\nImport terminé : ${inserted} tâches importées, ${skipped} déjà présentes (ignorées).`);
}

main();
