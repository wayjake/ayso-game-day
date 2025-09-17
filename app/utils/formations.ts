// Formation templates for soccer lineups
// Positions use percentage-based coordinates (x: 0-100, y: 0-100)

export interface FormationPosition {
  number: number;
  x: number;
  y: number;
  abbreviation: string;
}

export interface Formation {
  name: string;
  positions: FormationPosition[];
}

export interface FormationSet {
  [key: string]: Formation;
}

export const formations11v11: FormationSet = {
  '4-4-2': {
    name: '4-4-2 Classic',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' }, // Goalkeeper
      { number: 2, x: 75, y: 75, abbreviation: 'RB' }, // Right Back
      { number: 3, x: 25, y: 75, abbreviation: 'LB' }, // Left Back
      { number: 4, x: 42, y: 75, abbreviation: 'CB' }, // Center Back
      { number: 5, x: 58, y: 75, abbreviation: 'CB' }, // Center Back
      { number: 7, x: 75, y: 50, abbreviation: 'RM' }, // Right Mid
      { number: 6, x: 42, y: 50, abbreviation: 'CM' }, // Central Mid
      { number: 8, x: 58, y: 50, abbreviation: 'CM' }, // Central Mid
      { number: 11, x: 25, y: 50, abbreviation: 'LM' }, // Left Mid
      { number: 9, x: 40, y: 25, abbreviation: 'ST' }, // Striker
      { number: 10, x: 60, y: 25, abbreviation: 'ST' }, // Striker
    ],
  },
  '4-3-3': {
    name: '4-3-3 Attack',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 2, x: 80, y: 75, abbreviation: 'RB' },
      { number: 3, x: 20, y: 75, abbreviation: 'LB' },
      { number: 4, x: 42, y: 75, abbreviation: 'CB' },
      { number: 5, x: 58, y: 75, abbreviation: 'CB' },
      { number: 6, x: 50, y: 55, abbreviation: 'CDM' },
      { number: 8, x: 35, y: 45, abbreviation: 'CM' },
      { number: 10, x: 65, y: 45, abbreviation: 'CM' },
      { number: 7, x: 75, y: 25, abbreviation: 'RW' },
      { number: 11, x: 25, y: 25, abbreviation: 'LW' },
      { number: 9, x: 50, y: 20, abbreviation: 'ST' },
    ],
  },
  '3-5-2': {
    name: '3-5-2 Wing',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 4, x: 50, y: 75, abbreviation: 'CB' },
      { number: 5, x: 35, y: 75, abbreviation: 'CB' },
      { number: 3, x: 65, y: 75, abbreviation: 'CB' },
      { number: 2, x: 88, y: 50, abbreviation: 'RWB' },
      { number: 11, x: 12, y: 50, abbreviation: 'LWB' },
      { number: 6, x: 50, y: 55, abbreviation: 'CDM' },
      { number: 8, x: 38, y: 45, abbreviation: 'CM' },
      { number: 10, x: 62, y: 45, abbreviation: 'CM' },
      { number: 9, x: 40, y: 25, abbreviation: 'ST' },
      { number: 7, x: 60, y: 25, abbreviation: 'ST' },
    ],
  },
  '4-1-4-1': {
    name: '4-1-4-1 Diamond',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 2, x: 75, y: 75, abbreviation: 'RB' },
      { number: 3, x: 25, y: 75, abbreviation: 'LB' },
      { number: 4, x: 42, y: 75, abbreviation: 'CB' },
      { number: 5, x: 58, y: 75, abbreviation: 'CB' },
      { number: 6, x: 50, y: 58, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 40, abbreviation: 'RM' },
      { number: 8, x: 42, y: 40, abbreviation: 'CM' },
      { number: 11, x: 25, y: 40, abbreviation: 'LM' },
      { number: 10, x: 58, y: 40, abbreviation: 'CM' },
      { number: 9, x: 50, y: 25, abbreviation: 'ST' },
    ],
  },
  '4-2-3-1': {
    name: '4-2-3-1',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 2, x: 80, y: 75, abbreviation: 'RB' },
      { number: 3, x: 20, y: 75, abbreviation: 'LB' },
      { number: 4, x: 42, y: 75, abbreviation: 'CB' },
      { number: 5, x: 58, y: 75, abbreviation: 'CB' },
      { number: 6, x: 42, y: 55, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 55, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 35, abbreviation: 'RW' },
      { number: 10, x: 50, y: 35, abbreviation: 'CAM' },
      { number: 11, x: 25, y: 35, abbreviation: 'LW' },
      { number: 9, x: 50, y: 20, abbreviation: 'ST' },
    ],
  },
  '4-3-2-1': {
    name: '4-3-2-1 Christmas Tree',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 2, x: 80, y: 75, abbreviation: 'RB' },
      { number: 3, x: 20, y: 75, abbreviation: 'LB' },
      { number: 4, x: 42, y: 75, abbreviation: 'CB' },
      { number: 5, x: 58, y: 75, abbreviation: 'CB' },
      { number: 6, x: 50, y: 55, abbreviation: 'CDM' },
      { number: 8, x: 35, y: 50, abbreviation: 'CM' },
      { number: 7, x: 65, y: 50, abbreviation: 'CM' },
      { number: 10, x: 42, y: 35, abbreviation: 'CAM' },
      { number: 11, x: 58, y: 35, abbreviation: 'CAM' },
      { number: 9, x: 50, y: 20, abbreviation: 'ST' },
    ],
  },
  '5-3-2': {
    name: '5-3-2 Defensive',
    positions: [
      { number: 1, x: 50, y: 92, abbreviation: 'GK' },
      { number: 2, x: 88, y: 70, abbreviation: 'RWB' },
      { number: 3, x: 12, y: 70, abbreviation: 'LWB' },
      { number: 4, x: 35, y: 78, abbreviation: 'CB' },
      { number: 5, x: 50, y: 78, abbreviation: 'CB' },
      { number: 6, x: 65, y: 78, abbreviation: 'CB' },
      { number: 8, x: 50, y: 50, abbreviation: 'CM' },
      { number: 7, x: 62, y: 50, abbreviation: 'CM' },
      { number: 11, x: 38, y: 50, abbreviation: 'CM' },
      { number: 9, x: 40, y: 25, abbreviation: 'ST' },
      { number: 10, x: 60, y: 25, abbreviation: 'ST' },
    ],
  },
};

export const formations9v9: FormationSet = {
  '3-3-2': {
    name: '3-3-2 Balanced',
    positions: [
      { number: 1, x: 50, y: 88, abbreviation: 'GK' },
      { number: 2, x: 70, y: 65, abbreviation: 'RB' },
      { number: 3, x: 30, y: 65, abbreviation: 'LB' },
      { number: 4, x: 50, y: 65, abbreviation: 'CB' },
      { number: 6, x: 50, y: 40, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 40, abbreviation: 'RM' },
      { number: 8, x: 25, y: 40, abbreviation: 'LM' },
      { number: 10, x: 40, y: 15, abbreviation: 'CAM' },
      { number: 9, x: 60, y: 15, abbreviation: 'CF' },
    ],
  },
  '3-2-3': {
    name: '3-2-3 Attack',
    positions: [
      { number: 1, x: 50, y: 88, abbreviation: 'GK' },
      { number: 2, x: 65, y: 65, abbreviation: 'RB' },
      { number: 3, x: 35, y: 65, abbreviation: 'LB' },
      { number: 4, x: 50, y: 65, abbreviation: 'CB' },
      { number: 6, x: 42, y: 45, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 45, abbreviation: 'CDM' },
      { number: 7, x: 75, y: 20, abbreviation: 'RW' },
      { number: 11, x: 25, y: 20, abbreviation: 'LW' },
      { number: 9, x: 50, y: 20, abbreviation: 'CF' },
    ],
  },
  '2-4-2': {
    name: '2-4-2 Midfield',
    positions: [
      { number: 1, x: 50, y: 88, abbreviation: 'GK' },
      { number: 4, x: 42, y: 65, abbreviation: 'CB' },
      { number: 5, x: 58, y: 65, abbreviation: 'CB' },
      { number: 2, x: 80, y: 40, abbreviation: 'RM' },
      { number: 3, x: 20, y: 40, abbreviation: 'LM' },
      { number: 6, x: 42, y: 40, abbreviation: 'CM' },
      { number: 8, x: 58, y: 40, abbreviation: 'CM' },
      { number: 9, x: 40, y: 15, abbreviation: 'ST' },
      { number: 10, x: 60, y: 15, abbreviation: 'ST' },
    ],
  },
  '4-2-2': {
    name: '4-2-2 Defensive',
    positions: [
      { number: 1, x: 50, y: 88, abbreviation: 'GK' },
      { number: 2, x: 75, y: 65, abbreviation: 'RB' },
      { number: 3, x: 25, y: 65, abbreviation: 'LB' },
      { number: 4, x: 44, y: 65, abbreviation: 'CB' },
      { number: 5, x: 56, y: 65, abbreviation: 'CB' },
      { number: 6, x: 42, y: 40, abbreviation: 'CDM' },
      { number: 8, x: 58, y: 40, abbreviation: 'CDM' },
      { number: 9, x: 40, y: 15, abbreviation: 'ST' },
      { number: 10, x: 60, y: 15, abbreviation: 'ST' },
    ],
  },
  '3-1-3-1': {
    name: '3-1-3-1 Diamond',
    positions: [
      { number: 1, x: 50, y: 88, abbreviation: 'GK' },
      { number: 2, x: 65, y: 65, abbreviation: 'RB' },
      { number: 3, x: 35, y: 65, abbreviation: 'LB' },
      { number: 4, x: 50, y: 65, abbreviation: 'CB' },
      { number: 6, x: 50, y: 48, abbreviation: 'CDM' },
      { number: 7, x: 70, y: 35, abbreviation: 'RM' },
      { number: 8, x: 30, y: 35, abbreviation: 'LM' },
      { number: 10, x: 50, y: 30, abbreviation: 'CAM' },
      { number: 9, x: 50, y: 10, abbreviation: 'CF' },
    ],
  },
};

// Helper function to get formations by format
export function getFormationsByFormat(format: '7v7' | '9v9' | '11v11'): FormationSet {
  switch (format) {
    case '9v9':
      return formations9v9;
    case '11v11':
      return formations11v11;
    default:
      // For 7v7 or unknown formats, return 9v9 as default
      return formations9v9;
  }
}