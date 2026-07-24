import { describe, it, expect } from 'vitest';
import {
  validateUploadTotal,
  MAX_UPLOAD_TOTAL_BYTES,
} from '../justif-allowed';

describe('validateUploadTotal', () => {
  it('accepte un cumul sous la limite', () => {
    expect(validateUploadTotal(0)).toBeNull();
    expect(validateUploadTotal(MAX_UPLOAD_TOTAL_BYTES)).toBeNull();
    expect(validateUploadTotal(MAX_UPLOAD_TOTAL_BYTES - 1)).toBeNull();
  });

  it('refuse un cumul au-dessus de la limite, avec un message parlant', () => {
    const msg = validateUploadTotal(MAX_UPLOAD_TOTAL_BYTES + 1);
    expect(msg).not.toBeNull();
    // Le message doit indiquer la taille et rester actionnable.
    expect(msg).toMatch(/Mo/);
    expect(msg!.toLowerCase()).toMatch(/réduis|plusieurs/);
  });

  it('mentionne la taille réelle du cumul dans le message', () => {
    const msg = validateUploadTotal(6 * 1024 * 1024); // 6 Mo
    expect(msg).toContain('6');
  });

  it('la limite reste sous le plafond edge Vercel (~4,5 Mo)', () => {
    expect(MAX_UPLOAD_TOTAL_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});
