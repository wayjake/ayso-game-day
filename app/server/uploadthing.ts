import { createUploadthing, type FileRouter } from "uploadthing/remix";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { db, postUploads, teams } from "~/db";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { feedRole } from "~/utils/feed.server";
import { isId } from "~/utils/ids";

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
  // Player photo: one 320px square JPEG, made in the browser (ImageUploader)
  playerImage: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
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

  // Team feed photos and videos. Files upload the moment they're picked in the
  // composer and wait in post_uploads as drafts until "Post" (api/feed).
  // Anyone on the team's staff or a parent on it can post; the browser's
  // smaller copies (utils/media-derivatives.client.ts) come through here too.
  feedMedia: f({
    image: { maxFileSize: "32MB", maxFileCount: 10 },
    video: { maxFileSize: "1GB", maxFileCount: 3 },
  })
    .input(z.object({ teamId: z.string().refine(isId, "Not a team id") }))
    .middleware(async ({ event, input }) => {
      const user = await getUser(event.request, false);
      if (!user || !(await feedRole(user.id, input.teamId))) throw forbidden();
      return { userId: user.id, teamId: input.teamId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await db
        .insert(postUploads)
        .values({
          fileKey: file.key,
          userId: metadata.userId,
          teamId: metadata.teamId,
          type: file.type.startsWith("video/") ? "video" : "image",
          url: file.ufsUrl,
          name: file.name,
          size: file.size,
        })
        .onConflictDoNothing({ target: postUploads.fileKey });
      return { key: file.key };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof uploadRouter;
