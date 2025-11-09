import type { Route } from "./+types/team.contacts.new";
import { Form, data, redirect } from "react-router";
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
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
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

    await db.insert(contacts).values({
      teamId: teamId,
      playerId: playerId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      relationship: relationship || null,
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
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Add New Contact</h1>
          <p className="mt-2 text-[var(--muted)]">
            Add a contact for {team.name}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <Form method="post" className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="p-6 space-y-6">
            {/* Contact name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Contact Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Sarah Johnson"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., sarah.johnson@example.com"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1">
                Phone Number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., (555) 123-4567"
              />
            </div>

            {/* Player */}
            <div>
              <label htmlFor="playerId" className="block text-sm font-medium mb-1">
                Associated Player
              </label>
              <select
                id="playerId"
                name="playerId"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              >
                <option value="">None (General team contact)</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Select the player this contact is associated with, if applicable
              </p>
            </div>

            {/* Relationship */}
            <div>
              <label htmlFor="relationship" className="block text-sm font-medium mb-1">
                Relationship
              </label>
              <select
                id="relationship"
                name="relationship"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              >
                <option value="">Select relationship...</option>
                <option value="parent">Parent</option>
                <option value="guardian">Guardian</option>
                <option value="self">Self</option>
                <option value="emergency">Emergency Contact</option>
              </select>
            </div>

            {/* Primary contact checkbox */}
            <div className="flex items-center">
              <input
                id="isPrimary"
                name="isPrimary"
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
              />
              <label htmlFor="isPrimary" className="ml-2 text-sm">
                This is the primary contact for this player
              </label>
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium mb-1">
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="Any additional notes about this contact..."
              />
            </div>
          </div>

          {/* Form actions */}
          <div className="px-6 py-4 bg-[var(--bg)] border-t border-[var(--border)] flex gap-3 justify-end rounded-b-lg">
            <a
              href={`/dashboard/team/${team.id}/contacts`}
              className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
            >
              Cancel
            </a>
            <button
              type="submit"
              className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
            >
              Add Contact
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
