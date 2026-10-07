import { createCookie } from "react-router";

// Remembers the team a coach last opened, so /dashboard can drop them
// straight back into it instead of making them pick from a list.
export const lastTeamCookie = createCookie("ayso_last_team", {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});

export async function getLastTeamId(request: Request): Promise<number | null> {
  const value = await lastTeamCookie.parse(request.headers.get("Cookie"));
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
