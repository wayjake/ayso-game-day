import { useState, useCallback, useEffect } from "react";
import { useUploadThing } from "~/utils/uploadthing";
import { getImageUrl } from "~/utils/image";
import {
  processImageToSizes,
  validateImage,
  IMAGE_SIZES,
} from "~/utils/image-resize.client";

interface ImageUploaderProps {
  currentImage?: string | null;
  onUploadComplete: (baseUrl: string) => void; // Now just returns base URL
  onUploadError?: (error: string) => void;
  endpoint?: "playerImage" | "teamLogo";
  className?: string;
  enableResize?: boolean; // Enable multi-size resizing
}

export function ImageUploader({
  currentImage,
  onUploadComplete,
  onUploadError,
  endpoint = "playerImage",
  className = "",
  enableResize = true,
}: ImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPasteReady, setIsPasteReady] = useState(false);

  const { startUpload } = useUploadThing(endpoint, {
    onClientUploadComplete: (res) => {
      // 🎉 Upload complete!
      if (enableResize && res?.length > 0) {
        // Extract base URL from the first uploaded file
        // Assuming filename pattern: player_123456_abc7-medium.jpg
        const firstFile = res[0];
        const fileUrl = firstFile.ufsUrl || firstFile.url; // Use ufsUrl, fallback to url for compatibility
        const baseUrl = fileUrl.replace(/-[^-]+\.(jpg|jpeg|png|webp)$/i, '');
        
        onUploadComplete(baseUrl);
      } else if (res?.[0]) {
        // Single file upload (backward compatibility)
        const fileUrl = res[0].ufsUrl || res[0].url; // Use ufsUrl, fallback to url for compatibility
        onUploadComplete(fileUrl);
      }
      setPreviewUrl(null);
      setIsUploading(false);
      setUploadProgress(0);
    },
    onUploadError: (error: Error) => {
      // 💥 Something went wrong
      console.error("Upload error:", error);
      onUploadError?.(error.message || "Upload failed");
      setIsUploading(false);
      setUploadProgress(0);
      setPreviewUrl(null);
    },
    onUploadProgress: (progress) => {
      // 📊 Track upload progress
      setUploadProgress(progress);
    },
  });

  const processFile = useCallback(
    async (file: File) => {
      try {
        if (enableResize) {
          // Use advanced validation and resizing
          setIsProcessing(true);
          
          // Validate the image
          const validation = await validateImage(file, 10);
          if (!validation.valid) {
            onUploadError?.(validation.error || "Invalid image");
            setIsProcessing(false);
            return;
          }
          
          // Show preview
          const reader = new FileReader();
          reader.onloadend = () => {
            setPreviewUrl(reader.result as string);
          };
          reader.readAsDataURL(file);
          
          // Generate predictable ID for this upload batch
          const imageId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          
          // Process into multiple sizes with predictable naming
          const resizedImages = await processImageToSizes(file, undefined, imageId);
          const filesToUpload = Object.values(resizedImages);
          
          setIsProcessing(false);
          setIsUploading(true);
          await startUpload(filesToUpload);
        } else {
          // Simple validation (backward compatibility)
          const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
          if (!validTypes.includes(file.type)) {
            onUploadError?.("Please select a valid image file (PNG, JPG, or WebP)");
            return;
          }

          const maxSize = endpoint === "playerImage" ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
          if (file.size > maxSize) {
            onUploadError?.(`File too large. Maximum size is ${endpoint === "playerImage" ? "4MB" : "2MB"}`);
            return;
          }

          // Show preview
          const reader = new FileReader();
          reader.onloadend = () => {
            setPreviewUrl(reader.result as string);
          };
          reader.readAsDataURL(file);

          setIsUploading(true);
          await startUpload([file]);
        }
      } catch (err) {
        console.error("Error processing image:", err);
        onUploadError?.(err instanceof Error ? err.message : "Failed to process image");
        setIsProcessing(false);
        setIsUploading(false);
      }
    },
    [startUpload, endpoint, onUploadError, enableResize, onUploadComplete]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await processFile(file);
      }
    },
    [processFile]
  );

  // Handle paste events
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Check if we're already processing or uploading
      if (isProcessing || isUploading) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Find pasted image
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Check if it's an image
        if (item.type.startsWith('image/')) {
          e.preventDefault(); // Prevent default paste behavior
          setIsPasteReady(false); // Reset paste ready state
          
          const blob = item.getAsFile();
          if (blob) {
            // Convert blob to File with a proper name
            const file = new File(
              [blob], 
              `pasted-image-${Date.now()}.${blob.type.split('/')[1]}`,
              { type: blob.type }
            );
            
            await processFile(file);
            break; // Only process the first image
          }
        }
      }
    };

    const handleFocus = () => setIsPasteReady(true);
    const handleBlur = () => setIsPasteReady(false);

    // Add event listeners
    document.addEventListener('paste', handlePaste);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    
    // Cleanup
    return () => {
      document.removeEventListener('paste', handlePaste);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [processFile, isProcessing, isUploading]);

  const displayImage = previewUrl || currentImage;

  return (
    <div className={`space-y-4 ${className} ${isPasteReady ? 'ring-2 ring-[var(--primary)] ring-opacity-30 rounded-lg p-2' : ''}`}>
      {/* Paste indicator */}
      {!displayImage && !isProcessing && !isUploading && (
        <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-6 text-center">
          <div className="text-2xl mb-2">📋</div>
          <p className="text-sm text-[var(--muted)] mb-2">
            Paste an image from your clipboard
          </p>
          <p className="text-xs text-[var(--muted)]">
            Copy an image and press Ctrl+V (Cmd+V on Mac)
          </p>
          <div className="relative mt-4 mb-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border)]"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-[var(--bg)] text-[var(--muted)]">OR</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Current/Preview Image */}
      {displayImage && (
        <div className="relative">
          <img
            src={previewUrl || getImageUrl(currentImage) || undefined}
            alt="Upload preview"
            className="w-32 h-32 rounded-lg object-cover border border-[var(--border)]"
          />
          {(isUploading || isProcessing) && (
            <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
              <div className="text-white text-sm font-medium">
                {isProcessing ? "Processing..." : `${uploadProgress}%`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Button */}
      <div>
        <label
          htmlFor="image-upload"
          className={`inline-flex items-center justify-center px-4 py-2 rounded font-medium border transition cursor-pointer
            ${(isUploading || isProcessing)
              ? "bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed" 
              : "border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white"
            }`}
        >
          {isProcessing ? (
            <>
              <span className="animate-spin mr-2">⚙️</span>
              Processing image...
            </>
          ) : isUploading ? (
            <>
              <span className="animate-spin mr-2">⚡</span>
              Uploading... {uploadProgress}%
            </>
          ) : (
            <>
              📸 {displayImage ? "Change" : "Upload"} Photo
            </>
          )}
        </label>
        <input
          id="image-upload"
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleFileSelect}
          disabled={isUploading || isProcessing}
          className="hidden"
        />
      </div>

      {/* Help text */}
      <div className="space-y-1">
        <p className="text-xs text-[var(--muted)]">
          {endpoint === "playerImage" 
            ? "Max 10MB • PNG, JPG, or WebP" 
            : "Max 2MB • PNG, JPG, or SVG"}
        </p>
        <p className="text-xs text-[var(--muted)]">
          💡 Tip: You can paste an image with Ctrl+V (or Cmd+V on Mac)
        </p>
        {enableResize && (
          <p className="text-xs text-[var(--muted)]">
            Images will be resized to: 150px (thumbnail), 600px (medium), 1200px (large)
          </p>
        )}
      </div>
    </div>
  );
}