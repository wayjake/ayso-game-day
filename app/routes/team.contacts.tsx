import type { Route } from "./+types/team.contacts";
import { Link } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, contacts } from "~/db";
import { eq, and } from "drizzle-orm";
import { Badge, Card, CardHeader, EmptyState, Page, PageHeader, buttonClass } from "~/components/ui";
import { AddressBook, EnvelopeSimple, PencilSimple, Phone, Plus, Star } from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { teamPath } from "~/utils/team-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = (await teamIdFromCode(params.teamCode));

  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
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

  // Group contacts by player ("" holds the general team contacts)
  const contactsByPlayer = teamContacts.reduce((acc, contact) => {
    const playerId = contact.playerId || "";
    if (!acc[playerId]) {
      acc[playerId] = [];
    }
    acc[playerId].push(contact);
    return acc;
  }, {} as Record<string, typeof teamContacts>);

  return data({
    team,
    players: teamPlayers,
    contactsByPlayer,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Contacts - BenchTalk" },
    { name: "description", content: "Manage contacts for your team" },
  ];
}

function ContactRow({ contact, teamCode }: { contact: any; teamCode: string }) {
  const relationshipTone = (relationship: string) => {
    switch (relationship) {
      case 'parent':
      case 'guardian':
        return 'primary' as const;
      case 'self':
        return 'success' as const;
      case 'emergency':
        return 'danger' as const;
      default:
        return 'neutral' as const;
    }
  };

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{contact.name}</h3>
          {contact.isPrimary && (
            <Badge tone="warning">
              <Star size={12} weight="fill" />
              Primary
            </Badge>
          )}
          {contact.relationship && (
            <Badge tone={relationshipTone(contact.relationship)}>
              {contact.relationship.charAt(0).toUpperCase() + contact.relationship.slice(1)}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <a href={`mailto:${contact.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-ink hover:underline pointer-coarse:min-h-11">
            <EnvelopeSimple size={16} className="shrink-0" />
            <span className="truncate">{contact.email}</span>
          </a>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 hover:text-ink hover:underline pointer-coarse:min-h-11">
              <Phone size={16} className="shrink-0" />
              {contact.phone}
            </a>
          )}
        </div>
        {contact.notes && (
          <p className="mt-1.5 text-xs text-muted">{contact.notes}</p>
        )}
      </div>
      <Link
        to={`${teamPath(teamCode)}/contacts/${contact.id}/edit`}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        <PencilSimple size={16} />
        Edit
      </Link>
    </li>
  );
}

export default function TeamContacts({ loaderData }: Route.ComponentProps) {
  const { team, players, contactsByPlayer } = loaderData;

  const hasContacts = Object.keys(contactsByPlayer).length > 0;

  return (
    <Page>
      <PageHeader
        title="Contacts"
        description="Contact information for player families."
        actions={
          hasContacts && (
            <Link to={`${teamPath(team)}/contacts/new`} className={buttonClass()}>
              <Plus size={18} weight="bold" />
              Add contact
            </Link>
          )
        }
      />

      {/* Contacts grouped by player */}
      {hasContacts ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {players.map((player) => {
            const playerContacts = contactsByPlayer[player.id] || [];
            if (playerContacts.length === 0) return null;

            return (
              <Card key={player.id} className="p-5 sm:p-6">
                <CardHeader title={player.name} count={playerContacts.length} />
                <ul className="mt-2 divide-y divide-line">
                  {playerContacts.map((contact) => (
                    <ContactRow key={contact.id} contact={contact} teamCode={team.code} />
                  ))}
                </ul>
              </Card>
            );
          })}

          {/* Contacts without a player */}
          {contactsByPlayer[""] && contactsByPlayer[""].length > 0 && (
            <Card className="p-5 sm:p-6">
              <CardHeader title="General team contacts" count={contactsByPlayer[""].length} />
              <ul className="mt-2 divide-y divide-line">
                {contactsByPlayer[""].map((contact) => (
                  <ContactRow key={contact.id} contact={contact} teamCode={team.code} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<AddressBook size={24} />}
            title="No contacts yet"
            action={
              <Link to={`${teamPath(team)}/contacts/new`} className={buttonClass()}>
                <Plus size={18} weight="bold" />
                Add your first contact
              </Link>
            }
          >
            Add contact information for player families to start sending team communications.
          </EmptyState>
        </Card>
      )}
    </Page>
  );
}
