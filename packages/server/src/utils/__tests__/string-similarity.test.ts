import { describe, it, expect } from 'vitest';
import {
  stringSimilarity,
  jaroWinkler,
  tokenSortRatio,
  bigramJaccard,
  normalizeForComparison,
} from '../string-similarity.js';

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('Dune', 'Dune')).toBe(1);
    expect(stringSimilarity('1984', '1984')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(stringSimilarity('', 'test')).toBe(0);
    expect(stringSimilarity('test', '')).toBe(0);
  });

  it('handles short titles well (dispatches to Jaro-Winkler)', () => {
    // "It" vs "It" — exact match
    expect(stringSimilarity('It', 'It')).toBe(1);
    // "Dune" vs "Dune" — exact after normalization
    expect(stringSimilarity('Dune', 'dune')).toBe(1);
    // Short but different
    expect(stringSimilarity('Dune', 'Done')).toBeGreaterThan(0.7);
    // Completely different short strings
    expect(stringSimilarity('It', 'War')).toBeLessThan(0.5);
  });

  it('uses Jaro-Winkler for strings where shorter normalized < 8 chars', () => {
    // "1984" normalized is "1984" (4 chars < 8)
    expect(stringSimilarity('1984', '1984')).toBe(1);
    // 7 char string still uses Jaro-Winkler
    expect(stringSimilarity('Warlock', 'Warlock')).toBe(1);
  });

  it('uses max(bigram, tokenSort) for longer strings', () => {
    // 8+ chars after normalization → bigram/tokenSort
    const score = stringSimilarity('The Way of Kings', 'Way of Kings');
    expect(score).toBeGreaterThan(0.7);
  });

  it('handles token sort: word order differences', () => {
    const score = stringSimilarity('The Final Empire', 'Final Empire The');
    expect(score).toBeGreaterThan(0.8);
  });

  it('handles accent folding', () => {
    expect(stringSimilarity('Les Misérables', 'Les Miserables')).toBe(1);
    expect(stringSimilarity('Gödelʼs Proof', 'Godels Proof')).toBeGreaterThan(0.9);
  });

  it('normalizes & to and', () => {
    expect(stringSimilarity('Pride & Prejudice', 'Pride and Prejudice')).toBe(1);
  });

  it('long string similarity unchanged for good matches', () => {
    const score = stringSimilarity('Rhythm of War', 'Rhythm of War');
    expect(score).toBe(1);
  });

  it('penalizes different long strings', () => {
    const score = stringSimilarity('Rhythm of War', 'White Sand Omnibus');
    expect(score).toBeLessThan(0.3);
  });
});

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('dune', 'dune')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('rewards common prefix', () => {
    const withPrefix = jaroWinkler('martha', 'marhta');
    expect(withPrefix).toBeGreaterThan(0.9);
  });

  it('handles single character strings', () => {
    expect(jaroWinkler('a', 'a')).toBe(1);
    expect(jaroWinkler('a', 'b')).toBe(0);
  });
});

describe('tokenSortRatio', () => {
  it('handles word reordering', () => {
    const score = tokenSortRatio('final empire the', 'the final empire');
    expect(score).toBe(1);
  });

  it('handles subset with extra words', () => {
    const score = tokenSortRatio('city new york', 'new york city');
    expect(score).toBe(1);
  });
});

describe('bigramJaccard', () => {
  it('returns 1 for identical strings', () => {
    expect(bigramJaccard('test', 'test')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(bigramJaccard('ab', 'cd')).toBe(0);
  });

  it('applies length penalty for very different lengths', () => {
    const score = bigramJaccard('it', 'it: a novel by stephen king');
    expect(score).toBeLessThan(0.5);
  });
});

describe('normalizeForComparison', () => {
  it('lowercases', () => {
    expect(normalizeForComparison('HELLO')).toBe('hello');
  });

  it('removes leading articles', () => {
    expect(normalizeForComparison('The Way of Kings')).toBe('way of kings');
    expect(normalizeForComparison('A Tale of Two Cities')).toBe('tale of two cities');
    expect(normalizeForComparison('An Example')).toBe('example');
  });

  it('folds accents', () => {
    expect(normalizeForComparison('Les Misérables')).toBe('les miserables');
    expect(normalizeForComparison('naïve')).toBe('naive');
    expect(normalizeForComparison('über')).toBe('uber');
  });

  it('normalizes & to and', () => {
    expect(normalizeForComparison('Pride & Prejudice')).toBe('pride and prejudice');
  });

  it('strips punctuation', () => {
    expect(normalizeForComparison("Harry Potter: The Philosopher's Stone")).toBe('harry potter the philosophers stone');
  });

  it('applies NFKC normalization', () => {
    // ﬁ ligature → fi
    expect(normalizeForComparison('ﬁction')).toBe('fiction');
  });
});
