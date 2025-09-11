import { db, positions, templateFormations } from './index';

// Position definitions - separate for 7v7, 9v9 and 11v11
const positionData = [
  // Common positions for all formats
  { number: 1, abbreviation: 'GK', fullName: 'Goalkeeper', category: 'goalkeeper' as const, format: 'all' as const },
  
  // 7v7 specific positions (6 field players)
  { number: 2, abbreviation: 'RB', fullName: 'Right Back', category: 'defender' as const, format: '7v7' as const },
  { number: 3, abbreviation: 'LB', fullName: 'Left Back', category: 'defender' as const, format: '7v7' as const },
  { number: 4, abbreviation: 'CB', fullName: 'Center Back', category: 'defender' as const, format: '7v7' as const },
  { number: 8, abbreviation: 'CM', fullName: 'Central Midfielder', category: 'midfielder' as const, format: '7v7' as const },
  { number: 7, abbreviation: 'RM', fullName: 'Right Midfielder', category: 'midfielder' as const, format: '7v7' as const },
  { number: 11, abbreviation: 'LM', fullName: 'Left Midfielder', category: 'midfielder' as const, format: '7v7' as const },
  { number: 9, abbreviation: 'CF', fullName: 'Center Forward', category: 'forward' as const, format: '7v7' as const },
  
  // 9v9 specific positions (8 field players)
  { number: 2, abbreviation: 'RB', fullName: 'Right Back', category: 'defender' as const, format: '9v9' as const },
  { number: 3, abbreviation: 'LB', fullName: 'Left Back', category: 'defender' as const, format: '9v9' as const },
  { number: 4, abbreviation: 'CB', fullName: 'Center Back', category: 'defender' as const, format: '9v9' as const },
  { number: 6, abbreviation: 'CDM', fullName: 'Defensive Midfielder', category: 'midfielder' as const, format: '9v9' as const },
  { number: 7, abbreviation: 'RM', fullName: 'Right Midfielder', category: 'midfielder' as const, format: '9v9' as const },
  { number: 8, abbreviation: 'CM', fullName: 'Central Midfielder', category: 'midfielder' as const, format: '9v9' as const },
  { number: 10, abbreviation: 'CAM', fullName: 'Attacking Midfielder', category: 'midfielder' as const, format: '9v9' as const },
  { number: 11, abbreviation: 'LM', fullName: 'Left Midfielder', category: 'midfielder' as const, format: '9v9' as const },
  { number: 9, abbreviation: 'CF', fullName: 'Center Forward', category: 'forward' as const, format: '9v9' as const },
  
  // 11v11 specific positions (11 field players) 
  { number: 2, abbreviation: 'RB', fullName: 'Right Back', category: 'defender' as const, format: '11v11' as const },
  { number: 3, abbreviation: 'LB', fullName: 'Left Back', category: 'defender' as const, format: '11v11' as const },
  { number: 4, abbreviation: 'CB', fullName: 'Center Back', category: 'defender' as const, format: '11v11' as const },
  { number: 5, abbreviation: 'CB', fullName: 'Center Back', category: 'defender' as const, format: '11v11' as const },
  { number: 6, abbreviation: 'CDM', fullName: 'Defensive Midfielder', category: 'midfielder' as const, format: '11v11' as const },
  { number: 7, abbreviation: 'RW', fullName: 'Right Winger', category: 'midfielder' as const, format: '11v11' as const },
  { number: 8, abbreviation: 'CM', fullName: 'Central Midfielder', category: 'midfielder' as const, format: '11v11' as const },
  { number: 10, abbreviation: 'CAM', fullName: 'Attacking Midfielder', category: 'midfielder' as const, format: '11v11' as const },
  { number: 11, abbreviation: 'LW', fullName: 'Left Winger', category: 'midfielder' as const, format: '11v11' as const },
  { number: 9, abbreviation: 'CF', fullName: 'Center Forward', category: 'forward' as const, format: '11v11' as const },
];

// Template formations for 7v7
const formations7v7 = [
  {
    name: '2-3-1 Balanced',
    format: '7v7' as const,
    formation: '2-3-1',
    description: 'Standard 7v7 formation. 2 defenders, 3 midfielders, 1 forward. Good balance for younger teams.',
    isDefault: true,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Defender' },
      { number: 3, abbreviation: 'LB', position: 'Left Defender' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 7, abbreviation: 'RM', position: 'Right Midfielder' },
      { number: 11, abbreviation: 'LM', position: 'Left Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Center Forward' },
    ]),
  },
  {
    name: '3-2-1 Defensive',
    format: '7v7' as const,
    formation: '3-2-1',
    description: 'Defensive formation with 3 defenders, 2 midfielders, 1 forward. Strong at the back.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 7, abbreviation: 'RM', position: 'Right Midfielder' },
      { number: 11, abbreviation: 'LM', position: 'Left Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Center Forward' },
    ]),
  },
  {
    name: '2-2-2 Attack',
    format: '7v7' as const,
    formation: '2-2-2',
    description: 'Attacking formation with 2 defenders, 2 midfielders, 2 forwards. Good for offensive play.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 8, abbreviation: 'CM', position: 'Right Midfielder' },
      { number: 11, abbreviation: 'CM', position: 'Left Midfielder' },
      { number: 7, abbreviation: 'RF', position: 'Right Forward' },
      { number: 9, abbreviation: 'LF', position: 'Left Forward' },
    ]),
  },
  {
    name: '1-3-2 Diamond',
    format: '7v7' as const,
    formation: '1-3-2',
    description: 'Diamond formation with 1 defender, 3 midfielders, 2 forwards. Very attacking but needs skilled defender.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 7, abbreviation: 'RM', position: 'Right Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 11, abbreviation: 'LM', position: 'Left Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Right Forward' },
      { number: 10, abbreviation: 'CF', position: 'Left Forward' },
    ]),
  },
];

// Template formations for 9v9
const formations9v9 = [
  {
    name: '3-3-2 Balanced',
    format: '9v9' as const,
    formation: '3-3-2',
    description: 'Balanced formation common in AYSO. 3 defenders, 3 midfielders, 2 forwards.',
    isDefault: true,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Defender' },
      { number: 3, abbreviation: 'LB', position: 'Left Defender' },
      { number: 4, abbreviation: 'CB', position: 'Center Defender' },
      { number: 6, abbreviation: 'CDM', position: 'Defensive Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 7, abbreviation: 'RM', position: 'Right Midfielder' },
      { number: 11, abbreviation: 'LM', position: 'Left Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Striker' },
    ]),
  },
  {
    name: '3-2-3 Attack',
    format: '9v9' as const,
    formation: '3-2-3',
    description: 'Attack-minded formation with strong wing play. 3 defenders, 2 midfielders, 3 forwards.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 6, abbreviation: 'CDM', position: 'Holding Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 7, abbreviation: 'RW', position: 'Right Winger' },
      { number: 11, abbreviation: 'LW', position: 'Left Winger' },
      { number: 9, abbreviation: 'CF', position: 'Center Forward' },
    ]),
  },
  {
    name: '2-4-2 Midfield Control',
    format: '9v9' as const,
    formation: '2-4-2',
    description: 'Emphasizes midfield dominance. 2 defenders, 4 midfielders, 2 forwards.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 6, abbreviation: 'CDM', position: 'Defensive Midfielder' },
      { number: 4, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 10, abbreviation: 'CAM', position: 'Attacking Midfielder' },
      { number: 7, abbreviation: 'RW', position: 'Right Winger' },
      { number: 9, abbreviation: 'CF', position: 'Center Forward' },
    ]),
  },
];

// Template formations for 11v11
const formations11v11 = [
  {
    name: '4-3-3 Classic',
    format: '11v11' as const,
    formation: '4-3-3',
    description: 'Classic formation with 4 defenders, 3 midfielders, 3 forwards.',
    isDefault: true,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 6, abbreviation: 'CDM', position: 'Holding Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 10, abbreviation: 'CAM', position: 'Attacking Midfielder' },
      { number: 7, abbreviation: 'RW', position: 'Right Winger' },
      { number: 9, abbreviation: 'CF', position: 'Center Forward' },
      { number: 11, abbreviation: 'LW', position: 'Left Winger' },
    ]),
  },
  {
    name: '4-4-2 Traditional',
    format: '11v11' as const,
    formation: '4-4-2',
    description: 'Traditional formation with 4 defenders, 4 midfielders, 2 forwards.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 2, abbreviation: 'RB', position: 'Right Back' },
      { number: 3, abbreviation: 'LB', position: 'Left Back' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 5, abbreviation: 'CB', position: 'Center Back' },
      { number: 7, abbreviation: 'RM', position: 'Right Midfielder' },
      { number: 6, abbreviation: 'CDM', position: 'Central Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 11, abbreviation: 'LM', position: 'Left Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Striker' },
      { number: 10, abbreviation: 'CF', position: 'Striker' },
    ]),
  },
  {
    name: '3-5-2 Wing Play',
    format: '11v11' as const,
    formation: '3-5-2',
    description: 'Formation with 3 defenders, 5 midfielders, 2 forwards. Strong wing play.',
    isDefault: false,
    positions: JSON.stringify([
      { number: 1, abbreviation: 'GK', position: 'Goalkeeper' },
      { number: 4, abbreviation: 'CB', position: 'Center Back' },
      { number: 5, abbreviation: 'CB', position: 'Center Back' },
      { number: 3, abbreviation: 'CB', position: 'Center Back' },
      { number: 2, abbreviation: 'RWB', position: 'Right Wing Back' },
      { number: 11, abbreviation: 'LWB', position: 'Left Wing Back' },
      { number: 6, abbreviation: 'CDM', position: 'Defensive Midfielder' },
      { number: 8, abbreviation: 'CM', position: 'Central Midfielder' },
      { number: 10, abbreviation: 'CAM', position: 'Attacking Midfielder' },
      { number: 9, abbreviation: 'CF', position: 'Striker' },
      { number: 7, abbreviation: 'CF', position: 'Striker' },
    ]),
  },
];

async function seed() {
  console.log('🌱 Seeding database...');
  
  try {
    // Clear existing data first
    console.log('Clearing existing positions and formations...');
    await db.delete(templateFormations);
    await db.delete(positions);
    
    // Insert positions
    console.log('Inserting positions...');
    await db.insert(positions).values(positionData);
    
    // Insert template formations
    console.log('Inserting 7v7 formations...');
    await db.insert(templateFormations).values(formations7v7);
    
    console.log('Inserting 9v9 formations...');
    await db.insert(templateFormations).values(formations9v9);
    
    console.log('Inserting 11v11 formations...');
    await db.insert(templateFormations).values(formations11v11);
    
    console.log('✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();