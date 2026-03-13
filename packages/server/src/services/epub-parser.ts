import fs from 'node:fs';

/**
 * Parse EPUB OPF metadata.
 * Full implementation requires extracting META-INF/container.xml -> content.opf
 * This is a placeholder that will be expanded in Phase 2.
 */
export interface EpubMetadata {
  title: string;
  creators: { name: string; role: string }[];
  language: string | null;
  publisher: string | null;
  date: string | null;
  description: string | null;
  isbn: string | null;
  subjects: string[];
  coverImagePath: string | null;
}

export async function parseEpub(filePath: string): Promise<EpubMetadata> {
  // TODO: Implement proper EPUB OPF extraction using JSZip
  // For now, return empty metadata — filename parser provides fallback
  return {
    title: '',
    creators: [],
    language: null,
    publisher: null,
    date: null,
    description: null,
    isbn: null,
    subjects: [],
    coverImagePath: null,
  };
}
