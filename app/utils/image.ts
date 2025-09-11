// Client-safe image utility functions

export function getImageUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  
  // Handle non-string values gracefully
  if (typeof filePath !== 'string') {
    console.warn('getImageUrl received non-string value:', filePath);
    return null;
  }
  
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

/**
 * Get the appropriate image URL from player profile using base URL + size suffix
 */
export function getPlayerImageUrl(
  player: {
    profileImageBase?: string | null; // New base URL approach
    profilePicture?: string | null;   // Legacy fallback
  },
  size: 'thumbnail' | 'medium' | 'large' = 'medium'
): string | null {
  // Use new base URL approach if available
  if (player.profileImageBase) {
    return `${player.profileImageBase}-${size}.jpg`;
  }
  
  // Legacy fallback
  return getImageUrl(player.profilePicture);
}

/**
 * Extract file extension from URL or default to jpg
 */
function getFileExtension(url: string): string {
  const match = url.match(/\.([^.?]+)(?:\?|$)/);
  return match ? match[1] : 'jpg';
}

/**
 * Get image URL with proper extension detection
 */
export function getPlayerImageUrlWithExt(
  player: {
    profileImageBase?: string | null;
    profilePicture?: string | null;
  },
  size: 'thumbnail' | 'medium' | 'large' = 'medium'
): string | null {
  if (player.profileImageBase) {
    // Try to detect extension from base URL or legacy field
    const ext = player.profilePicture 
      ? getFileExtension(player.profilePicture)
      : getFileExtension(player.profileImageBase) || 'jpg';
    
    return `${player.profileImageBase}-${size}.${ext}`;
  }
  
  return getImageUrl(player.profilePicture);
}