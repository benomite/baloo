import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerNoteTools } from '../notes';

const FAKE = {
  id: 'note-asso-rg',
  group_id: 'g-test',
  user_id: null,
  topic: 'asso',
  title: 'Co-RG',
  content_md: '# RG du groupe',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

vi.mock('@/lib/services/notes', () => ({
  listNotes: vi.fn(async () => [FAKE]),
  createNote: vi.fn(async () => FAKE),
  updateNote: vi.fn(async () => FAKE),
  deleteNote: vi.fn(async () => true),
}));

describe('notes tools (Vague 2)', () => {
  const tools = captureTools(registerNoteTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose list/create/update/delete_note', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_note',
      'delete_note',
      'list_notes',
      'update_note',
    ]);
  });

  it('list_notes retourne un JSON parsable', async () => {
    const r = await tools.list_notes.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('note-asso-rg');
  });

  it('create_note confirme la création', async () => {
    const r = await tools.create_note.handler({ topic: 'asso', content_md: 'hello' });
    expect(parseToolResult(r) as string).toContain('note-asso-rg');
  });

  it('update_note confirme la mise à jour', async () => {
    const r = await tools.update_note.handler({ id: 'note-asso-rg', title: 'Nouveau titre' });
    expect(parseToolResult(r) as string).toContain('note-asso-rg');
  });

  it('delete_note confirme la suppression', async () => {
    const r = await tools.delete_note.handler({ id: 'note-asso-rg' });
    expect(parseToolResult(r) as string).toContain('supprimée');
  });

  it("delete_note décrit clairement l'usage parcimonieux", () => {
    expect(tools.delete_note.description).toContain('parcimonie');
  });
});
