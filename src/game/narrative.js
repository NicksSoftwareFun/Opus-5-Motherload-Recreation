/**
 * Mr Natas.
 *
 * He is the only other character in the game and he never appears. He arrives as
 * paper: the teletype beside the seat clatters, a few lines curl out, and the
 * pilot reads them while still flying. That is deliberate — a cutscene would stop
 * the machine, and nothing is allowed to stop the machine.
 *
 * The voice is a mining company's legal department that has been doing this for
 * much longer than mining has existed. It congratulates. It reminds you of terms.
 * It gets more familiar the deeper you go, which is the wrong direction for a
 * business relationship to move in.
 */

/** Each beat fires once. `when` is evaluated against a snapshot of the run. */
export const BEATS = [
  {
    id: 'welcome',
    when: (s) => s.launched,
    lines: [
      'NATAS HEAVY INDUSTRIES',
      'OFFICE OF THE FINANCIER',
      '',
      'WELCOME TO THE CLAIM.',
      'THE POD IS YOURS. THE DEBT IS ALSO YOURS.',
      'THESE ARE THE SAME SENTENCE.',
      '',
      'DIG. — M. NATAS',
    ],
  },
  {
    id: 'depth25',
    when: (s) => s.depth > 25,
    lines: [
      'TWENTY-FIVE METRES.',
      'THE REGOLITH IS THE EASY PART. IT IS ALSO',
      'THE PART EVERYONE STOPS AT.',
      'YOU WILL NOT STOP THERE.',
      '— M. NATAS',
    ],
  },
  {
    id: 'firstsale',
    when: (s) => s.earned > 500,
    lines: [
      'FIRST ASSAY RECEIVED. CREDITED IN FULL.',
      'I WANT YOU TO NOTICE HOW GOOD THAT FELT,',
      'AND I WANT YOU TO NOTICE THAT IT WAS',
      'MY MONEY BEFORE IT WAS YOURS.',
      '— M. NATAS',
    ],
  },
  {
    id: 'depth60',
    when: (s) => s.depth > 60,
    lines: [
      'SIXTY METRES. THE BASALT BEGINS.',
      'PILOTS WRITE TO ME ABOUT THE BASALT.',
      'THEY SAY IT FEELS LIKE THE PLANET IS',
      'HOLDING SOMETHING SHUT.',
      'IT IS. KEEP GOING.',
      '— M. NATAS',
    ],
  },
  {
    id: 'firstrescue',
    when: (s) => s.rescues > 0,
    lines: [
      'RECOVERY LOGGED. FEE DEDUCTED.',
      '',
      'I AM NOT ANGRY. I DO NOT GET ANGRY.',
      'I GET PAID, WHICH IS BETTER AND LASTS',
      'LONGER.',
      '',
      'THE POD IS REPAIRED. GO BACK DOWN.',
      '— M. NATAS',
    ],
  },
  {
    id: 'depth110',
    when: (s) => s.depth > 110,
    lines: [
      'ONE HUNDRED AND TEN.',
      'YOU HAVE PASSED THE DEPTH AT WHICH THE',
      'SURVEY TEAMS WERE INSTRUCTED TO TURN',
      'BACK. THE INSTRUCTION WAS NOT FOR THEIR',
      'SAFETY. IT WAS FOR YOURS.',
      'THEY WOULD HAVE GOT THERE FIRST.',
      '— M. NATAS',
    ],
  },
  {
    id: 'providence',
    when: (s) => s.sensors.has('providence'),
    lines: [
      'THE ENGINE IS FITTED.',
      '',
      'IT DOES NOT MEASURE. THERE IS NOTHING IN',
      'IT THAT MEASURES. IT SIMPLY ALREADY',
      'KNOWS, AND HAS AGREED TO TELL YOU FOR A',
      'REASONABLE HOURLY SUM.',
      '',
      'DO NOT LOOK INTO THE LENS FOR LONG.',
      'IT IS RECIPROCAL.',
      '— M. NATAS',
    ],
  },
  {
    id: 'depth170',
    when: (s) => s.depth > 170,
    lines: [
      'ONE HUNDRED AND SEVENTY.',
      'YOU ARE VERY GOOD AT THIS.',
      'I HAVE FUNDED ELEVEN THOUSAND CONTRACTS',
      'ON THIS CLAIM. I REMEMBER FOUR OF THEM.',
      'YOU ARE THE FOURTH.',
      '— M. NATAS',
    ],
  },
  {
    id: 'rich',
    when: (s) => s.earned > 250000,
    lines: [
      'A QUARTER OF A MILLION LIFTED.',
      'YOU COULD STOP. THE CONTRACT PERMITS IT.',
      'CLAUSE IV, WHICH NOBODY HAS EVER READ,',
      'AND WHICH I HAVE NEVER HAD TO ENFORCE.',
      '',
      'YOU ARE NOT GOING TO STOP.',
      '— M. NATAS',
    ],
  },
  {
    id: 'depth220',
    when: (s) => s.depth > 220,
    lines: [
      'TWO HUNDRED AND TWENTY.',
      '',
      'THE ROCK BELOW YOU IS NOT OLDER THAN',
      'MARS. IT IS OLDER THAN ROCK.',
      '',
      'I AM NOT SENDING THIS FROM THE OFFICE.',
      '— M. NATAS',
    ],
  },
  {
    id: 'nearseal',
    when: (s) => s.depth > 242,
    lines: [
      'STOP READING THE INSTRUMENTS.',
      'THEY ARE NOT GOING TO HELP YOU WITH THIS',
      'AND THEY ARE BEGINNING TO EMBARRASS ME.',
      '',
      'THERE IS A DOOR DOWN THERE.',
      'I PUT IT THERE. I PUT YOU HERE.',
      'THE TWO FACTS ARE ONE FACT.',
      '',
      'COME IN.',
    ],
  },
];

/** The finale, printed line by line once the seal is opened. */
export const ENDING_LINES = [
  'THE SEAL IS OPEN.',
  '',
  'YOU WILL WANT TO KNOW WHAT I AM.',
  'EVERYONE DOES, AT THIS PART.',
  '',
  'I AM THE PARTY OF THE FIRST PART.',
  'I AM THE LINE AT THE BOTTOM OF THE PAGE.',
  'I AM THE INTEREST, COMPOUNDING, PATIENT,',
  'IN A HOLE ON A COLD PLANET, WAITING FOR',
  'SOMEBODY WITH A DRILL AND AN APPETITE.',
  '',
  'YOU DUG ME OUT. NOBODY MADE YOU.',
  'THAT IS THE ENTIRE POINT AND IT ALWAYS',
  'HAS BEEN.',
  '',
  'THE CLAIM IS YOURS. THE POD IS YOURS.',
  'THE DEBT IS SETTLED IN FULL.',
  '',
  'READ MY NAME BACKWARDS AND GO HOME.',
  '',
  '— M. NATAS',
];

/**
 * Tracks which beats have fired. Kept separate from the printer so the narrative
 * can be unit-tested without a cockpit attached to it.
 */
export class Narrative {
  constructor(fired = []) {
    this.fired = new Set(fired);
    this.queue = [];
  }

  /** @returns {string[][]} transmissions to print, in order. */
  update(snapshot) {
    const out = [];
    for (const beat of BEATS) {
      if (this.fired.has(beat.id)) continue;
      if (!beat.when(snapshot)) continue;
      this.fired.add(beat.id);
      out.push(beat.lines);
    }
    return out;
  }

  toJSON() {
    return [...this.fired];
  }
}
