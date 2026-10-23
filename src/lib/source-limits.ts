// Shared by the upload handler, parser and browser; CSV/XLSX limits are separate.
export const MAX_SOURCE_PDF_MB = 50;
export const MAX_SOURCE_PDF_BYTES = MAX_SOURCE_PDF_MB * 1024 * 1024;
export const MAX_SOURCE_PDF_PAGES = 3000;
export const MAX_SOURCE_PDF_TEXT = 12_000_000;
export const MAX_SOURCE_REQUEST_BYTES = MAX_SOURCE_PDF_BYTES + 1024 * 1024;
export const SOURCE_REQUEST_TIMEOUT_MS = 180_000;
