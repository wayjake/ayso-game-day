import { useState, useCallback } from "react";
import { useUploadThing } from "~/utils/uploadthing";
import { getImageUrl } from "~/utils/image";

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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { startUpload } = useUploadThing(endpoint, {
    onClientUploadComplete: (res) => {
      // 🎉 Upload complete!
      if (res?.[0]?.url) {
        onUploadComplete(res[0].url);
        setPreviewUrl(null);
      }
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

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!validTypes.includes(file.type)) {
        onUploadError?.("Please select a valid image file (PNG, JPG, or WebP)");
        return;
      }

      // Validate file size (4MB max for player images)
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

      // Start upload
      setIsUploading(true);
      const files = [file];
      await startUpload(files);
    },
    [startUpload, endpoint, onUploadError]
  );

  const displayImage = previewUrl || currentImage;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Current/Preview Image */}
      {displayImage && (
        <div className="relative">
          <img
            src={previewUrl || getImageUrl(currentImage)}
            alt="Upload preview"
            className="w-32 h-32 rounded-lg object-cover border border-[var(--border)]"
          />
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
              <div className="text-white text-sm font-medium">
                {uploadProgress}%
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
            ${isUploading 
              ? "bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed" 
              : "border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white"
            }`}
        >
          {isUploading ? (
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
          disabled={isUploading}
          className="hidden"
        />
      </div>

      {/* Help text */}
      <p className="text-xs text-[var(--muted)]">
        {endpoint === "playerImage" 
          ? "Max 4MB • PNG, JPG, or WebP" 
          : "Max 2MB • PNG, JPG, or SVG"}
      </p>
    </div>
  );
}