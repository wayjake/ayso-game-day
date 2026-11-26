// Links into a team's pages. URLs carry the team's short code, never its id
// (see utils/ids.ts), so pass the team (or anything with its code).
export function teamPath(team: { code: string } | string, path = ""): string {
  const code = typeof team === "string" ? team : team.code;
  // A team id (a UUID) here is a bug: links carry the code. Fail loudly.
  if (code.includes("-")) throw new Error(`teamPath was given a team id, not its code: ${code}`);
  const rest = path && !path.startsWith("/") && !path.startsWith("?") ? `/${path}` : path;
  return `/dashboard/team/${code}${rest}`;
}
