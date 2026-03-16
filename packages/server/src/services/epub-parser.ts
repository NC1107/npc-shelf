import fs from 'node:fs';
import JSZip from 'jszip';

export interface EpubMetadata {
  title: string;
  creators: { name: string; role: string }[];
  language: string | null;
  publisher: string | null;
  date: string | null;
  description: string | null;
  isbn: string | null;
  subjects: string[];
  coverImage: Buffer | null;
}

export async function parseEpub(filePath: string): Promise<EpubMetadata> {
  const result: EpubMetadata = {
    title: '',
    creators: [],
    language: null,
    publisher: null,
    date: null,
    description: null,
    isbn: null,
    subjects: [],
    coverImage: null,
  };

  try {
    const data = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(data);
    const opf = await findOpfContent(zip);
    if (!opf) return result;

    const { opfContent, opfDir } = opf;

    extractMetadataFields(opfContent, result);
    extractCreators(opfContent, result);
    result.coverImage = await extractCoverImage(opfContent, opfDir, zip);
  } catch (err) {
    console.error(`[EpubParser] Error parsing ${filePath}:`, err);
  }

  return result;
}

async function findOpfContent(zip: JSZip): Promise<{ opfContent: string; opfDir: string } | null> {
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) return null;

  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfPathMatch) return null;

  const opfPath = opfPathMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfContent = await zip.file(opfPath)?.async('text');
  if (!opfContent) return null;

  return { opfContent, opfDir };
}

function extractCreators(opfContent: string, result: EpubMetadata): void {
  const creatorRegex = /<dc:creator[^>]{0,200}>([^<]+)<\/dc:creator>/gi;
  const roleRegex = /<dc:creator[^>]{0,200}opf:role="([^"]{0,50})"[^>]{0,200}>([^<]+)<\/dc:creator>/gi;

  let match: RegExpExecArray | null;
  const roleMatches = new Set<string>();
  while ((match = roleRegex.exec(opfContent)) !== null) {
    const role = mapOpfRole(match[1]);
    const name = decodeEntities(match[2].trim());
    result.creators.push({ name, role });
    roleMatches.add(name);
  }

  if (result.creators.length === 0) {
    while ((match = creatorRegex.exec(opfContent)) !== null) {
      const name = decodeEntities(match[1].trim());
      if (!roleMatches.has(name)) {
        result.creators.push({ name, role: 'author' });
      }
    }
  }
}

function extractMetadataFields(opfContent: string, result: EpubMetadata): void {
  const titleMatch = /<dc:title[^>]{0,200}>([^<]+)<\/dc:title>/i.exec(opfContent);
  if (titleMatch) result.title = decodeEntities(titleMatch[1].trim());

  const langMatch = /<dc:language[^>]{0,200}>([^<]+)<\/dc:language>/i.exec(opfContent);
  if (langMatch) result.language = langMatch[1].trim();

  const pubMatch = /<dc:publisher[^>]{0,200}>([^<]+)<\/dc:publisher>/i.exec(opfContent);
  if (pubMatch) result.publisher = decodeEntities(pubMatch[1].trim());

  const dateMatch = /<dc:date[^>]{0,200}>([^<]+)<\/dc:date>/i.exec(opfContent);
  if (dateMatch) result.date = dateMatch[1].trim();

  // Description — use indexOf/slice instead of [\s\S]*? to avoid ReDoS
  const descStart = opfContent.search(/<dc:description[^>]{0,100}>/i);
  if (descStart !== -1) {
    const tagEnd = opfContent.indexOf('>', descStart) + 1;
    const closeIdx = opfContent.indexOf('</dc:description>', tagEnd);
    if (closeIdx !== -1) {
      result.description = decodeEntities(opfContent.slice(tagEnd, closeIdx).trim().replaceAll(/<[^>]{1,1000}>/g, ''));
    }
  }

  // ISBN
  const identRegex = /<dc:identifier[^>]{0,200}>([^<]+)<\/dc:identifier>/gi;
  let match: RegExpExecArray | null;
  while ((match = identRegex.exec(opfContent)) !== null) {
    const fullTag = match[0];
    const value = match[1].trim();
    const isIsbn = /isbn/i.test(fullTag) || /^(97[89])?\d{9}[\dXx]$/.test(value.replaceAll(/[-\s]/g, ''));
    if (isIsbn) {
      result.isbn = value.replaceAll(/[-\s]/g, '');
      break;
    }
  }

  // Subjects
  const subjectRegex = /<dc:subject[^>]{0,200}>([^<]+)<\/dc:subject>/gi;
  while ((match = subjectRegex.exec(opfContent)) !== null) {
    result.subjects.push(decodeEntities(match[1].trim()));
  }
}

async function extractCoverImage(opfContent: string, opfDir: string, zip: JSZip): Promise<Buffer | null> {
  // Try <meta name="cover" content="id"/>
  const coverMeta = /<meta\s{1,10}name="cover"\s{1,10}content="([^"]{1,200})"/i.exec(opfContent)
    || /<meta\s{1,10}content="([^"]{1,200})"\s{1,10}name="cover"/i.exec(opfContent);

  if (coverMeta) {
    const coverId = coverMeta[1];
    const itemRegex = new RegExp(`<item[^>]{1,500}id="${escapeRegex(coverId)}"[^>]{0,500}>`, 'i');
    const itemMatch = itemRegex.exec(opfContent);
    if (itemMatch) {
      const result = await resolveItemCover(itemMatch[0], opfDir, zip);
      if (result) return result;
    }
  }

  // Fallback: EPUB3 properties="cover-image"
  const epub3Cover = /<item[^>]{1,500}properties="[^"]{0,200}cover-image[^"]{0,200}"[^>]{0,500}>/i.exec(opfContent);
  if (epub3Cover) {
    const result = await resolveItemCover(epub3Cover[0], opfDir, zip);
    if (result) return result;
  }

  return null;
}

async function resolveItemCover(itemTag: string, opfDir: string, zip: JSZip): Promise<Buffer | null> {
  const hrefMatch = /href="([^"]+)"/.exec(itemTag);
  if (!hrefMatch) return null;

  const coverPath = opfDir + hrefMatch[1];
  const coverFile = zip.file(coverPath) || zip.file(decodeURIComponent(coverPath));
  if (!coverFile) return null;

  return Buffer.from(await coverFile.async('arraybuffer'));
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'");
}

function mapOpfRole(role: string): string {
  switch (role.toLowerCase()) {
    case 'aut': return 'author';
    case 'nrt': return 'narrator';
    case 'edt': return 'editor';
    default: return 'author';
  }
}

function escapeRegex(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
