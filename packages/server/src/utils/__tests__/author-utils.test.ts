import { normalizeAuthorName, splitMultiAuthor } from '../author-utils.js';

describe('normalizeAuthorName', () => {
  it('normalizes initials with missing spaces', () => {
    expect(normalizeAuthorName('J.R.R. Tolkien')).toBe('J. R. R. Tolkien');
  });

  it('already-spaced initials stay the same', () => {
    expect(normalizeAuthorName('J. R. R. Tolkien')).toBe('J. R. R. Tolkien');
  });

  it('flips "Last, First" to "First Last"', () => {
    expect(normalizeAuthorName('Tolkien, J.R.R.')).toBe('J. R. R. Tolkien');
  });

  it('flips simple "Last, First"', () => {
    expect(normalizeAuthorName('Kramer, Michael')).toBe('Michael Kramer');
  });

  it('does not flip multi-word last names', () => {
    // "De la Cruz, Melissa" — "De la Cruz" is multiple words, don't flip
    expect(normalizeAuthorName('De la Cruz, Melissa')).toBe('De la Cruz, Melissa');
  });

  it('collapses whitespace', () => {
    expect(normalizeAuthorName('  Brandon   Sanderson  ')).toBe('Brandon Sanderson');
  });

  it('handles empty string', () => {
    expect(normalizeAuthorName('')).toBe('');
  });
});

describe('splitMultiAuthor', () => {
  it('splits on comma when both sides are person names', () => {
    const result = splitMultiAuthor('Kate Reading, Michael Kramer');
    expect(result).toEqual(['Kate Reading', 'Michael Kramer']);
  });

  it('does not split "Last, First" format', () => {
    const result = splitMultiAuthor('Kramer, Michael');
    expect(result).toEqual(['Kramer, Michael']);
  });

  it('does not split "Tolkien, J.R.R."', () => {
    const result = splitMultiAuthor('Tolkien, J.R.R.');
    expect(result).toEqual(['Tolkien, J.R.R.']);
  });

  it('splits on ampersand', () => {
    const result = splitMultiAuthor('Douglas Preston & Lincoln Child');
    expect(result).toEqual(['Douglas Preston', 'Lincoln Child']);
  });

  it('splits on "and"', () => {
    const result = splitMultiAuthor('James Patterson and Bill Clinton');
    expect(result).toEqual(['James Patterson', 'Bill Clinton']);
  });

  it('splits on slash', () => {
    const result = splitMultiAuthor('Author One / Author Two');
    expect(result).toEqual(['Author One', 'Author Two']);
  });

  it('handles single author', () => {
    const result = splitMultiAuthor('Brandon Sanderson');
    expect(result).toEqual(['Brandon Sanderson']);
  });

  it('handles three comma-separated authors', () => {
    const result = splitMultiAuthor('Kate Reading, Michael Kramer, Tim Gerard Reynolds');
    expect(result).toEqual(['Kate Reading', 'Michael Kramer', 'Tim Gerard Reynolds']);
  });
});
