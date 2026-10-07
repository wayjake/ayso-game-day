import type { Route } from "./+types/dashboard.teams.new";
import { Form, Link, data, redirect } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams } from "~/db";
import { Alert, Button, Card, Page, PageHeader, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { Lightbulb, Plus } from "@phosphor-icons/react";

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
    { title: "New team - AYSO Game Day" },
    { name: "description", content: "Create a new AYSO team" },
  ];
}

export default function NewTeam({ actionData }: Route.ComponentProps) {
  const error = actionData?.error;
  const year = new Date().getFullYear();
  const optional = <span className="font-normal text-subtle">(optional)</span>;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: "/dashboard/teams", label: "All teams" }}
        title="New team"
        description="Add a team to plan its games, roster, and rotations."
      />

      {error && <Alert className="mb-6">{error}</Alert>}

      <Card>
        <Form method="post" className="space-y-5 p-5 sm:p-6">
          {/* Team name */}
          <div>
            <label htmlFor="teamName" className={labelClass}>
              Team name
            </label>
            <input
              id="teamName"
              name="teamName"
              type="text"
              required
              className={inputClass}
              placeholder="e.g. U12 Spartans"
            />
          </div>

          {/* Game format */}
          <div>
            <label htmlFor="format" className={labelClass}>
              Game format
            </label>
            <select id="format" name="format" required className={inputClass}>
              <option value="">Select format</option>
              <option value="7v7">7v7</option>
              <option value="9v9">9v9</option>
              <option value="11v11">11v11</option>
            </select>
            <p className={hintClass}>Choose the game format for your team's age group.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Age group */}
            <div>
              <label htmlFor="ageGroup" className={labelClass}>
                Age group {optional}
              </label>
              <input
                id="ageGroup"
                name="ageGroup"
                type="text"
                className={inputClass}
                placeholder="e.g. U12, U14, U16"
              />
            </div>

            {/* AYSO region */}
            <div>
              <label htmlFor="region" className={labelClass}>
                AYSO region {optional}
              </label>
              <input
                id="region"
                name="region"
                type="text"
                className={inputClass}
                placeholder="e.g. Region 678"
              />
            </div>
          </div>

          {/* Season */}
          <div>
            <label htmlFor="season" className={labelClass}>
              Season {optional}
            </label>
            <input
              id="season"
              name="season"
              type="text"
              className={inputClass}
              placeholder={`e.g. ${year} Fall, ${year} Spring`}
            />
            <p className={hintClass}>Leave blank to use "{year} Season".</p>
          </div>

          {/* Form actions */}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link to="/dashboard/teams" className={buttonClass({ variant: "ghost" })}>
              Cancel
            </Link>
            <Button type="submit">
              <Plus size={18} weight="bold" />
              Create team
            </Button>
          </div>
        </Form>
      </Card>

      {/* Tips */}
      <div className="mt-6 flex gap-3 rounded-2xl bg-primary-soft p-5 text-primary-ink">
        <Lightbulb size={20} weight="fill" className="mt-0.5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">Getting started</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
            <li>Pick the game format for your age group: 7v7 for younger players, 9v9 for middle, 11v11 for older.</li>
            <li>After creating your team, you can add players and schedule games.</li>
            <li>Use the roster tools to track player details and preferred positions.</li>
            <li>The lineup planner helps you build fair-play rotations for each game.</li>
          </ul>
        </div>
      </div>
    </Page>
  );
}
