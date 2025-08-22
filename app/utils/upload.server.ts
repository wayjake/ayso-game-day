import { join } from "path";

// 🗑️ Legacy file cleanup function for local images
// Used when switching from local uploads to UploadThing

export async function deletePlayerImage(filePath: string): Promise<boolean> {
  try {
    if (!filePath.startsWith('/images/players/')) {
      return false;
    }
    
    const fullPath = join(process.cwd(), 'public', filePath);
    const { unlink } = await import('fs/promises');
    await unlink(fullPath);
    return true;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
}

