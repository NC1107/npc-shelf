import { describe, it, expect } from 'vitest';
import { parseFilename } from '../filename-parser.js';

describe('parseFilename', () => {
  it('parses "Author - Title" format', () => {
    const result = parseFilename('Brandon Sanderson - The Way of Kings.epub');
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('The Way of Kings');
  });

  it('detects "Title - Author" format via person-name heuristic', () => {
    const result = parseFilename('Mistborn_ Secret History - Brandon Sanderson.azw3');
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('Mistborn Secret History');
  });

  it('uses directory hint to disambiguate', () => {
    const result = parseFilename(
      'The Way of Kings - Brandon Sanderson.epub',
      '/library/Brandon Sanderson/Stormlight',
    );
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('The Way of Kings');
  });

  it('prefers directory hint over person-name heuristic', () => {
    // Both sides look like person names, but dir confirms the author
    const result = parseFilename(
      'Virginia Woolf - Mrs Dalloway.epub',
      '/library/Virginia Woolf/Novels',
    );
    expect(result.author).toBe('Virginia Woolf');
    expect(result.title).toBe('Mrs Dalloway');
  });

  it('falls back to directory for author when no dash', () => {
    const result = parseFilename('The Way of Kings.epub', '/library/Brandon Sanderson/Books');
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('The Way of Kings');
  });

  it('extracts series info', () => {
    const result = parseFilename('Brandon Sanderson - Mistborn (Mistborn #1).epub');
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('Mistborn');
    expect(result.seriesName).toBe('Mistborn');
    expect(result.seriesPosition).toBe(1);
  });

  it('extracts year', () => {
    const result = parseFilename('Some Book (2023).epub');
    expect(result.title).toBe('Some Book');
    expect(result.year).toBe('2023');
  });

  it('cleans up underscores', () => {
    const result = parseFilename('Some_Book_Title.epub');
    expect(result.title).toBe('Some Book Title');
  });

  it('handles single-word titles without dash', () => {
    const result = parseFilename('Elantris.m4b');
    expect(result.title).toBe('Elantris');
    expect(result.author).toBeNull();
  });
});
