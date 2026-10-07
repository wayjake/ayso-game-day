import type { Route } from "./+types/team.contacts.new";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players, contacts } from "~/db";
import { Alert, Button, Card, Page, PageHeader, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { eq, and } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);

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

  return data({
    team,
    players: teamPlayers,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  const teamId = parseInt(params.teamId);

  // Verify team ownership
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
    .limit(1);

  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }

  // Get form data
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const relationship = formData.get("relationship") as string;
  const playerIdStr = formData.get("playerId") as string;
  const isPrimary = formData.get("isPrimary") === "on";
  const notes = formData.get("notes") as string;

  // Basic validation
  if (!name || name.trim().length === 0) {
    return data(
      { error: "Contact name is required" },
      { status: 400 }
    );
  }

  if (!email || email.trim().length === 0) {
    return data(
      { error: "Email address is required" },
      { status: 400 }
    );
  }

  // Simple email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return data(
      { error: "Please enter a valid email address" },
      { status: 400 }
    );
  }

  try {
    const playerId = playerIdStr && playerIdStr !== "" ? parseInt(playerIdStr) : null;
    const validRelationships = ['parent', 'guardian', 'self', 'emergency'] as const;
    const relationshipValue = validRelationships.includes(relationship as typeof validRelationships[number])
      ? (relationship as typeof validRelationships[number])
      : null;

    await db.insert(contacts).values({
      teamId: teamId,
      playerId: playerId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      relationship: relationshipValue,
      isPrimary: isPrimary,
      notes: notes?.trim() || null,
    });

    return redirect(`/dashboard/team/${teamId}/contacts`);
  } catch (error) {
    console.error("Error creating contact:", error);
    return data(
      { error: "Failed to create contact. Please try again." },
      { status: 500 }
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Add Contact - AYSO Game Day" },
    { name: "description", content: "Add a new contact to your team" },
  ];
}

export default function NewContact({ loaderData, actionData }: Route.ComponentProps) {
  const { team, players } = loaderData;
  const error = actionData?.error;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `/dashboard/team/${team.id}/contacts`, label: "Contacts" }}
        title="Add contact"
        description="Add a contact for a player's family or the whole team."
      />

      {/* Error message */}
      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post">
          <div className="space-y-5 p-5 sm:p-6">
            {/* Contact name */}
            <div>
              <label htmlFor="name" className={labelClass}>
                Contact name <span className="text-danger">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className={inputClass}
                placeholder="e.g. Sarah Johnson"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className={labelClass}>
                Email address <span className="text-danger">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className={inputClass}
                placeholder="e.g. sarah.johnson@example.com"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className={labelClass}>
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                className={inputClass}
                placeholder="e.g. (555) 123-4567"
              />
            </div>

            {/* Player */}
            <div>
              <label htmlFor="playerId" className={labelClass}>
                Player
              </label>
              <select id="playerId" name="playerId" className={inputClass}>
                <option value="">None (general team contact)</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
              <p className={hintClass}>
                The player this contact belongs to, if any.
              </p>
            </div>

            {/* Relationship */}
            <div>
              <label htmlFor="relationship" className={labelClass}>
                Relationship
              </label>
              <select id="relationship" name="relationship" className={inputClass}>
                <option value="">Select relationship…</option>
                <option value="parent">Parent</option>
                <option value="guardian">Guardian</option>
                <option value="self">Self</option>
                <option value="emergency">Emergency contact</option>
              </select>
            </div>

            {/* Primary contact checkbox */}
            <label htmlFor="isPrimary" className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
              <input
                id="isPrimary"
                name="isPrimary"
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
              />
              This is the primary contact for this player
            </label>

            {/* Notes */}
            <div>
              <label htmlFor="notes" className={labelClass}>
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className={inputClass}
                placeholder="Anything else to know about this contact"
              />
            </div>
          </div>

          {/* Form actions */}
          <div className="flex justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
            <Link to={`/dashboard/team/${team.id}/contacts`} className={buttonClass({ variant: "ghost" })}>
              Cancel
            </Link>
            <Button type="submit">Add contact</Button>
          </div>
        </Form>
      </Card>
    </Page>
  );
}
