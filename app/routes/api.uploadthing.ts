// import type { Route } from "./+types/api.uploadthing";
import { createRouteHandler } from "uploadthing/remix";
import { uploadRouter } from "~/server/uploadthing";

// Create the route handler with our file router
const { loader, action } = createRouteHandler({
  router: uploadRouter,
  config: {
    token: process.env.UPLOADTHING_TOKEN,
  },
});

export { loader, action };
// Export properly typed handlers for React Router v7
// export async function loader({ request }: Route.LoaderArgs) {
//   return await GET(request);
// }

// export async function action({ request }: Route.ActionArgs) {
//   return await POST(request);
// }