import type { Route } from "./+types/family.feed.post";
import { data } from "react-router";
import { requireParent } from "~/utils/family.server";
import { getComments, getLikers, getPost } from "~/utils/feed.server";
import { feedChannel, isRealtimeConfigured } from "~/utils/realtime.server";
import { PostDetail } from "~/components/feed/PostDetail";
import { parseId } from "~/utils/ids";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, teamIds } = await requireParent(request);
  const me = { id: user.id, name: user.name || user.email.split("@")[0] };
  const postId = parseId(params.postId);
  const found = postId ? await getPost(postId, user.id) : null;
  // Deleted, or not on one of this parent's teams: the same answer either way
  if (!found) return data({ post: null, comments: [], likers: [], me, multiTeam: false, channels: [] }, { status: 404 });
  const { post } = found;
  const [comments, likers] = await Promise.all([getComments(post.id, post.teamId, user.id), getLikers(post.id)]);
  return data({
    post,
    comments,
    likers,
    me,
    multiTeam: teamIds.length > 1,
    channels: isRealtimeConfigured() ? [feedChannel(post.teamId)] : [],
  });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.post ? `${data.post.author.name}'s post - BenchTalk` : "Post - BenchTalk" }];
}

export default function FamilyPost({ loaderData }: Route.ComponentProps) {
  const { post, comments, likers, me, multiTeam, channels } = loaderData;
  return (
    <div className="pt-4">
      <PostDetail
        post={post}
        comments={comments}
        likers={likers}
        me={me}
        feedHref="/family/feed"
        showTeamName={multiTeam}
        channels={channels}
        // Above the phone tab bar; the tab bar is gone from sm up
        composerClassName="bottom-[calc(4rem+env(safe-area-inset-bottom))] sm:bottom-0"
      />
    </div>
  );
}
