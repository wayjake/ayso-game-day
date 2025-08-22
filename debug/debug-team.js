import { db, teams, positions } from './app/db/index';
import { eq, or } from 'drizzle-orm';

async function checkTeamAndPositions() {
  console.log('Checking teams and positions...');
  try {
    const allTeams = await db.select().from(teams);
    console.log('Found teams:', allTeams.length);
    
    if (allTeams.length > 0) {
      const team = allTeams[0];
      console.log('Team format:', team.format);
      
      // Test the same query as in the loader (fixed version)
      const availablePositions = await db
        .select({
          number: positions.number,
          abbreviation: positions.abbreviation,
          fullName: positions.fullName,
          category: positions.category,
        })
        .from(positions)
        .where(or(
          eq(positions.format, 'both'),
          eq(positions.format, team.format)
        ))
        .orderBy(positions.number);
      
      console.log('Available positions for', team.format, ':', availablePositions.length);
      console.log('Sample positions:', availablePositions.slice(0, 3));
    } else {
      console.log('No teams found - this might be the issue');
    }
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkTeamAndPositions();