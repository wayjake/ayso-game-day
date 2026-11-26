import type { Route } from "./+types/team.feed.post";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { getComments, getLikers, getPost } from "~/utils/feed.server";
import { feedChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { PostDetail } from "~/components/feed/PostDetail";
import { Page } from "~/components/ui";
import { teamPath } from "~/utils/team-path";
import { parseId } from "~/utils/ids";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  const { team } = await requireTeamAccess(teamId, user.id);
  const me = { id: user.id, name: user.name || user.email.split("@")[0] };
  const postId = parseId(params.postId);
  const found = postId ? await getPost(postId, user.id) : null;
  // Another team's post (even one this coach can see elsewhere) isn't shown under this team
  if (!found || found.post.teamId !== team.id) {
    return data({ teamCode: team.code, post: null, comments: [], likers: [], me, channels: [] }, { status: 404 });
  }
  const { post } = found;
  const [comments, likers] = await Promise.all([getComments(post.id, post.teamId, user.id), getLikers(post.id)]);
  return data({
    teamCode: team.code,
    post,
    comments,
    likers,
    me,
    channels: isRealtimeConfigured() ? [feedChannel(team.id)] : [],
  });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.post ? `${data.post.author.name}'s post - BenchTalk` : "Post - BenchTalk" }];
}

export default function TeamPost({ loaderData }: Route.ComponentProps) {
  const { teamCode, post, comments, likers, me, channels } = loaderData;
  return (
    <Page width="narrow">
      <PostDetail
        post={post}
        comments={comments}
        likers={likers}
        me={me}
        feedHref={teamPath(teamCode, "feed")}
        showTeamName={false}
        channels={channels}
      />
    </Page>
  );
}
