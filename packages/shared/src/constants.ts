export const SUPPORTED_EBOOK_FORMATS = ['epub', 'pdf', 'mobi', 'azw3'] as const;
export const SUPPORTED_AUDIO_FORMATS = ['m4b', 'mp3'] as const;
export const SUPPORTED_FORMATS = [...SUPPORTED_EBOOK_FORMATS, ...SUPPORTED_AUDIO_FORMATS] as const;

export const MIME_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  m4b: 'audio/mp4',
  mp3: 'audio/mpeg',
};

export const COVER_SIZES = {
  thumb: { width: 200, height: 300 },
  medium: { width: 400, height: 600 },
  full: { width: 800, height: 1200 },
} as const;

export const AUTH = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY_DAYS: 7,
  BCRYPT_ROUNDS: 12,
  MIN_PASSWORD_LENGTH: 8,
} as const;

export const METADATA = {
  RATE_LIMIT_PER_MINUTE: 60,
  HIGH_CONFIDENCE_THRESHOLD: 0.95,
  ACCEPT_THRESHOLD: 0.70,
  NEEDS_REVIEW_MIN: 0.40,
  REJECT_THRESHOLD: 0.40,
  TITLE_HARD_FLOOR: 0.15,
  TITLE_GATE: 0.25,
  // Legacy aliases (kept for backward compat)
  MEDIUM_CONFIDENCE_THRESHOLD: 0.6,
  LOW_CONFIDENCE_THRESHOLD: 0.5,
} as const;

export const KINDLE = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  SUPPORTED_FORMATS: ['epub', 'pdf', 'mobi'] as const,
} as const;

export const JOB_QUEUE = {
  POLL_INTERVAL_MS: 5000,
  MAX_ATTEMPTS: 3,
} as const;

export const DEFAULT_USER_ID = 1;
