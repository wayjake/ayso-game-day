import { createUploadthing, type FileRouter } from "uploadthing/remix";
import { UploadThingError } from "uploadthing/server";
import { db, teams } from "~/db";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";

// The Remix adapter hands middleware `{ event }`, so the request is event.request
const f = createUploadthing({
  errorFormatter: (err) => {
    console.log("UploadThing Error:", err);
    return {
      message: err.message,
      code: err.code,
    };
  },
});

// Player photos and team logos: only signed-in team staff (anyone who can open
// at least one team). Parents and signed-out visitors are refused.
const forbidden = () => new UploadThingError({ code: "FORBIDDEN", message: "Unauthorized" });

async function requireStaffUploader(request: Request) {
  const user = await getUser(request, false);
  if (!user) throw forbidden();
  const [team] = await db.select({ id: teams.id }).from(teams).where(canAccessTeam(user.id)).limit(1);
  if (!team) throw forbidden();
  return { userId: user.id };
}

export const uploadRouter = {
  // Player profile picture uploader (supports multiple sizes)
  playerImage: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 3, // Allow 3 files for thumbnail, medium, and large
    },
  })
    .middleware(({ event }) => requireStaffUploader(event.request))
    .onUploadComplete(async ({ metadata, file }) => {
      return { uploadedBy: metadata.userId, url: file.ufsUrl || file.url };
    }),

  // Team logo uploader (for future use)
  teamLogo: f({
    image: {
      maxFileSize: "2MB",
      maxFileCount: 1,
    },
  })
    .middleware(({ event }) => requireStaffUploader(event.request))
    .onUploadComplete(async ({ file }) => {
      return { url: file.ufsUrl || file.url };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof uploadRouter;
