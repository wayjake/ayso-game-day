import { createUploadthing, type FileRouter } from "uploadthing/server";
import { UploadThingError } from "uploadthing/server";

const f = createUploadthing({
  errorFormatter: (err) => {
    console.log("UploadThing Error:", err);
    return {
      message: err.message,
      code: err.code,
    };
  },
});

// 🎯 FileRouter for AYSO team management app
export const uploadRouter = {
  // Player profile picture uploader
  playerImage: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
      acceptedFileTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
    },
  })
    .middleware(async ({ req }) => {
      // TODO: Add auth check here when we have access to session
      // For now, we'll pass through but in production you'd check:
      // const user = await getUser(req);
      // if (!user) throw new UploadThingError("Unauthorized");
      
      // Return metadata to be stored with the file
      return { uploadedBy: "user" };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // This code runs on the server after upload
      console.log("✅ Upload complete for userId:", metadata.uploadedBy);
      console.log("📸 File url:", file.url);
      
      // Return data to be sent to the client
      return { uploadedBy: metadata.uploadedBy, url: file.url };
    }),
    
  // Team logo uploader (for future use)
  teamLogo: f({
    image: {
      maxFileSize: "2MB",
      maxFileCount: 1,
      acceptedFileTypes: ["image/png", "image/jpeg", "image/svg+xml"],
    },
  })
    .middleware(async ({ req }) => {
      // TODO: Add auth and team ownership check
      return { uploadedBy: "user" };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("🛡️ Team logo uploaded:", file.url);
      return { url: file.url };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof uploadRouter;