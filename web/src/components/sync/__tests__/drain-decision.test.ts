import { describe, it, expect } from 'vitest';
import { shouldDrainAgain, MAX_NO_PROGRESS } from '../drain-decision';

describe('shouldDrainAgain', () => {
  it('draine tant que remaining décroît', () => {
    expect(shouldDrainAgain(null, 8, 0)).toEqual({ drain: true, noProgress: 0 });
    expect(shouldDrainAgain(8, 3, 0)).toEqual({ drain: true, noProgress: 0 });
  });

  it('s’arrête quand remaining atteint 0', () => {
    expect(shouldDrainAgain(3, 0, 0)).toEqual({ drain: false, noProgress: 0 });
  });

  it('compte les cycles sans progrès et stoppe au seuil', () => {
    // remaining stagne à 5 : 1er sans progrès → continue, 2e → stop
    const a = shouldDrainAgain(5, 5, 0);
    expect(a).toEqual({ drain: true, noProgress: 1 });
    const b = shouldDrainAgain(5, 5, a.noProgress);
    expect(b).toEqual({ drain: false, noProgress: 2 });
    expect(MAX_NO_PROGRESS).toBe(2);
  });

  it('remet le compteur à zéro dès qu’un progrès reprend', () => {
    expect(shouldDrainAgain(5, 4, 1)).toEqual({ drain: true, noProgress: 0 });
  });
});
