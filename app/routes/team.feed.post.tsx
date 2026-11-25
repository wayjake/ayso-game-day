import type { Route } from "./+types/team.feed.post";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getComments, getLikers, getPost } from "~/utils/feed.server";
import { feedChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { PostDetail } from "~/components/feed/PostDetail";
import { Page } from "~/components/ui";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = Number(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const me = { id: user.id, name: user.name || user.email.split("@")[0] };
  const found = await getPost(Number(params.postId), user.id);
  // Another team's post (even one this coach can see elsewhere) isn't shown under this team
  if (!found || found.post.teamId !== team.id) {
    return data({ teamId: team.id, post: null, comments: [], likers: [], me, channels: [] }, { status: 404 });
  }
  const { post } = found;
  const [comments, likers] = await Promise.all([getComments(post.id, post.teamId, user.id), getLikers(post.id)]);
  return data({
    teamId: team.id,
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
  const { teamId, post, comments, likers, me, channels } = loaderData;
  return (
    <Page width="narrow">
      <PostDetail
        post={post}
        comments={comments}
        likers={likers}
        me={me}
        feedHref={`/dashboard/team/${teamId}/feed`}
        showTeamName={false}
        channels={channels}
      />
    </Page>
  );
}
