const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]);

const FILE_SIGNATURES = {
  'pdf': [PDF_MAGIC],
  'jpg': [JPEG_MAGIC],
  'jpeg': [JPEG_MAGIC],
  'png': [PNG_MAGIC],
  'webm': [WEBM_MAGIC],
  'ogg': [OGG_MAGIC],
  'mp4': [MP4_MAGIC],
};

function getExtension(filename) {
  if (!filename) return '';
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ext;
}

function hasMagicBytes(buffer, magic) {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

export function validateFileType(buffer, filename) {
  if (!buffer || buffer.length < 4) return { valid: false, error: 'File is too small or empty' };

  const ext = getExtension(filename);
  const signatures = FILE_SIGNATURES[ext];

  if (!signatures) {
    return { valid: true };
  }

  const matchesMagic = signatures.some((magic) => hasMagicBytes(buffer, magic));

  if (!matchesMagic) {
    return {
      valid: false,
      error: `File extension ".${ext}" does not match actual file content. Upload rejected for security reasons.`,
    };
  }

  return { valid: true };
}

export function validateFileSize(buffer, maxSize) {
  if (buffer.length > maxSize) {
    return { valid: false, error: `File exceeds maximum size of ${Math.round(maxSize / 1024 / 1024)}MB` };
  }
  return { valid: true };
}
