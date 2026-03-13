// ===== User & Auth =====
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  password: string;
}

export interface SetupRequest {
  password: string;
}

// ===== Library =====
export type LibraryType = 'ebook' | 'audiobook' | 'mixed';

export interface Library {
  id: number;
  name: string;
  path: string;
  type: LibraryType;
  scanEnabled: boolean;
  lastScannedAt: string | null;
  createdAt: string;
}

export interface CreateLibraryRequest {
  name: string;
  path: string;
  type: LibraryType;
}

// ===== Book =====
export type FileFormat = 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3';

export interface Book {
  id: number;
  title: string;
  subtitle: string | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  publishDate: string | null;
  pageCount: number | null;
  isbn10: string | null;
  isbn13: string | null;
  hardcoverId: string | null;
  hardcoverSlug: string | null;
  matchConfidence: number | null;
  coverPath: string | null;
  blurhash: string | null;
  audioSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatchBreakdown {
  titleSimilarity: number;
  authorSimilarity: number;
  titleWeight: number;
  authorWeight: number;
  localTitle: string;
  matchedTitle: string;
  localAuthor: string | null;
  matchedAuthor: string | null;
}

export interface BookDetail extends Book {
  authors: AuthorRole[];
  series: SeriesPosition[];
  files: BookFile[];
  tags: Tag[];
  readingProgress: ReadingProgress | null;
  audioProgress: AudioProgress | null;
  audioTotalDuration: number;
  audioTrackCount: number;
  hasEbook: boolean;
  hasAudio: boolean;
  matchBreakdown: MatchBreakdown | null;
}

export interface BookFile {
  id: number;
  bookId: number;
  libraryId: number;
  path: string;
  filename: string;
  format: FileFormat;
  mimeType: string;
  sizeBytes: number;
  hashSha256: string;
  lastModified: string;
  createdAt: string;
}

// ===== Author =====
export interface Author {
  id: number;
  name: string;
  sortName: string;
  hardcoverId: string | null;
  bio: string | null;
  photoUrl: string | null;
}

export interface AuthorRole {
  author: Author;
  role: 'author' | 'narrator' | 'editor';
}

// ===== Series =====
export interface Series {
  id: number;
  name: string;
  hardcoverId: string | null;
  description: string | null;
}

export interface SeriesPosition {
  series: Series;
  position: number | null;
}

// ===== Tags =====
export interface Tag {
  id: number;
  name: string;
  source: 'hardcover' | 'user';
}

// ===== Collections =====
export interface Collection {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  createdAt: string;
}

// ===== Progress =====
export interface ReadingProgress {
  id: number;
  userId: number;
  bookId: number;
  format: 'epub' | 'pdf';
  cfi: string | null;
  pageNumber: number | null;
  totalPages: number | null;
  progressPercent: number;
  updatedAt: string;
}

export interface AudioProgress {
  id: number;
  userId: number;
  bookId: number;
  currentTrackIndex: number;
  positionSeconds: number;
  totalElapsedSeconds: number;
  totalDurationSeconds: number;
  playbackRate: number;
  isFinished: boolean;
  updatedAt: string;
}

// ===== Audio =====
export interface AudioTrack {
  id: number;
  bookId: number;
  fileId: number;
  trackIndex: number;
  title: string | null;
  durationSeconds: number;
  startOffsetSeconds: number;
}

export interface AudioChapter {
  id: number;
  bookId: number;
  title: string;
  startTime: number;
  endTime: number;
  trackIndex: number;
}

// ===== Metadata =====
export interface MetadataSearchResult {
  externalId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publishDate: string | null;
  isbn13: string | null;
  pageCount: number | null;
  isbn10: string | null;
  tags: string[] | null;
  series: string | null;
  seriesPosition: number | null;
  slug: string | null;
  allSeries: { name: string; position: number | null; seriesId?: string }[] | null;
}

export interface MetadataMatchResult extends MetadataSearchResult {
  confidence: number;
  provider: string;
}

// ===== Kindle =====
export interface KindleSettings {
  kindleEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
}

export interface KindleDelivery {
  id: number;
  userId: number;
  bookId: number;
  kindleEmail: string;
  status: 'pending' | 'sent' | 'failed';
  messageId: string | null;
  error: string | null;
  fileFormat: string;
  fileSizeBytes: number;
  createdAt: string;
}

// ===== Jobs =====
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'scan_library' | 'match_metadata' | 'match_all_metadata' | 'download_cover' | 'merge_audiobook';

export interface Job {
  id: number;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
}

// ===== API =====
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
}

// ===== Settings =====
export interface AppSettings {
  setupComplete: boolean;
  metadataAutoMatch: boolean;
  scanIntervalMinutes: number;
}

// ===== OPDS =====
export interface OpdsFeed {
  id: string;
  title: string;
  updated: string;
  entries: OpdsEntry[];
  links: OpdsLink[];
}

export interface OpdsEntry {
  id: string;
  title: string;
  updated: string;
  authors?: string[];
  summary?: string;
  content?: string;
  links: OpdsLink[];
}

export interface OpdsLink {
  href: string;
  type: string;
  rel?: string;
  title?: string;
}

// ===== Scan =====
export interface ScanStatus {
  libraryId: number;
  status: 'idle' | 'pending' | 'scanning' | 'complete' | 'error';
  filesFound: number;
  filesProcessed: number;
  booksAdded: number;
  booksUpdated: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
}
