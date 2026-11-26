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
    date: "2026-11-26",
    title: "Which part comes back",
    summary: "A refundable expense now says how much of it can come back, like the referee deposit.",
    changes: [
      { kind: "improved", text: "Coaches: when an expense is refundable, say how much of it can come back. Its card reads \"$400 refundable\" instead of marking the whole thing." },
      { kind: "improved", text: "Families see which part of their share can come back, and that it's shared out when the coach settles up." },
      { kind: "fixed", text: "Signing in no longer gets stuck going round in circles for people who were signed in before this week's update." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Private links",
    summary: "Links to your team, messages and games no longer give anything away, and you'll need to sign in once.",
    changes: [
      { kind: "improved", text: "Team links now use a short code, like /dashboard/team/k7xm2pq, and every message, game and player has a private id that can't be guessed. Links no longer show how many teams or messages there are." },
      { kind: "improved", text: "Everyone signs in again once after this update (families can use the email sign-in link or code as before). Links in older emails and notifications, and bookmarks to team pages, won't open: start from the app instead." },
      { kind: "improved", text: "If you subscribed to your calendar link, your games and practices show up fresh once; nothing else changes." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Expenses on the schedule",
    summary: "Link an expense to the games it's for, and everyone sees what each game costs.",
    changes: [
      { kind: "new", text: "Coaches: pick the games an expense is for, like every game of a tournament. Its cost shows on those games in your schedule." },
      { kind: "new", text: "Families see their share on each of those games in their schedule." },
      { kind: "new", text: "Match RSVPs: when picking who shares an expense, one tap leaves off anyone whose family said they can't make any of its games." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Settle up",
    summary: "When a tournament or trip is done, settle up and everyone pays exactly their share of what it really cost.",
    changes: [
      { kind: "new", text: "Coaches: Settle up on an expense splits what the team really paid, less any deposit or refund that came back, by share. You see what each family gets back (or owes) before you confirm, and it goes on their next invoice." },
      { kind: "new", text: "A refund that arrives after you've settled up is shared the same way on the next invoice, so there's nothing to redo." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Pay without signing in",
    summary: "Families get their invoice by email, with a link to pay on Venmo. No account needed.",
    changes: [
      { kind: "new", text: "Sending invoices emails each family theirs, from your address, with a link to see what they owe and pay on Venmo, no sign-in needed. Replies come back to you." },
      { kind: "new", text: "Coaches: copy any family's pay link from a sent invoice to text it to them." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Expenses, shares and invoices",
    summary: "Add an expense once, pick who shares it, and send each family one invoice for everything they owe.",
    changes: [
      { kind: "new", text: "Coaches: an expense can split a total into full and half shares, rounded up to the dollar if you like, or give each person their own amount, like a merch order. Change who shares it any time; nothing reaches families until you send invoices." },
      { kind: "new", text: "Send invoices puts every new share on one invoice per family, covering all their kids. Brothers and sisters land on the same invoice. Once sent, an invoice never changes: anything later goes on the next one, and you can see which invoices are paid." },
      { kind: "new", text: "Someone joining late pays the same share as everyone else, worked out on the first invoice." },
      { kind: "new", text: "Families see each invoice and their share of every expense, with one amount to pay for all their kids." },
      { kind: "improved", text: "Clearer words throughout: an expense, your share, paid out, collected and refunds." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Finances, Families and Tasks get their own tabs",
    summary: "Everything about money is now called Finances, and it sits in the tab bar for coaches and families alike.",
    changes: [
      { kind: "improved", text: "Coaches: Families, Tasks and Finances are tabs of their own instead of buttons on the Roster page. Payments waiting for you to confirm show as a count on Finances, and tasks waiting on you on Tasks. On a phone the tab row slides sideways, with a dot at the edge when a tab off screen has something waiting." },
      { kind: "new", text: "Families: new To do and Finances tabs. To do holds everything the coaches asked for, with a count of what's still open; the Schedule page links to it while anything is." },
      { kind: "improved", text: "Money is now called Finances everywhere." },
    ],
  },
  {
    date: "2026-11-26",
    title: "Team money",
    summary: "Track what families and staff owe for ref fees, tournaments and travel, and let families pay you on Venmo.",
    changes: [
      { kind: "new", text: "Coaches: Money, from the Roster page. Charge ref fees, a tournament or the hotel to everyone or just some people, as an amount each or a total split evenly to the cent. See who's paid, who still owes, and what's been passed on to the hotel or the league." },
      { kind: "new", text: "Families see what they owe, what they've paid and anything coming back to them. Pay opens Venmo with the amount and a note already filled in, and \"I sent a payment\" tells the coach, who confirms it once it arrives." },
      { kind: "new", text: "Sponsor gifts and donations go into a team fund that can cover anyone's share. Add a savings fund too, and choose whether families can see each fund's balance." },
      { kind: "new", text: "Paid for something yourself? Record it as fronted and the team owes you until you're paid back. Refundable charges, like a hotel deposit, can give money back to families." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Messages loads in its own shape",
    summary: "On a computer, the outline you see while Messages loads now looks like Messages.",
    changes: [
      { kind: "fixed", text: "Opening the Messages tab on a computer shows the conversation list on the left and the new message panel beside it while it loads, instead of a single list that then jumped into place." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Snappier tabs",
    summary: "Tapping a tab answers straight away, and the help button has moved up next to the bell.",
    changes: [
      { kind: "improved", text: "Tap a tab and the next page turns into view right away, with an outline of what's coming that fills in as it loads, so you're never left wondering whether the tap worked." },
      { kind: "improved", text: "The ? help button for coaches now sits in the top bar, next to the notifications bell, so on a phone it no longer takes up a line under the team name." },
    ],
  },
  {
    date: "2026-11-25",
    title: "All your teams in one place",
    summary: "Archive teams and invite staff to several teams at once, from your account.",
    changes: [
      { kind: "improved", text: "Your account lists every team you're on. Archive the ones whose season is over, or bring them back, without opening each team." },
      { kind: "improved", text: "Invite a coach, assistant coach or team manager to several of your teams at once from your account. A team's own Settings now invites to just that team." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Archive past teams",
    summary: "Put away a team when its season is over, without losing anything.",
    changes: [
      { kind: "new", text: "Archive a team from its Settings page when the season's over. It drops out of the team switcher and your team list for everyone on its staff." },
      { kind: "new", text: "Archived teams are still one click away under All teams > Archived teams, with everything kept: open one any time, or bring it back." },
    ],
  },
  {
    date: "2026-11-25",
    title: "Games and practices in your calendar",
    summary: "Add your team's schedule to your iPhone or Google Calendar once, and it keeps itself up to date.",
    changes: [
      { kind: "new", text: "Tap Add to your calendar on the schedule, then iPhone or Mac, or Google Calendar. Every game and practice shows up there, for all your players' teams (and, for coaches, every team you coach)." },
      { kind: "new", text: "New games, time changes and cancellations reach your calendar on their own. Apple Calendar usually picks them up within a few hours and Google within a day, so BenchTalk still notifies you when something moves." },
      { kind: "new", text: "Your calendar link is private to you. If you shared it by mistake, Reset link stops the old one working." },
    ],
  },
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
