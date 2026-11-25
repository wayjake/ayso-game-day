import { useState, useCallback, useEffect } from "react";
import { useUploadThing } from "~/utils/uploadthing";
import { getImageUrl } from "~/utils/image";
import { buttonClass, cx } from "~/components/ui";
import { Camera, CircleNotch, ClipboardText, UploadSimple } from "@phosphor-icons/react";
import { makeSquareJpeg } from "~/utils/media-derivatives.client";

// Player photos only ever show as squares, 96px at most (avatars are 32–56px),
// so one 320px square JPEG covers a 3x screen with large text, at ~20KB.
// The original never leaves the device.
const PHOTO_EDGE = 320;

interface ImageUploaderProps {
  currentImage?: string | null;
  onUploadComplete: (url: string) => void;
  onUploadError?: (error: string) => void;
  endpoint?: "playerImage" | "teamLogo";
  className?: string;
}

export function ImageUploader({
  currentImage,
  onUploadComplete,
  onUploadError,
  endpoint = "playerImage",
  className = "",
}: ImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPasteReady, setIsPasteReady] = useState(false);

  const { startUpload } = useUploadThing(endpoint, {
    onClientUploadComplete: (res) => {
      const file = res?.[0];
      if (file) onUploadComplete(file.ufsUrl || file.url);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setIsUploading(false);
      setUploadProgress(0);
    },
    onUploadError: (error: Error) => {
      // Something went wrong
      console.error("Upload error:", error);
      onUploadError?.(error.message || "Upload failed");
      setIsUploading(false);
      setUploadProgress(0);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    },
    onUploadProgress: (progress) => {
      // Track upload progress
      setUploadProgress(progress);
    },
  });

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        onUploadError?.("Choose a photo (JPG, PNG, WebP or HEIC)");
        return;
      }
      setIsProcessing(true);
      try {
        const photo = await makeSquareJpeg(file, PHOTO_EDGE);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(photo);
        });
        setIsProcessing(false);
        setIsUploading(true);
        await startUpload([photo]);
      } catch (err) {
        console.error("Error processing image:", err);
        onUploadError?.(err instanceof Error ? err.message : "Failed to process image");
        setIsUploading(false);
      } finally {
        setIsProcessing(false);
      }
    },
    [startUpload, onUploadError]
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
  const busy = isUploading || isProcessing;

  return (
    <div
      className={cx(
        "flex items-start gap-4 rounded-xl transition",
        isPasteReady && "ring-2 ring-primary/20 ring-offset-4 ring-offset-surface",
        className
      )}
    >
      {/* Current/preview image, or an empty tile that hints at pasting */}
      {displayImage ? (
        <div className="relative shrink-0">
          <img
            src={previewUrl || getImageUrl(currentImage) || undefined}
            alt="Upload preview"
            className="h-24 w-24 rounded-2xl object-cover ring-1 ring-line"
          />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-ink/60">
              <div className="text-sm font-semibold text-white tabular">
                {isProcessing ? "Processing..." : `${uploadProgress}%`}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-subtle">
          {busy ? <CircleNotch size={24} className="animate-spin" /> : <Camera size={24} />}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Upload button */}
        <label
          htmlFor="image-upload"
          className={buttonClass({
            variant: "secondary",
            className: busy ? "pointer-events-none opacity-50" : "cursor-pointer",
          })}
        >
          {isProcessing ? (
            <>
              <CircleNotch size={18} className="animate-spin" />
              Processing image...
            </>
          ) : isUploading ? (
            <>
              <CircleNotch size={18} className="animate-spin" />
              Uploading... {uploadProgress}%
            </>
          ) : (
            <>
              <UploadSimple size={18} />
              {displayImage ? "Change photo" : "Upload photo"}
            </>
          )}
        </label>
        <input
          id="image-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          onChange={handleFileSelect}
          disabled={busy}
          className="hidden"
        />

        {/* Help text */}
        <div className="mt-2 space-y-0.5 text-xs text-muted">
          <p className="flex items-center gap-1.5">
            <ClipboardText size={14} className="shrink-0" />
            Or paste an image with Ctrl+V (Cmd+V on Mac)
          </p>
          <p>JPG, PNG, WebP or HEIC · cropped to a square</p>
        </div>
      </div>
    </div>
  );
}
