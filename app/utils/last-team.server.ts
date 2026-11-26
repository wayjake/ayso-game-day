import { createCookie } from "react-router";
import { parseId } from "~/utils/ids";

// Remembers the team a coach last opened, so /dashboard can drop them
// straight back into it instead of making them pick from a list.
export const lastTeamCookie = createCookie("ayso_last_team", {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});

// Holds the team's id (a UUID). Cookies from before ids were UUIDs hold a
// number, which reads as no team.
export async function getLastTeamId(request: Request): Promise<string | null> {
  const value = await lastTeamCookie.parse(request.headers.get("Cookie"));
  return parseId(value);
}
