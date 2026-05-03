import { describe, it, expect } from 'vitest';
import {
  describeAbandonStatus,
  describeRembsStatus,
} from './status-descriptions';

describe('describeRembsStatus', () => {
  it('décrit a_traiter comme en attente du trésorier', () => {
    const r = describeRembsStatus('a_traiter');
    expect(r.text).toMatch(/trésorier/i);
    expect(r.text).toMatch(/attente/i);
    expect(r.actionRequired).toBeUndefined();
  });

  it('décrit valide_tresorier en mentionnant le RG', () => {
    const r = describeRembsStatus('valide_tresorier');
    expect(r.text).toMatch(/trésorier/i);
    expect(r.text).toMatch(/RG/i);
  });

  it('décrit valide_rg en mentionnant le virement', () => {
    const r = describeRembsStatus('valide_rg');
    expect(r.text).toMatch(/virement/i);
  });

  it('décrit virement_effectue comme positif', () => {
    const r = describeRembsStatus('virement_effectue');
    expect(r.text).toMatch(/virement/i);
  });

  it('décrit termine et refuse comme finaux (pas d action)', () => {
    expect(describeRembsStatus('termine').actionRequired).toBeUndefined();
    expect(describeRembsStatus('refuse').actionRequired).toBeUndefined();
    expect(describeRembsStatus('refuse').text).toMatch(/refus/i);
  });

  it('renvoie le status brut pour un status inconnu', () => {
    const r = describeRembsStatus('foo_bar');
    expect(r.text).toBe('foo_bar');
  });
});

describe('describeAbandonStatus', () => {
  it('décrit a_traiter comme en attente du trésorier', () => {
    const r = describeAbandonStatus('a_traiter', false);
    expect(r.text).toMatch(/trésorier/i);
  });

  it('décrit valide en mentionnant le national', () => {
    const r = describeAbandonStatus('valide', false);
    expect(r.text).toMatch(/national/i);
  });

  it('envoye_national + cerfa non émis = en attente du CERFA', () => {
    const r = describeAbandonStatus('envoye_national', false);
    expect(r.text).toMatch(/CERFA/);
    expect(r.text).toMatch(/arrivera|attendant|attente/i);
    // pas d'engagement de délai (cf. règle "pas d engagements")
    expect(r.text).not.toMatch(/3 mois|semaines|jours/);
  });

  it('envoye_national + cerfa émis = mention art 200 CGI', () => {
    const r = describeAbandonStatus('envoye_national', true);
    expect(r.text).toMatch(/CERFA reçu|reçu/i);
    expect(r.text).toMatch(/200|CGI/);
  });

  it('décrit refuse simplement', () => {
    const r = describeAbandonStatus('refuse', false);
    expect(r.text).toMatch(/refus/i);
  });
});
