import { db, positions } from './app/db/index';
import { eq, or } from 'drizzle-orm';

async function check9v9Positions() {
  console.log('Checking 9v9 positions...');
  try {
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
        eq(positions.format, '9v9')
      ))
      .orderBy(positions.number);
    
    console.log('Available positions for 9v9:', availablePositions.length);
    console.log('Positions:', availablePositions.map(p => `${p.number}-${p.abbreviation}`).join(', '));
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

check9v9Positions();