import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface NotesContext {
  groupId: string;
  userId: string;
}

export interface Note {
  id: string;
  group_id: string;
  user_id: string | null;
  topic: string;
  title: string | null;
  content_md: string;
  created_at: string;
  updated_at: string;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function nextNoteId(groupId: string, topic: string, title: string | null): string {
  const base = `note-${slugify(topic)}-${slugify(title ?? 'sans-titre')}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notes WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export interface ListNotesOptions {
  topic?: string;
  user_only?: boolean;
}

export function listNotes(
  { groupId, userId }: NotesContext,
  options: ListNotesOptions = {},
): Note[] {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.topic) { conditions.push('topic = ?'); values.push(options.topic); }
  if (options.user_only) { conditions.push('user_id = ?'); values.push(userId); }

  return getDb().prepare(
    `SELECT id, group_id, user_id, topic, title, content_md, created_at, updated_at
     FROM notes WHERE ${conditions.join(' AND ')}
     ORDER BY topic, title, updated_at DESC`,
  ).all(...values) as Note[];
}

export interface CreateNoteInput {
  topic: string;
  title?: string | null;
  content_md: string;
  shared?: boolean;
}

export function createNote(
  { groupId, userId }: NotesContext,
  input: CreateNoteInput,
): Note {
  const id = nextNoteId(groupId, input.topic, input.title ?? null);
  const now = currentTimestamp();
  const ownerId = input.shared ? null : userId;

  getDb().prepare(
    `INSERT INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, ownerId, input.topic, input.title ?? null, input.content_md, now, now);

  return getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Note;
}

export interface UpdateNoteInput {
  topic?: string;
  title?: string | null;
  content_md?: string;
}

export function updateNote(
  { groupId }: NotesContext,
  id: string,
  patch: UpdateNoteInput,
): Note | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.topic !== undefined) { fields.push('topic = ?'); values.push(patch.topic); }
  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.content_md !== undefined) { fields.push('content_md = ?'); values.push(patch.content_md); }

  if (fields.length === 0) {
    return getDb().prepare('SELECT * FROM notes WHERE id = ? AND group_id = ?').get(id, groupId) as Note | null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Note;
}

export function deleteNote({ groupId }: NotesContext, id: string): boolean {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ? AND group_id = ?').run(id, groupId);
  return result.changes > 0;
}
