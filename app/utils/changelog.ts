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
