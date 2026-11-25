import type { Route } from "./+types/family.feed";
import { data } from "react-router";
import { inArray } from "drizzle-orm";
import { db, teams } from "~/db";
import { requireParent } from "~/utils/family.server";
import { getFeedPage } from "~/utils/feed.server";
import { postPath } from "~/utils/feed";
import { feedChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { FeedTimeline } from "~/components/feed/FeedTimeline";

// Family app: photos and videos from every team the parent has kids on

export async function loader({ request }: Route.LoaderArgs) {
  const { user, teamIds } = await requireParent(request);
  const [feed, teamRows] = await Promise.all([
    getFeedPage({ viewerId: user.id, teamIds }),
    db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)).orderBy(teams.name),
  ]);
  return data({
    me: { id: user.id, name: user.name || user.email.split("@")[0] },
    teams: teamRows,
    feed,
    channels: isRealtimeConfigured() ? teamIds.map(feedChannel) : [],
  });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Team feed - BenchTalk" }];
}

export default function FamilyFeed({ loaderData }: Route.ComponentProps) {
  const { me, teams, feed, channels } = loaderData;
  return (
    <div className="pt-6">
      <h1 className="sr-only">Team feed</h1>
      <FeedTimeline
        feed={feed}
        scope={{ kind: "family" }}
        me={me}
        teams={teams}
        channels={channels}
        postHref={(id) => postPath("family", id)}
        showTeamName={teams.length > 1}
      />
    </div>
  );
}
