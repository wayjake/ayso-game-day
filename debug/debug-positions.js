import { db, positions } from './app/db/index';

async function checkPositions() {
  console.log('Checking positions in database...');
  try {
    const allPositions = await db.select().from(positions);
    console.log('Found positions:', allPositions.length);
    console.log('Sample positions:', allPositions.slice(0, 3));
  } catch (error) {
    console.error('Error querying positions:', error);
  }
  process.exit(0);
}

checkPositions();