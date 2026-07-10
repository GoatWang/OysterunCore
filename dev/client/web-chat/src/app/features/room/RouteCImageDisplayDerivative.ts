import { TUploadContent } from '../../utils/matrix';
import { loadImageElement } from '../../utils/dom';

export const OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_MAX_LONG_EDGE = 1280;
export const OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_QUALITY = 0.75;
export const OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_SCHEMA =
  'routec.p179.image_display_derivative.v1';
export const OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY =
  'org.oysterun.p179.image_display_derivative';

const STATIC_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type RouteCImageDisplayDerivativeDiagnostics = {
  schema_version: typeof OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_SCHEMA;
  routec_phase179_image_upload_display_derivative: true;
  original_name: string;
  original_mimetype: string;
  original_byte_size: number;
  original_width: number | null;
  original_height: number | null;
  display_mimetype: string;
  display_byte_size: number;
  display_width: number | null;
  display_height: number | null;
  max_long_edge: typeof OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_MAX_LONG_EDGE;
  quality: typeof OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_QUALITY;
  compression_ms: number;
  was_compressed: boolean;
  compression_ratio: number | null;
  skip_reason?: string;
};

export type RouteCImageDisplayUpload = {
  file: TUploadContent;
  diagnostics?: RouteCImageDisplayDerivativeDiagnostics;
};

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getContentName(file: TUploadContent, fallback: string): string {
  return 'name' in file && typeof file.name === 'string' && file.name.trim()
    ? file.name.trim()
    : fallback;
}

function normalizeImageMimeType(file: TUploadContent, filename: string): string {
  const declaredType = file.type.toLowerCase();
  if (declaredType === 'image/jpg') return 'image/jpeg';
  if (declaredType) return declaredType;
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.heic')) return 'image/heic';
  if (lowerName.endsWith('.heif')) return 'image/heif';
  return '';
}

function isImageMimeType(mimetype: string): boolean {
  return mimetype.startsWith('image/');
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

async function fileContainsAsciiChunk(file: TUploadContent, chunkName: string): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (let index = 0; index <= bytes.length - chunkName.length; index += 1) {
    if (readAscii(bytes, index, chunkName.length) === chunkName) return true;
  }
  return false;
}

async function getUnsafeAnimatedImageSkipReason(
  file: TUploadContent,
  mimetype: string
): Promise<string | undefined> {
  if (mimetype === 'image/gif') return 'animated_or_unsupported_gif';
  if (mimetype === 'image/webp' && (await fileContainsAsciiChunk(file, 'ANIM'))) {
    return 'animated_webp_not_flattened';
  }
  if (mimetype === 'image/png' && (await fileContainsAsciiChunk(file, 'acTL'))) {
    return 'animated_png_not_flattened';
  }
  return undefined;
}

function dimensionsForLongEdge(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_MAX_LONG_EDGE) {
    return { width, height };
  }
  const ratio = OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_MAX_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function buildDiagnostics({
  filename,
  originalMimetype,
  originalByteSize,
  originalWidth,
  originalHeight,
  displayMimetype,
  displayByteSize,
  displayWidth,
  displayHeight,
  startedAt,
  wasCompressed,
  skipReason,
}: {
  filename: string;
  originalMimetype: string;
  originalByteSize: number;
  originalWidth: number | null;
  originalHeight: number | null;
  displayMimetype: string;
  displayByteSize: number;
  displayWidth: number | null;
  displayHeight: number | null;
  startedAt: number;
  wasCompressed: boolean;
  skipReason?: string;
}): RouteCImageDisplayDerivativeDiagnostics {
  return {
    schema_version: OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_SCHEMA,
    routec_phase179_image_upload_display_derivative: true,
    original_name: filename,
    original_mimetype: originalMimetype || 'application/octet-stream',
    original_byte_size: originalByteSize,
    original_width: originalWidth,
    original_height: originalHeight,
    display_mimetype: displayMimetype || 'application/octet-stream',
    display_byte_size: displayByteSize,
    display_width: displayWidth,
    display_height: displayHeight,
    max_long_edge: OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_MAX_LONG_EDGE,
    quality: OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_QUALITY,
    compression_ms: Math.max(0, Math.round(nowMs() - startedAt)),
    was_compressed: wasCompressed,
    compression_ratio: originalByteSize > 0 ? displayByteSize / originalByteSize : null,
    ...(skipReason ? { skip_reason: skipReason } : {}),
  };
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimetype: string
): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? undefined),
      mimetype,
      mimetype === 'image/jpeg' || mimetype === 'image/webp'
        ? OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_QUALITY
        : undefined
    );
  });
}

export async function prepareRouteCImageDisplayDerivativeUpload({
  file,
  originalFile = file,
  filename,
}: {
  file: TUploadContent;
  originalFile?: TUploadContent;
  filename: string;
}): Promise<RouteCImageDisplayUpload> {
  const startedAt = nowMs();
  const originalName = getContentName(originalFile, filename);
  const originalMimetype = normalizeImageMimeType(originalFile, originalName);
  if (!isImageMimeType(originalMimetype)) {
    return { file };
  }

  const baseSkipReason = !STATIC_IMAGE_MIME_TYPES.has(originalMimetype)
    ? `unsupported_static_image_mimetype:${originalMimetype || 'missing'}`
    : await getUnsafeAnimatedImageSkipReason(originalFile, originalMimetype);
  if (baseSkipReason) {
    return {
      file,
      diagnostics: buildDiagnostics({
        filename: originalName,
        originalMimetype,
        originalByteSize: originalFile.size,
        originalWidth: null,
        originalHeight: null,
        displayMimetype: file.type || originalMimetype,
        displayByteSize: file.size,
        displayWidth: null,
        displayHeight: null,
        startedAt,
        wasCompressed: false,
        skipReason: baseSkipReason,
      }),
    };
  }

  const imageUrl = URL.createObjectURL(originalFile);
  try {
    const imageElement = await loadImageElement(imageUrl);
    const originalWidth = imageElement.naturalWidth || imageElement.width;
    const originalHeight = imageElement.naturalHeight || imageElement.height;
    if (!originalWidth || !originalHeight) {
      return {
        file,
        diagnostics: buildDiagnostics({
          filename: originalName,
          originalMimetype,
          originalByteSize: originalFile.size,
          originalWidth: null,
          originalHeight: null,
          displayMimetype: file.type || originalMimetype,
          displayByteSize: file.size,
          displayWidth: null,
          displayHeight: null,
          startedAt,
          wasCompressed: false,
          skipReason: 'missing_decoded_dimensions',
        }),
      };
    }

    const displayDimensions = dimensionsForLongEdge(originalWidth, originalHeight);
    if (
      displayDimensions.width === originalWidth &&
      displayDimensions.height === originalHeight
    ) {
      return {
        file,
        diagnostics: buildDiagnostics({
          filename: originalName,
          originalMimetype,
          originalByteSize: originalFile.size,
          originalWidth,
          originalHeight,
          displayMimetype: file.type || originalMimetype,
          displayByteSize: file.size,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
          startedAt,
          wasCompressed: false,
          skipReason: 'already_within_display_bounds',
        }),
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = displayDimensions.width;
    canvas.height = displayDimensions.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return {
        file,
        diagnostics: buildDiagnostics({
          filename: originalName,
          originalMimetype,
          originalByteSize: originalFile.size,
          originalWidth,
          originalHeight,
          displayMimetype: file.type || originalMimetype,
          displayByteSize: file.size,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
          startedAt,
          wasCompressed: false,
          skipReason: 'canvas_2d_context_unavailable',
        }),
      };
    }
    context.drawImage(imageElement, 0, 0, displayDimensions.width, displayDimensions.height);

    const displayBlob = await encodeCanvas(canvas, originalMimetype);
    if (!displayBlob) {
      return {
        file,
        diagnostics: buildDiagnostics({
          filename: originalName,
          originalMimetype,
          originalByteSize: originalFile.size,
          originalWidth,
          originalHeight,
          displayMimetype: file.type || originalMimetype,
          displayByteSize: file.size,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
          startedAt,
          wasCompressed: false,
          skipReason: 'canvas_to_blob_failed',
        }),
      };
    }

    if (displayBlob.size >= originalFile.size) {
      return {
        file,
        diagnostics: buildDiagnostics({
          filename: originalName,
          originalMimetype,
          originalByteSize: originalFile.size,
          originalWidth,
          originalHeight,
          displayMimetype: file.type || originalMimetype,
          displayByteSize: file.size,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
          startedAt,
          wasCompressed: false,
          skipReason: 'display_derivative_not_smaller',
        }),
      };
    }

    const displayFile = new File([displayBlob], filename, {
      type: displayBlob.type || originalMimetype,
      lastModified: Date.now(),
    });
    return {
      file: displayFile,
      diagnostics: buildDiagnostics({
        filename: originalName,
        originalMimetype,
        originalByteSize: originalFile.size,
        originalWidth,
        originalHeight,
        displayMimetype: displayFile.type || originalMimetype,
        displayByteSize: displayFile.size,
        displayWidth: displayDimensions.width,
        displayHeight: displayDimensions.height,
        startedAt,
        wasCompressed: true,
      }),
    };
  } catch (err) {
    console.warn('[oysterun-routec] P179 image display derivative generation skipped', err);
    return {
      file,
      diagnostics: buildDiagnostics({
        filename: originalName,
        originalMimetype,
        originalByteSize: originalFile.size,
        originalWidth: null,
        originalHeight: null,
        displayMimetype: file.type || originalMimetype,
        displayByteSize: file.size,
        displayWidth: null,
        displayHeight: null,
        startedAt,
        wasCompressed: false,
        skipReason: 'decode_or_encode_failed',
      }),
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
