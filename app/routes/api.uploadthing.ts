import type { Route } from "./+types/api.uploadthing";
import { createRouteHandler } from "uploadthing/server";
import { uploadRouter } from "~/server/uploadthing";

// Create the route handler with our file router
const handlers = createRouteHandler({
  router: uploadRouter,
  config: {
    token: process.env.UPLOADTHING_TOKEN,
  },
});

// Export properly typed handlers for React Router v7
export async function loader({ request }: Route.LoaderArgs) {
  return await handlers(request);
}

export async function action({ request }: Route.ActionArgs) {
  return await handlers(request);
}