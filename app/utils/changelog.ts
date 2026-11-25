// What's new, newest first. Add a release here when preview ships to main.
// Written for coaches and families, not developers.

export type ChangeKind = "new" | "improved" | "fixed";

export type Release = {
  date: string; // YYYY-MM-DD
  title: string;
  summary: string;
  changes: { kind: ChangeKind; text: string }[];
};

export const releases: Release[] = [
  {
    date: "2026-11-25",
    title: "Announcements side by side",
    summary: "On a computer, announcements open beside their list, the same way messages do.",
    changes: [
      { kind: "improved", text: "On a computer, the announcements list stays on the left and the one you open, or a new one you're writing, fills the rest of the screen, just like the Inbox." },
      { kind: "fixed", text: "The Inbox and Announcements switch is split evenly, so the one you're on fills its half." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Cancel a practice your way",
    summary: "When you cancel or restore a practice, you choose whether families hear about it, and see exactly what they'll get.",
    changes: [
      { kind: "improved", text: "Cancelling or restoring a practice asks first, and lets you choose whether to notify families. If you don't, it just shows as cancelled on the schedule." },
      { kind: "new", text: "Edit the notification's title and message before it goes out, with a preview of how it looks on a phone, and see how many parents will get it." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Your account, one tap away",
    summary: "A round avatar with your initials at the top of the app opens your account, and coaches can now choose which notifications they get.",
    changes: [
      { kind: "new", text: "Your initials, in a colour all your own, sit at the top right of every page in place of the little log-out icon. Tap them for your account settings, or to log out." },
      { kind: "new", text: "Coaches have an Account page with your name, notifications and email address in one place. They apply to every team you're on, so they're no longer under each team's Settings." },
      { kind: "new", text: "Coaches get the notifications bell at the top of the app, and on a phone BenchTalk offers to turn notifications on, just like it does for families." },
      { kind: "improved", text: "Choose which kinds of notifications you get, like chat messages, reactions or players dropping out, even before you've turned them on for a device." },
      { kind: "improved", text: "Coaches who are also parents can switch to the family view from the avatar menu, and see the coach-only notification kinds there too." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Delete a message",
    summary: "Sent something to the wrong family, or said it wrong? Delete it from a private chat.",
    changes: [
      { kind: "new", text: "In a private chat, tap one of your own messages and choose Delete. It's removed for both of you; if people replied to it, their replies stay." },
      { kind: "new", text: "Before you delete, BenchTalk tells you if the message was also emailed, since the email can't be taken back, and that a notification they already got may still show it." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Lighter player photos",
    summary: "Player photos load faster and look sharper, and videos in the feed show their first frame until you press play.",
    changes: [
      { kind: "improved", text: "A new player photo is cropped to a square and shrunk on your phone or computer before it uploads, so rosters and lineups load faster and the photo looks sharp at every size." },
      { kind: "improved", text: "iPhone photos (HEIC) can be used as player photos." },
      { kind: "improved", text: "Videos in the feed show their first frame until you press play, and nothing of the video downloads before then." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Full-width top bar",
    summary: "On a big screen, the bar along the top of the coach pages now runs the whole width of the window.",
    changes: [
      { kind: "improved", text: "On wide screens, the BenchTalk bar, team name and tabs stretch edge to edge, lining up with Messages instead of floating in the middle." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Read receipts",
    summary: "See when your messages have been read, and who in a group has seen them.",
    changes: [
      { kind: "new", text: "Your messages show one check once they're sent and two once they've been read." },
      { kind: "new", text: "Tap a message in a private chat to see when it was read, like \"Read today at 11:15 AM\"." },
      { kind: "new", text: "In a group or the team chat, tap any message to see who has seen it and when. Everyone in the chat can see this." },
      { kind: "improved", text: "A message only counts as read once you've actually looked at it, not while BenchTalk is open in a tab you aren't looking at." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Follows your text size",
    summary: "BenchTalk on iPhone and iPad now follows your Text Size setting, and forms are easier to see.",
    changes: [
      { kind: "improved", text: "On iPhone and iPad, text follows the size you've picked in Settings, from smaller to the largest accessibility sizes, and pages reflow to fit." },
      { kind: "improved", text: "Text boxes and checkboxes have clearer edges, so empty ones are easy to spot." },
      { kind: "improved", text: "The smallest labels, like positions on the lineup field, are larger, and email addresses, phone numbers, map links and photo arrows are easier to tap." },
      { kind: "new", text: "BenchTalk on iPad opens with its logo instead of a blank screen, in either orientation." },
      { kind: "fixed", text: "The team overview no longer runs off the side of a phone screen." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Easier to tap",
    summary: "Buttons, checkboxes and links are easier to hit on a phone, and BenchTalk fills the screen sideways.",
    changes: [
      { kind: "improved", text: "On phones, buttons and checkboxes are bigger targets, and small icons like back arrows and close buttons respond to a tap anywhere near them." },
      { kind: "improved", text: "Turn your phone sideways and BenchTalk fills the screen, keeping clear of the notch." },
      { kind: "improved", text: "Times, hints and other small grey text are darker and easier to read." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Group chats",
    summary: "Message several families at once, or start a group with other parents, for carpools, snacks or anything else.",
    changes: [
      { kind: "new", text: "Start a group chat from New message: pick several families, coaches or team managers and give it a name if you like. Pick just one family and it's your private message with them, as before." },
      { kind: "new", text: "Families can start groups too, with other families or with staff, from the New button in Messages." },
      { kind: "new", text: "Only the people in a group can see it. A group of parents stays between them, unless they add a coach." },
      { kind: "new", text: "Whoever starts a group can rename it and add or remove people, and anyone can leave. Families not on BenchTalk yet can be added, and they see the whole conversation once they join." },
      { kind: "improved", text: "\"Send a test\" notification now tells you whether it really went out, and where your phone or computer settings might be hiding notifications." },
      { kind: "fixed", text: "Notifications that had stopped arriving on some devices start working again on their own." },
    ],
  },
  {
    date: "2026-11-25",
    title: "A proper start on iPhone",
    summary: "The app opens to the BenchTalk logo instead of a blank screen.",
    changes: [
      { kind: "improved", text: "On iPhone, BenchTalk opens with its logo while it loads, instead of a blank screen. Remove BenchTalk from your Home Screen and add it again to get it." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Tasks for families",
    summary: "Ask families to pay a fee, sign a form or anything else, and see at a glance who has done it.",
    changes: [
      { kind: "new", text: "Tasks: give families something to do, like paying the uniform fee or signing the code of conduct, for the whole team or just some players. Find it under Roster > Tasks." },
      { kind: "new", text: "See every player and every task in one grid, grouped by family, and open any task for who has and hasn't done it." },
      { kind: "new", text: "Families check tasks off in the app. Families who aren't on BenchTalk yet get a link that works without signing in." },
      { kind: "new", text: "Confirm a task yourself, for example once a payment arrives, one family at a time or several at once. A task can count as done only once a coach confirms it, and can count once per family so brothers and sisters share it." },
      { kind: "new", text: "Message a family from Tasks with what they still have to do already written for you, ready to edit and send." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Private messages, and an app that feels like an app",
    summary: "Messages with a coach are now between the two of you, announcements to everyone go in the team chat, and the app moves like a phone app.",
    changes: [
      { kind: "improved", text: "Direct messages are one-to-one. A family's message to a coach, assistant coach or team manager is seen by that person only, not the rest of the staff." },
      { kind: "new", text: "Families can message any coach, assistant coach or team manager on their own, with each person's role shown next to their name." },
      { kind: "improved", text: "An announcement to every family is posted in the team chat, and replies, even ones sent by email, go under it there. An announcement to a few families stays private, with replies only the sender sees." },
      { kind: "new", text: "See who tapped \"Got it\" on an announcement, by name, in the tracker and right under the announcement in Messages." },
      { kind: "improved", text: "On iPhone, the top bar now reaches behind the notch, screens slide in and out, sheets drag away like a native app's, and you can pull down to refresh." },
      { kind: "improved", text: "Tapping no longer flashes grey or zooms into text boxes, and buttons and tabs respond the moment you touch them." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Families with more than one parent",
    summary: "Every parent and guardian of a player now lives in one family, and inviting them takes one click.",
    changes: [
      { kind: "new", text: "Edit every parent or guardian of a family on one page. Add a second parent, update emails and phones, and pick the players once for everyone." },
      { kind: "new", text: "Make a parent an assistant coach or team manager straight from their family. If they aren't on BenchTalk yet, they get a coach invite, and accepting it links them to their kids too." },
      { kind: "new", text: "\"Add and invite\" saves a new family and sends their invites in one step." },
      { kind: "improved", text: "The Families list shows one row per family, with a line for each parent's status, role and invite." },
      { kind: "improved", text: "Invite emails now explain what BenchTalk is, name the team and its coaches, and show how to add BenchTalk to an iPhone or Android home screen." },
      { kind: "improved", text: "Removing a parent, or changing their email, cancels any coach invite still waiting for them." },
      { kind: "fixed", text: "Filters on the announcement tracker wrap on phones instead of running off the screen, and the Schedule page always shows both Schedule game and Add practice." },
    ],
  },
  {
    date: "2026-11-24",
    title: "Team feed and staff roles",
    summary: "Share photos and videos with the team, and give your helpers the right title.",
    changes: [
      { kind: "new", text: "A team photo and video feed. Coaches and parents can post, like and comment, and only people on the team can see it." },
      { kind: "new", text: "Staff roles: coach, assistant coach and team manager. Each person's role shows next to their messages, and the team owner picks it when inviting them." },
      { kind: "improved", text: "Videos in the feed play without opening the post, and an open post keeps up with new likes and comments even on a spotty connection." },
      { kind: "fixed", text: "Only signed-in coaches on the team can upload player photos and team logos." },
    ],
  },
  {
    date: "2026-11-24",
    title: "Hello, BenchTalk",
    summary: "AYSO Game Day is now BenchTalk, with live chat and a new home for every message.",
    changes: [
      { kind: "new", text: "AYSO Game Day is now BenchTalk, with a new look and home page." },
      { kind: "new", text: "Team chat updates live, with typing indicators." },
      { kind: "new", text: "React to any message, or reply to it in a thread." },
      { kind: "new", text: "Choose which notifications you get: chat, replies, reactions and more. Team announcements and schedule changes always come through." },
      { kind: "new", text: "Team emails come from an address for your team, and families' replies land back in their thread." },
      { kind: "improved", text: "On a computer, Messages shows your conversations, the open thread and the family's details side by side." },
      { kind: "improved", text: "The team overview starts with what needs you, followed by the next two weeks with RSVPs." },
      { kind: "improved", text: "Click a family to see their RSVPs, how they answered announcements, and your notes, without leaving the Families list." },
      { kind: "fixed", text: "A message in a family's thread is only emailed to them when you tick \"Send by email\"." },
    ],
  },
];
