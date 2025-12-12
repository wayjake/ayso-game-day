// API route for AI-powered roster import

import { data } from 'react-router';
import type { Route } from './+types/route';
import { getUser } from '~/utils/auth.server';
import { db, teams, players } from '~/db';
import { eq, and } from 'drizzle-orm';
import { validateFile, getFileCategory } from './validation';
import { extractRosterData } from './ai-extractor';
import { matchExtractedToExisting } from './name-matcher';
import type { ExtractResponse, ImportResponse, ImportPlayerData } from './types';

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request);

  if (!user) {
    return data({ success: false, error: 'Unauthorized' } as ExtractResponse, { status: 401 });
  }

  const formData = await request.formData();
  const _action = formData.get('_action') as string;

  if (_action === 'extract') {
    return handleExtract(formData, user);
  }

  if (_action === 'import') {
    return handleImport(formData, user);
  }

  return data({ success: false, error: 'Invalid action' } as ExtractResponse, { status: 400 });
}

async function handleExtract(
  formData: FormData,
  user: { id: number }
): Promise<ReturnType<typeof data<ExtractResponse>>> {
  const teamId = parseInt(formData.get('teamId') as string);
  const file = formData.get('file') as File | null;

  if (!teamId || isNaN(teamId)) {
    return data({ success: false, error: 'Team ID is required' }, { status: 400 });
  }

  if (!file) {
    return data({ success: false, error: 'File is required' }, { status: 400 });
  }

  // Verify team ownership
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);

  if (!team) {
    return data({ success: false, error: 'Team not found' }, { status: 404 });
  }

  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    return data({ success: false, error: validation.error }, { status: 400 });
  }

  const fileCategory = validation.fileCategory!;

  // Read file content
  let fileContent: string | ArrayBuffer;
  if (fileCategory === 'text') {
    fileContent = await file.text();
  } else {
    fileContent = await file.arrayBuffer();
  }

  // Extract roster data using AI
  const extractionResult = await extractRosterData(fileContent, fileCategory, file.type);

  if (!extractionResult.success) {
    return data({ success: false, error: extractionResult.error }, { status: 400 });
  }

  // Get existing players for matching
  const existingPlayers = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.teamId, teamId));

  // Match extracted players to existing roster
  const matchResults = matchExtractedToExisting(
    extractionResult.players,
    existingPlayers
  );

  return data({
    success: true,
    extractedPlayers: extractionResult.players,
    matchResults,
    extractionNotes: extractionResult.extractionNotes,
  });
}

async function handleImport(
  formData: FormData,
  user: { id: number }
): Promise<ReturnType<typeof data<ImportResponse>>> {
  const teamId = parseInt(formData.get('teamId') as string);
  const playersJson = formData.get('players') as string;

  if (!teamId || isNaN(teamId)) {
    return data({ success: false, created: 0, updated: 0, skipped: 0, errors: ['Team ID is required'] }, { status: 400 });
  }

  if (!playersJson) {
    return data({ success: false, created: 0, updated: 0, skipped: 0, errors: ['Players data is required'] }, { status: 400 });
  }

  // Verify team ownership
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);

  if (!team) {
    return data({ success: false, created: 0, updated: 0, skipped: 0, errors: ['Team not found'] }, { status: 404 });
  }

  let importPlayers: ImportPlayerData[];
  try {
    importPlayers = JSON.parse(playersJson);
  } catch {
    return data({ success: false, created: 0, updated: 0, skipped: 0, errors: ['Invalid players data'] }, { status: 400 });
  }

  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const player of importPlayers) {
    try {
      if (player.action === 'skip') {
        results.skipped++;
        continue;
      }

      if (player.action === 'create') {
        await db.insert(players).values({
          teamId,
          coachId: user.id,
          name: player.name.trim(),
          preferredPositions: player.preferredPositions?.length
            ? JSON.stringify(player.preferredPositions)
            : null,
          description: player.notes || null,
          jerseyNumber: player.jerseyNumber ?? null,
        });
        results.created++;
      }

      if (player.action === 'update' && player.existingPlayerId) {
        // Build update data - only include fields that were extracted
        const updateData: Record<string, any> = {
          name: player.name.trim(),
        };

        if (player.preferredPositions?.length) {
          updateData.preferredPositions = JSON.stringify(player.preferredPositions);
        }

        if (player.notes) {
          updateData.description = player.notes;
        }

        if (player.jerseyNumber !== undefined) {
          updateData.jerseyNumber = player.jerseyNumber;
        }

        await db
          .update(players)
          .set(updateData)
          .where(
            and(
              eq(players.id, player.existingPlayerId),
              eq(players.teamId, teamId) // Security: ensure player belongs to team
            )
          );
        results.updated++;
      }
    } catch (error) {
      console.error(`Failed to process player ${player.name}:`, error);
      results.errors.push(`Failed to process ${player.name}`);
    }
  }

  return data({
    success: results.errors.length === 0,
    ...results,
  });
}
