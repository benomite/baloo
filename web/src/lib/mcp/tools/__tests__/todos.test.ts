import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerTodoTools } from '../todos';

const FAKE = {
  id: 'TODO-2026-001',
  group_id: 'g-test',
  user_id: 'u-test',
  title: 'Préparer AG',
  description: null,
  status: 'en_cours',
  due_date: '2026-06-01',
  completed_at: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

vi.mock('@/lib/services/todos', () => ({
  TODO_STATUSES: ['en_cours', 'bientot', 'fait', 'annule', 'recurrent'] as const,
  listTodos: vi.fn(async () => [FAKE]),
  createTodo: vi.fn(async () => FAKE),
  completeTodo: vi.fn(async () => ({ ...FAKE, status: 'fait' })),
  updateTodo: vi.fn(async () => FAKE),
}));

describe('todos tools (Vague 2)', () => {
  const tools = captureTools(registerTodoTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'complete_todo',
      'create_todo',
      'list_todos',
      'update_todo',
    ]);
  });

  it('list_todos retourne un JSON parsable', async () => {
    const r = await tools.list_todos.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('TODO-2026-001');
  });

  it('create_todo confirme la création', async () => {
    const r = await tools.create_todo.handler({ title: 'Préparer AG' });
    expect(parseToolResult(r) as string).toContain('TODO-2026-001');
  });

  it('complete_todo confirme', async () => {
    const r = await tools.complete_todo.handler({ id: 'TODO-2026-001' });
    expect(parseToolResult(r) as string).toContain('cochée');
  });

  it('update_todo confirme', async () => {
    const r = await tools.update_todo.handler({ id: 'TODO-2026-001', status: 'bientot' });
    expect(parseToolResult(r) as string).toContain('mise à jour');
  });
});
