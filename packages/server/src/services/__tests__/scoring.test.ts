import { describe, it, expect } from 'vitest';
import { scoreResult } from '../metadata-pipeline.js';
import type { MetadataSearchResult } from '@npc-shelf/shared';
import type { ScoringContext } from '../metadata-pipeline.js';

function makeResult(overrides: Partial<MetadataSearchResult> = {}): MetadataSearchResult {
  return {
    externalId: '123',
    title: 'Test Book',
    subtitle: null,
    authors: ['Test Author'],
    description: null,
    coverUrl: null,
    publishDate: null,
    isbn13: null,
    pageCount: null,
    isbn10: null,
    tags: null,
    series: null,
    seriesPosition: null,
    slug: null,
    allSeries: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    localTitle: 'Test Book',
    localAuthor: 'Test Author',
    localSeries: null,
    localSeriesPosition: null,
    directoryAuthor: null,
    isAudiobook: false,
    ...overrides,
  };
}

describe('scoreResult', () => {
  it('perfect match scores close to 100', () => {
    const result = makeResult({ title: 'Rhythm of War', authors: ['Brandon Sanderson'], series: 'The Stormlight Archive', seriesPosition: 4 });
    const ctx = makeContext({ localTitle: 'Rhythm of War', localAuthor: 'Brandon Sanderson', localSeries: 'The Stormlight Archive', localSeriesPosition: 4 });
    const score = scoreResult(result, ctx);
    expect(score.total).toBeGreaterThanOrEqual(90);
    expect(score.titleScore).toBe(50);
    expect(score.authorScore).toBe(30);
    expect(score.seriesBonus).toBe(10);
    expect(score.indexBonus).toBe(5);
  });

  it('title mismatch with author match scores low', () => {
    const result = makeResult({ title: 'White Sand Omnibus', authors: ['Brandon Sanderson'] });
    const ctx = makeContext({ localTitle: 'Rhythm of War', localAuthor: 'Brandon Sanderson' });
    const score = scoreResult(result, ctx);
    // Title should be very low, author high
    expect(score.titleScore).toBeLessThan(15);
    expect(score.authorScore).toBe(30);
    // Total should be below accept threshold (70)
    expect(score.total).toBeLessThan(70);
  });

  it('author mismatch penalty fires correctly', () => {
    const result = makeResult({ title: 'The Stand', authors: ['Richard Bachman'] });
    const ctx = makeContext({ localTitle: 'The Stand', localAuthor: 'Stephen King' });
    const score = scoreResult(result, ctx);
    expect(score.authorPenalty).toBe(-30);
    expect(score.total).toBeLessThan(score.titleScore + 5);
  });

  it('no penalty when author is close enough', () => {
    const result = makeResult({ title: 'Test', authors: ['J.R.R. Tolkien'] });
    const ctx = makeContext({ localTitle: 'Test', localAuthor: 'JRR Tolkien' });
    const score = scoreResult(result, ctx);
    expect(score.authorPenalty).toBe(0);
  });

  it('series bonus without index', () => {
    const result = makeResult({ title: 'Test', authors: ['Author'], series: 'Mistborn' });
    const ctx = makeContext({ localTitle: 'Test', localAuthor: 'Author', localSeries: 'Mistborn' });
    const score = scoreResult(result, ctx);
    expect(score.seriesBonus).toBe(10);
    expect(score.indexBonus).toBe(0);
  });

  it('series bonus with matching index', () => {
    const result = makeResult({ title: 'Test', authors: ['Author'], series: 'Mistborn', seriesPosition: 3 });
    const ctx = makeContext({ localTitle: 'Test', localAuthor: 'Author', localSeries: 'Mistborn', localSeriesPosition: 3 });
    const score = scoreResult(result, ctx);
    expect(score.seriesBonus).toBe(10);
    expect(score.indexBonus).toBe(5);
  });

  it('directory author bonus', () => {
    const result = makeResult({ title: 'Test', authors: ['Brandon Sanderson'] });
    const ctx = makeContext({ localTitle: 'Test', localAuthor: null, directoryAuthor: 'Brandon Sanderson' });
    const score = scoreResult(result, ctx);
    expect(score.dirAuthorBonus).toBe(5);
  });

  it('no author score when no local author', () => {
    const result = makeResult({ title: 'Test Book', authors: ['Some Author'] });
    const ctx = makeContext({ localTitle: 'Test Book', localAuthor: null });
    const score = scoreResult(result, ctx);
    expect(score.authorScore).toBe(0);
    expect(score.authorPenalty).toBe(0);
  });

  it('total is clamped to 0-100', () => {
    const result = makeResult({ title: 'X', authors: ['Y'] });
    const ctx = makeContext({ localTitle: 'Completely Different Title Here', localAuthor: 'Nobody Like This' });
    const score = scoreResult(result, ctx);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it('completely different titles produce low scores', () => {
    const result = makeResult({ title: 'Zzzzzz Nonsense Title', authors: ['Unknown Person'] });
    const ctx = makeContext({ localTitle: 'Aaaaaa Different Book', localAuthor: 'Someone Else' });
    const score = scoreResult(result, ctx);
    expect(score.total).toBeLessThan(30);
  });
});
