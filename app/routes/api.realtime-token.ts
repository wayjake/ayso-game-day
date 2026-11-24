import type { Route } from "./+types/api.realtime-token";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { createTokenRequest } from "~/utils/realtime.server";

// Ably calls this (authUrl) for a short-lived token whenever it connects or
// its token runs out. Channel access is worked out fresh each time, so a
// parent removed from a team loses access within the hour.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request, false);
  if (!user) return data({ error: "Sign in first" }, { status: 401 });
  const tokenRequest = await createTokenRequest(user.id);
  if (!tokenRequest) return data({ error: "Realtime isn't set up" }, { status: 503 });
  return data(tokenRequest, { headers: { "Cache-Control": "no-store" } });
}
