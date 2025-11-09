import type { Route } from "./+types/team.contacts";
import { Link } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, players, contacts } from "~/db";
import { eq, and } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);

  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }

  // Get all players for this team
  const teamPlayers = await db
    .select({
      id: players.id,
      name: players.name,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);

  // Get all contacts for this team
  const teamContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.teamId, teamId))
    .orderBy(contacts.name);

  // Group contacts by player
  const contactsByPlayer = teamContacts.reduce((acc, contact) => {
    const playerId = contact.playerId || 0;
    if (!acc[playerId]) {
      acc[playerId] = [];
    }
    acc[playerId].push(contact);
    return acc;
  }, {} as Record<number, typeof teamContacts>);

  return data({
    team,
    players: teamPlayers,
    contactsByPlayer,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Contacts - AYSO Game Day" },
    { name: "description", content: "Manage contacts for your team" },
  ];
}

function ContactCard({ contact, teamId }: { contact: any; teamId: number }) {
  const relationshipBadgeColor = (relationship: string) => {
    switch (relationship) {
      case 'parent':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'guardian':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'self':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'emergency':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-[var(--text)]">{contact.name}</h4>
            {contact.isPrimary && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
                ⭐ Primary
              </span>
            )}
          </div>
          <div className="mt-1 space-y-1">
            <p className="text-sm text-[var(--muted)]">
              <a href={`mailto:${contact.email}`} className="hover:underline">
                {contact.email}
              </a>
            </p>
            {contact.phone && (
              <p className="text-sm text-[var(--muted)]">
                <a href={`tel:${contact.phone}`} className="hover:underline">
                  {contact.phone}
                </a>
              </p>
            )}
            {contact.relationship && (
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border ${relationshipBadgeColor(contact.relationship)}`}>
                {contact.relationship.charAt(0).toUpperCase() + contact.relationship.slice(1)}
              </span>
            )}
          </div>
          {contact.notes && (
            <p className="text-xs text-[var(--muted)] mt-2">{contact.notes}</p>
          )}
        </div>
        <Link
          to={`/dashboard/team/${teamId}/contacts/${contact.id}/edit`}
          className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
        >
          Edit
        </Link>
      </div>
    </div>
  );
}

export default function TeamContacts({ loaderData }: Route.ComponentProps) {
  const { team, players, contactsByPlayer } = loaderData;

  const hasContacts = Object.keys(contactsByPlayer).length > 0;

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{team.name} Contacts</h1>
            <p className="mt-2 text-[var(--muted)]">
              Manage contact information for player families
            </p>
          </div>
          <Link
            to={`/dashboard/team/${team.id}/contacts/new`}
            className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
          >
            Add Contact
          </Link>
        </div>

        {/* Contacts grouped by player */}
        {hasContacts ? (
          <div className="space-y-6">
            {players.map((player) => {
              const playerContacts = contactsByPlayer[player.id] || [];
              if (playerContacts.length === 0) return null;

              return (
                <div key={player.id} className="bg-[var(--bg)] rounded-lg p-6 border border-[var(--border)]">
                  <h2 className="text-xl font-semibold text-[var(--text)] mb-4">
                    {player.name}
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {playerContacts.map((contact) => (
                      <ContactCard key={contact.id} contact={contact} teamId={team.id} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Contacts without a player */}
            {contactsByPlayer[0] && contactsByPlayer[0].length > 0 && (
              <div className="bg-[var(--bg)] rounded-lg p-6 border border-[var(--border)]">
                <h2 className="text-xl font-semibold text-[var(--text)] mb-4">
                  General Team Contacts
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {contactsByPlayer[0].map((contact) => (
                    <ContactCard key={contact.id} contact={contact} teamId={team.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-12 text-center">
            <div className="max-w-sm mx-auto">
              <div className="mb-4">
                <div className="h-12 w-12 mx-auto bg-[var(--bg)] rounded-full flex items-center justify-center">
                  <span className="text-[var(--muted)] text-xl">📧</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                No contacts yet
              </h3>
              <p className="text-[var(--muted)] mb-6">
                Add contact information for player families to start sending team communications.
              </p>
              <Link
                to={`/dashboard/team/${team.id}/contacts/new`}
                className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Add Your First Contact
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
