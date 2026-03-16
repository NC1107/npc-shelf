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

    // 1. Find the OPF file path from META-INF/container.xml
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    if (!containerXml) return result;

    const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!opfPathMatch) return result;
    const opfPath = opfPathMatch[1];
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // 2. Parse the OPF content
    const opfContent = await zip.file(opfPath)?.async('text');
    if (!opfContent) return result;

    // Title
    const titleMatch = opfContent.match(/<dc:title[^>]{0,200}>([^<]+)<\/dc:title>/i);
    if (titleMatch) result.title = decodeEntities(titleMatch[1].trim());

    // Creators (authors, narrators, editors)
    const creatorRegex = /<dc:creator[^>]{0,200}>([^<]+)<\/dc:creator>/gi;
    const roleRegex = /<dc:creator[^>]{0,200}opf:role="([^"]{0,50})"[^>]{0,200}>([^<]+)<\/dc:creator>/gi;

    // Try role-attributed creators first
    let match: RegExpExecArray | null;
    const roleMatches = new Set<string>();
    while ((match = roleRegex.exec(opfContent)) !== null) {
      const role = mapOpfRole(match[1]);
      const name = decodeEntities(match[2].trim());
      result.creators.push({ name, role });
      roleMatches.add(name);
    }

    // Fall back to unattributed creators
    if (result.creators.length === 0) {
      while ((match = creatorRegex.exec(opfContent)) !== null) {
        const name = decodeEntities(match[1].trim());
        if (!roleMatches.has(name)) {
          result.creators.push({ name, role: 'author' });
        }
      }
    }

    // Language
    const langMatch = opfContent.match(/<dc:language[^>]{0,200}>([^<]+)<\/dc:language>/i);
    if (langMatch) result.language = langMatch[1].trim();

    // Publisher
    const pubMatch = opfContent.match(/<dc:publisher[^>]{0,200}>([^<]+)<\/dc:publisher>/i);
    if (pubMatch) result.publisher = decodeEntities(pubMatch[1].trim());

    // Date
    const dateMatch = opfContent.match(/<dc:date[^>]{0,200}>([^<]+)<\/dc:date>/i);
    if (dateMatch) result.date = dateMatch[1].trim();

    // Description
    // Extract description — use indexOf/slice instead of [\s\S]*? to avoid ReDoS
    const descStart = opfContent.search(/<dc:description[^>]{0,100}>/i);
    if (descStart !== -1) {
      const tagEnd = opfContent.indexOf('>', descStart) + 1;
      const closeIdx = opfContent.indexOf('</dc:description>', tagEnd);
      if (closeIdx !== -1) {
        result.description = decodeEntities(opfContent.slice(tagEnd, closeIdx).trim().replaceAll(/<[^>]{1,1000}>/g, ''));
      }
    }

    // ISBN — look in dc:identifier with isbn scheme or opf:scheme
    const identRegex = /<dc:identifier[^>]{0,200}>([^<]+)<\/dc:identifier>/gi;
    while ((match = identRegex.exec(opfContent)) !== null) {
      const fullTag = match[0];
      const value = match[1].trim();
      const isIsbn = /isbn/i.test(fullTag) || /^(97[89])?\d{9}[\dXx]$/.test(value.replaceAll(/[-\s]/g, ''));
      if (isIsbn) {
        result.isbn = value.replaceAll(/[-\s]/g, '');
        break;
      }
    }

    // Subjects/tags
    const subjectRegex = /<dc:subject[^>]{0,200}>([^<]+)<\/dc:subject>/gi;
    while ((match = subjectRegex.exec(opfContent)) !== null) {
      result.subjects.push(decodeEntities(match[1].trim()));
    }

    // 3. Extract cover image
    // Look for meta cover element: <meta name="cover" content="cover-image-id"/>
    const coverMeta = opfContent.match(/<meta\s{1,10}name="cover"\s{1,10}content="([^"]{1,200})"/i)
      || opfContent.match(/<meta\s{1,10}content="([^"]{1,200})"\s{1,10}name="cover"/i);

    if (coverMeta) {
      const coverId = coverMeta[1];
      // Find the item with this id
      const itemRegex = new RegExp(`<item[^>]{1,500}id="${escapeRegex(coverId)}"[^>]{0,500}>`, 'i');
      const itemMatch = opfContent.match(itemRegex);
      if (itemMatch) {
        const hrefMatch = itemMatch[0].match(/href="([^"]+)"/);
        if (hrefMatch) {
          const coverPath = opfDir + hrefMatch[1];
          const coverFile = zip.file(coverPath) || zip.file(decodeURIComponent(coverPath));
          if (coverFile) {
            result.coverImage = Buffer.from(await coverFile.async('arraybuffer'));
          }
        }
      }
    }

    // Fallback: look for item with properties="cover-image" (EPUB3)
    if (!result.coverImage) {
      const epub3Cover = opfContent.match(/<item[^>]{1,500}properties="[^"]{0,200}cover-image[^"]{0,200}"[^>]{0,500}>/i);
      if (epub3Cover) {
        const hrefMatch = epub3Cover[0].match(/href="([^"]+)"/);
        if (hrefMatch) {
          const coverPath = opfDir + hrefMatch[1];
          const coverFile = zip.file(coverPath) || zip.file(decodeURIComponent(coverPath));
          if (coverFile) {
            result.coverImage = Buffer.from(await coverFile.async('arraybuffer'));
          }
        }
      }
    }
  } catch (err) {
    console.error(`[EpubParser] Error parsing ${filePath}:`, err);
  }

  return result;
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
