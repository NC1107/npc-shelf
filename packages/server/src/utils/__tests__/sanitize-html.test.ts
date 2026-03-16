import { sanitizeDescription } from '../sanitize-html.js';

describe('sanitizeDescription', () => {
  it('returns null for empty/null input', () => {
    expect(sanitizeDescription(null)).toBeNull();
    expect(sanitizeDescription(undefined)).toBeNull();
    expect(sanitizeDescription('')).toBeNull();
    expect(sanitizeDescription('   ')).toBeNull();
  });

  it('strips HTML tags and preserves text', () => {
    expect(sanitizeDescription('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('converts block tags to newlines', () => {
    const result = sanitizeDescription('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(result).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('handles <br> tags', () => {
    expect(sanitizeDescription('Line one.<br/>Line two.')).toBe('Line one.\nLine two.');
    expect(sanitizeDescription('Line one.<br>Line two.')).toBe('Line one.\nLine two.');
  });

  it('decodes common HTML entities', () => {
    expect(sanitizeDescription('Tom &amp; Jerry &mdash; a &ldquo;classic&rdquo;'))
      .toBe('Tom & Jerry \u2014 a \u201Cclassic\u201D');
  });

  it('decodes numeric entities', () => {
    expect(sanitizeDescription('&#8212; dash &#x2014; dash')).toBe('\u2014 dash \u2014 dash');
  });

  it('collapses excessive whitespace', () => {
    expect(sanitizeDescription('  too   many    spaces  ')).toBe('too many spaces');
  });

  it('collapses excessive newlines', () => {
    const result = sanitizeDescription('<p>A</p><p></p><p></p><p></p><p>B</p>');
    // Multiple empty paragraphs shouldn't create more than a double newline
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('handles real Hardcover HTML descriptions', () => {
    const html = `<p><b>The Stormlight Archive</b> saga continues in <i>Rhythm of War</i>, the eagerly awaited sequel to Brandon Sanderson&rsquo;s #1 <i>New York Times</i> bestselling <i>Oathbringer</i>.</p><p>After forming a coalition of human resistance against the enemy invasion, Dalinar Kholin and his Knights Radiant have spent a year fighting a protracted, brutal war.</p>`;
    const result = sanitizeDescription(html);
    expect(result).not.toMatch(/<[^>]+>/);
    expect(result).toContain('Rhythm of War');
    expect(result).toContain('\u2019'); // decoded rsquo
    expect(result).toContain('\n'); // paragraph break preserved
  });

  it('passes through plain text unchanged', () => {
    expect(sanitizeDescription('Just a normal description.')).toBe('Just a normal description.');
  });
});
