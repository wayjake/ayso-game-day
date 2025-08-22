import { generateReactHelpers } from "@uploadthing/react";
import type { OurFileRouter } from "~/server/uploadthing";

// 🚀 Generate typed hooks for UploadThing
export const { useUploadThing, uploadFiles } = generateReactHelpers<OurFileRouter>({
  url: "/api/uploadthing",
});