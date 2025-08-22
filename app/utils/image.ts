// Client-safe image utility functions

export function getImageUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  
  // If it's already a full URL, return as-is
  if (filePath.startsWith('http')) {
    return filePath;
  }
  
  // If it's a relative path starting with /, return as-is (it's correct for public folder)
  if (filePath.startsWith('/')) {
    return filePath;
  }
  
  // Otherwise, prepend /images/players/
  return `/images/players/${filePath}`;
}