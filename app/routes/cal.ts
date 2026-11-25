import type { Route } from "./+types/cal";
import { buildCalendarFeed } from "~/utils/calendar-feed.server";

// A person's subscribed calendar (Apple Calendar, Google Calendar, Outlook).
// No sign-in: calendar apps fetch it on their own, so the token is the key.
// The route is /cal/:file because the .ics on the end can't be part of a param.

export async function loader({ params, request }: Route.LoaderArgs) {
  const token = params.file.replace(/\.ics$/i, "");
  const body = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? await buildCalendarFeed(token, request) : null;
  if (body === null) {
    return new Response("This calendar link has been reset or doesn't exist.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
    });
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="benchtalk.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
