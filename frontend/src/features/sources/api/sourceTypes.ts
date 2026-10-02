/**
 * The source types a workspace accepts, mirroring `dev.researchhub.source.domain.SourceType` and the table in
 * docs/development/sources.md.
 *
 * The server decides. This copy exists so the browser can refuse an obviously unsupported file before uploading
 * megabytes that will be refused anyway, with the same wording the server uses — and so a file picker can offer only
 * what will be accepted. A file that passes here can still be refused by the server, for example when its content
 * does not look like its extension, and the UI must show that `UNSUPPORTED_FILE_TYPE` detail as it arrives.
 */

import type { BadgeTone } from '../../../shared/components/identity';
import type { IconName } from '../../../shared/components/icons';

export const SOURCE_TYPES = ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT'] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** Where a source is in processing. Mirrors `SourceStatus`. */
export type SourceStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export const SOURCE_STATUS_LABELS: Readonly<Record<SourceStatus, string>> = {
  UPLOADED: 'Uploaded',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

export interface SourceVisual {
  readonly icon: IconName;
  readonly tone: BadgeTone;
}

/** Exhaustive presentation maps: adding a server-supported type/state requires a visual. */
export const SOURCE_TYPE_VISUALS: Readonly<Record<SourceType, SourceVisual>> = {
  PDF: { icon: 'file', tone: 'coral' },
  DOCX: { icon: 'text', tone: 'blue' },
  XLSX: { icon: 'table', tone: 'mint' },
  CSV: { icon: 'grid', tone: 'mint' },
  TXT: { icon: 'text', tone: 'yellow' },
};

export const SOURCE_STATUS_VISUALS: Readonly<Record<SourceStatus, SourceVisual>> = {
  UPLOADED: { icon: 'upload', tone: 'neutral' },
  PROCESSING: { icon: 'refresh', tone: 'yellow' },
  READY: { icon: 'check', tone: 'mint' },
  FAILED: { icon: 'alert', tone: 'coral' },
};

interface SourceTypeRule {
  /** Lowercase, without the dot. */
  readonly extension: string;
  /** What the server stores and serves. */
  readonly mediaType: string;
  /** What a browser may send for this type. */
  readonly acceptedMediaTypes: readonly string[];
}

export const SOURCE_TYPE_RULES: Readonly<Record<SourceType, SourceTypeRule>> = {
  PDF: {
    extension: 'pdf',
    mediaType: 'application/pdf',
    acceptedMediaTypes: ['application/pdf', 'application/x-pdf'],
  },
  DOCX: {
    extension: 'docx',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMediaTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  XLSX: {
    extension: 'xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMediaTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  CSV: {
    extension: 'csv',
    mediaType: 'text/csv',
    acceptedMediaTypes: [
      'text/csv',
      'application/csv',
      'text/x-csv',
      'text/plain',
      'application/vnd.ms-excel',
    ],
  },
  TXT: {
    extension: 'txt',
    mediaType: 'text/plain',
    acceptedMediaTypes: ['text/plain'],
  },
};

/** For `<input type="file" accept>`: every supported extension. */
export const SOURCE_FILE_ACCEPT = SOURCE_TYPES.map(
  (type) => `.${SOURCE_TYPE_RULES[type].extension}`,
).join(',');

/**
 * The server's default per-source limit (`researchhub.sources.max-size-bytes`, 50 MiB). A deployment may configure a
 * lower one; the server's `PAYLOAD_TOO_LARGE` detail is then what the user sees.
 */
export const DEFAULT_MAX_SOURCE_BYTES = 52_428_800;

const GENERIC_MEDIA_TYPE = 'application/octet-stream';

/** "Supported types: PDF (.pdf), DOCX (.docx), ...", worded exactly as the server words it. */
export function supportedTypesSentence(): string {
  return `Supported types: ${SOURCE_TYPES.map(
    (type) => `${type} (.${SOURCE_TYPE_RULES[type].extension})`,
  ).join(', ')}.`;
}

/** The part of a `File` this check reads, so it can be tested without constructing one. */
export interface SourceFileCandidate {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export type SourceFileCheck =
  | { readonly ok: true; readonly sourceType: SourceType }
  | { readonly ok: false; readonly message: string };

function extensionOf(name: string): string | null {
  const baseName = name
    .slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
    .trim();
  const dot = baseName.lastIndexOf('.');
  if (dot <= 0 || dot === baseName.length - 1) {
    return null;
  }
  return baseName.slice(dot + 1).toLowerCase();
}

function formatLimit(bytes: number): string {
  const megabyte = 1024 * 1024;
  if (bytes % (1024 * megabyte) === 0) {
    return `${String(bytes / (1024 * megabyte))} GB`;
  }
  if (bytes % megabyte === 0) {
    return `${String(bytes / megabyte)} MB`;
  }
  return `${String(bytes)} bytes`;
}

/**
 * Whether a chosen file is worth uploading, by the same rules as `SourceType.resolve` on the server: the extension
 * decides the type, a declared media type must agree with it or be empty or generic, and the file must be neither
 * empty nor over the limit.
 */
export function checkSourceFile(
  file: SourceFileCandidate,
  maxBytes: number = DEFAULT_MAX_SOURCE_BYTES,
): SourceFileCheck {
  const extension = extensionOf(file.name);
  const sourceType = SOURCE_TYPES.find(
    (type) => SOURCE_TYPE_RULES[type].extension === extension,
  );

  if (sourceType === undefined) {
    return {
      ok: false,
      message:
        (extension === null
          ? 'The file has no extension, so its type cannot be recognised. '
          : `Files of type .${extension} are not supported. `) + supportedTypesSentence(),
    };
  }

  const declared = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    declared !== '' &&
    declared !== GENERIC_MEDIA_TYPE &&
    !SOURCE_TYPE_RULES[sourceType].acceptedMediaTypes.includes(declared)
  ) {
    return {
      ok: false,
      message:
        `The file is named .${SOURCE_TYPE_RULES[sourceType].extension} but was sent as ${declared}, ` +
        `which is not a ${sourceType} media type. ${supportedTypesSentence()}`,
    };
  }

  if (file.size === 0) {
    return { ok: false, message: 'The file is empty' };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `The file is larger than the ${formatLimit(maxBytes)} allowed for one source`,
    };
  }

  return { ok: true, sourceType };
}
