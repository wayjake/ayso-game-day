// File validation for roster import

const ALLOWED_TYPES = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'],
  pdf: ['application/pdf'],
  text: ['text/plain', 'text/csv', 'application/csv'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type FileCategory = 'image' | 'pdf' | 'text';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  fileCategory?: FileCategory;
}

export function validateFile(file: File): ValidationResult {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File size must be under 10MB' };
  }

  // Check file size is not zero
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // Determine file category
  const fileCategory = getFileCategory(file.type);

  if (!fileCategory) {
    return {
      valid: false,
      error: 'Unsupported file type. Please upload an image, PDF, or text/CSV file.',
    };
  }

  return { valid: true, fileCategory };
}

export function getFileCategory(mimeType: string): FileCategory | null {
  if (ALLOWED_TYPES.image.includes(mimeType)) {
    return 'image';
  }
  if (ALLOWED_TYPES.pdf.includes(mimeType)) {
    return 'pdf';
  }
  if (ALLOWED_TYPES.text.includes(mimeType)) {
    return 'text';
  }
  return null;
}

export function getAllowedMimeTypes(): string[] {
  return [
    ...ALLOWED_TYPES.image,
    ...ALLOWED_TYPES.pdf,
    ...ALLOWED_TYPES.text,
  ];
}

export function getAcceptString(): string {
  return [
    'image/*',
    'application/pdf',
    'text/plain',
    'text/csv',
    '.csv',
  ].join(',');
}
