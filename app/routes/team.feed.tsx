import type { Route } from "./+types/team.feed";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { getFeedPage } from "~/utils/feed.server";
import { postPath } from "~/utils/feed";
import { feedChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { FeedTimeline } from "~/components/feed/FeedTimeline";
import { Page, PageHeader } from "~/components/ui";

// Coach view of the team's photo feed: post, like, comment, and delete anything

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team } = await requireTeamAccess(teamId, user.id);
  return data({
    me: { id: user.id, name: user.name || user.email.split("@")[0] },
    team: { id: team.id, code: team.code, name: team.name },
    feed: await getFeedPage({ viewerId: user.id, teamIds: [team.id] }),
    channels: isRealtimeConfigured() ? [feedChannel(team.id)] : [],
  });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Feed - BenchTalk" }];
}

export default function TeamFeed({ loaderData }: Route.ComponentProps) {
  const { me, team, feed, channels } = loaderData;
  return (
    <Page width="narrow">
      <PageHeader title="Feed" description="Photos and videos from the team. Only coaches and families on the team can see them." />
      <FeedTimeline
        feed={feed}
        scope={{ kind: "team", teamId: team.id }}
        me={me}
        teams={[team]}
        channels={channels}
        postHref={(id) => postPath({ teamCode: team.code }, id)}
        showTeamName={false}
      />
    </Page>
  );
}
