/**
 * Client-side image resizing utilities
 * Handles resizing images to multiple sizes before upload
 */

export interface ImageSize {
  name: string;
  maxWidth: number;
  maxHeight: number;
  quality: number;
  crop?: boolean; // If true, will crop to exact dimensions
}

export const IMAGE_SIZES = {
  thumbnail: {
    name: 'thumbnail',
    maxWidth: 150,
    maxHeight: 150,
    quality: 0.8,
    crop: true, // Square crop for consistency
  },
  medium: {
    name: 'medium',
    maxWidth: 600,
    maxHeight: 600,
    quality: 0.85,
    crop: false,
  },
  large: {
    name: 'large',
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.9,
    crop: false,
  },
} as const;

/**
 * Resize a single image to specified dimensions
 */
export async function resizeImage(
  file: File,
  size: ImageSize,
  baseId?: string
): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        let { width, height } = calculateDimensions(
          img.width,
          img.height,
          size.maxWidth,
          size.maxHeight,
          size.crop
        );
        
        canvas.width = width;
        canvas.height = height;
        
        if (size.crop) {
          // Center crop for square thumbnails
          const sourceSize = Math.min(img.width, img.height);
          const sourceX = (img.width - sourceSize) / 2;
          const sourceY = (img.height - sourceSize) / 2;
          
          ctx.drawImage(
            img,
            sourceX,
            sourceY,
            sourceSize,
            sourceSize,
            0,
            0,
            width,
            height
          );
        } else {
          // Maintain aspect ratio
          ctx.drawImage(img, 0, 0, width, height);
        }
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not create blob'));
              return;
            }
            
            // Create new file with predictable naming
            const extension = file.name.split('.').pop() || 'jpg';
            const fileName = baseId 
              ? `${baseId}-${size.name}.${extension}`
              : `${file.name.replace(/\.[^/.]+$/, '')}_${size.name}.${extension}`;
            
            const newFile = new File(
              [blob],
              fileName,
              { type: file.type }
            );
            
            resolve(newFile);
          },
          file.type,
          size.quality
        );
      };
      
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Calculate dimensions maintaining aspect ratio or cropping
 */
function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
  crop: boolean = false
): { width: number; height: number } {
  if (crop) {
    // Return exact dimensions for cropping
    return { width: maxWidth, height: maxHeight };
  }
  
  // Calculate aspect ratio
  const aspectRatio = originalWidth / originalHeight;
  
  let width = originalWidth;
  let height = originalHeight;
  
  // Scale down if needed
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }
  
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }
  
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Process an image file into multiple sizes with predictable naming
 */
export async function processImageToSizes(
  file: File,
  sizes: Array<ImageSize> = Object.values(IMAGE_SIZES),
  baseId?: string // Optional base ID for predictable naming
): Promise<{ [key: string]: File }> {
  const results: { [key: string]: File } = {};
  
  // Generate a base ID if not provided (timestamp-based)
  const id = baseId || `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Process each size in parallel
  const promises = sizes.map(async (size) => {
    const resizedFile = await resizeImage(file, size, id);
    results[size.name] = resizedFile;
  });
  
  await Promise.all(promises);
  return results;
}

/**
 * Get image dimensions from a file
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Validate image before processing
 */
export async function validateImage(
  file: File,
  maxSizeMB: number = 10
): Promise<{ valid: boolean; error?: string }> {
  // Check file size
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit`,
    };
  }
  
  // Check file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPG, PNG, or WebP image.',
    };
  }
  
  // Check dimensions
  try {
    const dimensions = await getImageDimensions(file);
    
    // Minimum dimensions to ensure quality
    if (dimensions.width < 150 || dimensions.height < 150) {
      return {
        valid: false,
        error: 'Image is too small. Minimum size is 150x150 pixels.',
      };
    }
    
    // Maximum dimensions for performance
    if (dimensions.width > 4000 || dimensions.height > 4000) {
      return {
        valid: false,
        error: 'Image is too large. Maximum size is 4000x4000 pixels.',
      };
    }
    
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: 'Could not validate image dimensions',
    };
  }
}