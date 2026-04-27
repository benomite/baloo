import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface TodosContext {
  groupId: string;
  userId: string;
}

export const TODO_STATUSES = ['en_cours', 'bientot', 'fait', 'annule', 'recurrent'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface Todo {
  id: string;
  group_id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  status: TodoStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

async function nextTodoId(groupId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TODO-${year}-`;
  const row = await getDb()
    .prepare('SELECT id FROM todos WHERE group_id = ? AND id LIKE ? ORDER BY id DESC LIMIT 1')
    .get<{ id: string }>(groupId, `${prefix}%`);
  const next = row ? parseInt(row.id.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export interface ListTodosOptions {
  status?: TodoStatus;
  include_fait?: boolean;
}

export async function listTodos(
  { groupId }: TodosContext,
  options: ListTodosOptions = {},
): Promise<Todo[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.status) {
    conditions.push('status = ?');
    values.push(options.status);
  } else if (!options.include_fait) {
    conditions.push("status NOT IN ('fait', 'annule')");
  }

  return await getDb().prepare(
    `SELECT * FROM todos WHERE ${conditions.join(' AND ')}
     ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at`,
  ).all<Todo>(...values);
}

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  status?: TodoStatus;
  due_date?: string | null;
}

export async function createTodo(
  { groupId, userId }: TodosContext,
  input: CreateTodoInput,
): Promise<Todo> {
  const id = await nextTodoId(groupId);
  const now = currentTimestamp();

  await getDb().prepare(
    `INSERT INTO todos (id, group_id, user_id, title, description, status, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    userId,
    input.title,
    input.description ?? null,
    input.status ?? 'en_cours',
    input.due_date ?? null,
    now,
    now,
  );

  return (await getDb().prepare('SELECT * FROM todos WHERE id = ?').get<Todo>(id))!;
}

export async function completeTodo({ groupId }: TodosContext, id: string): Promise<Todo | null> {
  const now = currentTimestamp();
  const result = await getDb().prepare(
    `UPDATE todos SET status = 'fait', completed_at = ?, updated_at = ? WHERE id = ? AND group_id = ?`,
  ).run(now, now, id, groupId);
  if (result.changes === 0) return null;

  return (await getDb().prepare('SELECT * FROM todos WHERE id = ?').get<Todo>(id))!;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string | null;
  status?: TodoStatus;
  due_date?: string | null;
}

export async function updateTodo(
  { groupId }: TodosContext,
  id: string,
  patch: UpdateTodoInput,
): Promise<Todo | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.due_date !== undefined) { fields.push('due_date = ?'); values.push(patch.due_date); }

  if (fields.length === 0) {
    return (await getDb().prepare('SELECT * FROM todos WHERE id = ? AND group_id = ?').get<Todo>(id, groupId)) ?? null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getDb().prepare('SELECT * FROM todos WHERE id = ?').get<Todo>(id))!;
}
