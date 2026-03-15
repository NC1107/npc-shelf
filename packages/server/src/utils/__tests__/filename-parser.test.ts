import { describe, it, expect } from 'vitest';
import { parseFilename, cleanTitle, parseFilenameEnhanced } from '../filename-parser.js';

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

describe('cleanTitle', () => {
  it('strips format suffixes', () => {
    expect(cleanTitle('Guns (azw3)')).toBe('Guns');
    expect(cleanTitle('Chapter Six (epub)')).toBe('Chapter Six');
    expect(cleanTitle('Some Book (mobi)')).toBe('Some Book');
  });

  it('strips (retail) and (US) artifacts', () => {
    expect(cleanTitle('Fragile Things (retail) (azw3)')).toBe('Fragile Things');
    expect(cleanTitle('Dodger (US) (retail) (azw3)')).toBe('Dodger');
  });

  it('strips [Series NN] - prefix', () => {
    expect(cleanTitle('[Mistborn 01] - Mistborn-The Final Empire (retail) (azw3)')).toBe('Mistborn-The Final Empire');
  });

  it('strips year prefix', () => {
    expect(cleanTitle('(1941) The Forgotten Village')).toBe('The Forgotten Village');
  });

  it('strips version tags', () => {
    expect(cleanTitle('Some Book (v5.0)')).toBe('Some Book');
  });

  it('returns original if cleaning would empty it', () => {
    expect(cleanTitle('(azw3)')).toBe('(azw3)');
  });

  it('leaves clean titles unchanged', () => {
    expect(cleanTitle('Animal Farm')).toBe('Animal Farm');
    expect(cleanTitle('The Way of Kings')).toBe('The Way of Kings');
  });
});

describe('parseFilename — dot-separated names', () => {
  it('converts dots to spaces and splits author-title', () => {
    const result = parseFilename(
      'George.Orwell-George.Orwell.A.Life.In.Letters.2011.RETAIL.EPUB.eBook-CTO.epub',
    );
    expect(result.author).toBe('George Orwell');
    expect(result.title).toMatch(/George Orwell A Life In Letters/);
  });

  it('converts dots for simple author-title pattern', () => {
    const result = parseFilename(
      'Brandon.Sanderson-The.Way.of.Kings.epub',
    );
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('The Way of Kings');
  });

  it('leaves filenames with spaces unchanged', () => {
    const result = parseFilename('Brandon Sanderson - The Way of Kings.epub');
    expect(result.author).toBe('Brandon Sanderson');
    expect(result.title).toBe('The Way of Kings');
  });
});

describe('cleanTitle — scene tags', () => {
  it('strips eBook-XXX scene group tags', () => {
    expect(cleanTitle('George Orwell A Life In Letters 2011 RETAIL EPUB eBook-CTO')).toBe(
      'George Orwell A Life In Letters 2011',
    );
  });

  it('strips standalone RETAIL/EPUB/etc words', () => {
    expect(cleanTitle('Some Book RETAIL EPUB')).toBe('Some Book');
  });

  it('does not strip format words inside parentheses (handled separately)', () => {
    expect(cleanTitle('Some Book (epub)')).toBe('Some Book');
  });
});

describe('parseFilenameEnhanced', () => {
  it('extracts series from bracket prefix', () => {
    const result = parseFilenameEnhanced({
      filename: '[Mistborn 01] - The Final Empire (retail) (azw3).azw3',
      extension: 'azw3',
    });
    expect(result.series).toBe('Mistborn');
    expect(result.seriesPosition).toBe(1);
    expect(result.title).toBe('The Final Empire');
  });

  it('cleans format suffix from title', () => {
    const result = parseFilenameEnhanced({
      filename: 'Guns (azw3).azw3',
      extension: 'azw3',
    });
    expect(result.title).toBe('Guns');
  });
});
