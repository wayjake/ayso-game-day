import type { Route } from "./+types/dashboard.teams.new";
import { Form, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams } from "~/db";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  
  return data({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request);
  const formData = await request.formData();
  
  const teamName = formData.get("teamName") as string;
  const format = formData.get("format") as '7v7' | '9v9' | '11v11';
  const ageGroup = formData.get("ageGroup") as string;
  const season = formData.get("season") as string;
  const region = formData.get("region") as string;
  
  // Basic validation
  if (!teamName || teamName.trim().length === 0) {
    return data(
      { error: "Team name is required" },
      { status: 400 }
    );
  }
  
  if (!format) {
    return data(
      { error: "Game format is required" },
      { status: 400 }
    );
  }
  
  try {
    // Create the team
    const [newTeam] = await db.insert(teams).values({
      name: teamName.trim(),
      coachId: user.id,
      format,
      ageGroup: ageGroup?.trim() || null,
      season: season?.trim() || `${new Date().getFullYear()} Season`,
      region: region?.trim() || null,
    }).returning({ id: teams.id });
    
    return redirect(`/dashboard/team/${newTeam.id}`);
  } catch (error) {
    console.error("Error creating team:", error);
    return data(
      { error: "Failed to create team. Please try again." },
      { status: 500 }
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Create New Team - AYSO Game Day" },
    { name: "description", content: "Create a new AYSO team" },
  ];
}

export default function NewTeam({ loaderData, actionData }: Route.ComponentProps) {
  const { user } = loaderData;
  const error = actionData?.error;
  
  return (
    <div className="py-8">
      <div className="container mx-auto px-6 max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Create New Team</h1>
          <p className="mt-2 text-[var(--muted)]">
            Add a new AYSO team to your coaching dashboard
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
            {/* Team name */}
            <div>
              <label htmlFor="teamName" className="block text-sm font-medium mb-1">
                Team Name <span className="text-red-500">*</span>
              </label>
              <input
                id="teamName"
                name="teamName"
                type="text"
                required
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., U12 Spartans"
              />
            </div>

            {/* Game format */}
            <div>
              <label htmlFor="format" className="block text-sm font-medium mb-1">
                Game Format <span className="text-red-500">*</span>
              </label>
              <select
                id="format"
                name="format"
                required
                className="w-full rounded border border-[var(--border)] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              >
                <option value="">Select format</option>
                <option value="7v7">7v7</option>
                <option value="9v9">9v9</option>
                <option value="11v11">11v11</option>
              </select>
              <p className="text-xs text-[var(--muted)] mt-1">
                Choose the game format for your team's age group
              </p>
            </div>

            {/* Age group */}
            <div>
              <label htmlFor="ageGroup" className="block text-sm font-medium mb-1">
                Age Group (Optional)
              </label>
              <input
                id="ageGroup"
                name="ageGroup"
                type="text"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., U12, U14, U16"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                The age group category for this team
              </p>
            </div>

            {/* Season */}
            <div>
              <label htmlFor="season" className="block text-sm font-medium mb-1">
                Season (Optional)
              </label>
              <input
                id="season"
                name="season"
                type="text"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder={`e.g., ${new Date().getFullYear()} Fall, ${new Date().getFullYear()} Spring`}
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Leave blank to use "{new Date().getFullYear()} Season"
              </p>
            </div>

            {/* AYSO region */}
            <div>
              <label htmlFor="region" className="block text-sm font-medium mb-1">
                AYSO Region (Optional)
              </label>
              <input
                id="region"
                name="region"
                type="text"
                className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="e.g., Region 678"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Your AYSO region number if applicable
              </p>
            </div>
            
            {/* Form actions */}
            <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Create Team
              </button>
              <a
                href="/dashboard/teams"
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
              >
                Cancel
              </a>
            </div>
          </div>
        </Form>
        
        {/* Tips */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">💡 Getting Started Tips</h3>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Choose the correct game format for your age group (7v7 for younger, 9v9 for middle, 11v11 for older)</li>
            <li>• After creating your team, you can add players and schedule games</li>
            <li>• Use the roster management tools to track player information and preferred positions</li>
            <li>• The rotation engine will help you create fair play schedules for games</li>
          </ul>
        </div>
      </div>
    </div>
  );
}