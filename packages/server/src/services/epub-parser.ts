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
    const opfPath = opfPathMatch[1]!;
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // 2. Parse the OPF content
    const opfContent = await zip.file(opfPath)?.async('text');
    if (!opfContent) return result;

    // Title
    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
    if (titleMatch) result.title = decodeEntities(titleMatch[1]!.trim());

    // Creators (authors, narrators, editors)
    const creatorRegex = /<dc:creator[^>]*>([^<]+)<\/dc:creator>/gi;
    const roleRegex = /<dc:creator[^>]*opf:role="([^"]*)"[^>]*>([^<]+)<\/dc:creator>/gi;

    // Try role-attributed creators first
    let match: RegExpExecArray | null;
    const roleMatches = new Set<string>();
    while ((match = roleRegex.exec(opfContent)) !== null) {
      const role = mapOpfRole(match[1]!);
      const name = decodeEntities(match[2]!.trim());
      result.creators.push({ name, role });
      roleMatches.add(name);
    }

    // Fall back to unattributed creators
    if (result.creators.length === 0) {
      while ((match = creatorRegex.exec(opfContent)) !== null) {
        const name = decodeEntities(match[1]!.trim());
        if (!roleMatches.has(name)) {
          result.creators.push({ name, role: 'author' });
        }
      }
    }

    // Language
    const langMatch = opfContent.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i);
    if (langMatch) result.language = langMatch[1]!.trim();

    // Publisher
    const pubMatch = opfContent.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/i);
    if (pubMatch) result.publisher = decodeEntities(pubMatch[1]!.trim());

    // Date
    const dateMatch = opfContent.match(/<dc:date[^>]*>([^<]+)<\/dc:date>/i);
    if (dateMatch) result.date = dateMatch[1]!.trim();

    // Description
    const descMatch = opfContent.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
    if (descMatch) {
      result.description = decodeEntities(descMatch[1]!.trim().replace(/<[^>]+>/g, ''));
    }

    // ISBN — look in dc:identifier with isbn scheme or opf:scheme
    const identRegex = /<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/gi;
    while ((match = identRegex.exec(opfContent)) !== null) {
      const fullTag = match[0]!;
      const value = match[1]!.trim();
      const isIsbn = /isbn/i.test(fullTag) || /^(97[89])?\d{9}[\dXx]$/.test(value.replace(/[-\s]/g, ''));
      if (isIsbn) {
        result.isbn = value.replace(/[-\s]/g, '');
        break;
      }
    }

    // Subjects/tags
    const subjectRegex = /<dc:subject[^>]*>([^<]+)<\/dc:subject>/gi;
    while ((match = subjectRegex.exec(opfContent)) !== null) {
      result.subjects.push(decodeEntities(match[1]!.trim()));
    }

    // 3. Extract cover image
    // Look for meta cover element: <meta name="cover" content="cover-image-id"/>
    const coverMeta = opfContent.match(/<meta\s+name="cover"\s+content="([^"]+)"/i)
      || opfContent.match(/<meta\s+content="([^"]+)"\s+name="cover"/i);

    if (coverMeta) {
      const coverId = coverMeta[1]!;
      // Find the item with this id
      const itemRegex = new RegExp(`<item[^>]+id="${escapeRegex(coverId)}"[^>]*>`, 'i');
      const itemMatch = opfContent.match(itemRegex);
      if (itemMatch) {
        const hrefMatch = itemMatch[0]!.match(/href="([^"]+)"/);
        if (hrefMatch) {
          const coverPath = opfDir + hrefMatch[1]!;
          const coverFile = zip.file(coverPath) || zip.file(decodeURIComponent(coverPath));
          if (coverFile) {
            result.coverImage = Buffer.from(await coverFile.async('arraybuffer'));
          }
        }
      }
    }

    // Fallback: look for item with properties="cover-image" (EPUB3)
    if (!result.coverImage) {
      const epub3Cover = opfContent.match(/<item[^>]+properties="[^"]*cover-image[^"]*"[^>]*>/i);
      if (epub3Cover) {
        const hrefMatch = epub3Cover[0]!.match(/href="([^"]+)"/);
        if (hrefMatch) {
          const coverPath = opfDir + hrefMatch[1]!;
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
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
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
