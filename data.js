// Phantom Epoch — game definitions.
// Everything here is placeholder content. Replace names, numbers and card text
// as the real rules get defined; the app reads only from this file.
//
// Card format: { id, name, ap, text, actions }
//   id      — unique within its deck
//   ap      — Action Point cost (also counts toward initiative)
//   text    — shown on the card; may span several lines
//   actions — optional; lets the app resolve the card when it is used:
//     { type: 'move', value }            reminder only
//     { type: 'leap', value }            reminder only
//     { type: 'gain', status }           the user gains a status
//     { type: 'pierce', value }          the user's next attack gains Pierce
//     { type: 'guard', value }           Guard +value while the card's effect lasts
//     { type: 'brickWall' }              while the card's effect lasts, all damage to the
//                                        user is 0 and new detrimental conditions can't be
//                                        inflicted
//     { type: 'inflictCheck', status }   pick one enemy; roll the Accuracy die and on a
//                                        Success or Block inflict the status on it
//     { type: 'support', effect, who }   something done for the user or its allies:
//         effect: 'heal' (+ value)       a Heal action: restores HP and gives a Bandage
//                 'restore' (+ value)    recover HP without a Heal (no Bandage, no limit)
//                 'cleanse'              remove all detrimental conditions
//                 'gain' (+ statuses)    apply beneficial conditions
//                 'removeBandage'        remove one Bandage token
//         who:    'self'                 the user only (applied at once)
//                 'one'                  the user or one adjacent ally
//                 'all'                  the user and every adjacent ally
//                 'any'                  the user or any ally
//     { type: 'attack', mod,             attack modifier (Attack +1 → mod: 1)
//       range,                           the card's range, if it has one. Whether an
//                                        attack is melee or ranged depends only on
//                                        whether the target is adjacent (rulebook p.21)
//       pierce,                          lowers a positive Guard, never below 0
//       inflict: [statusId],             statuses applied to each target hit
//       targets,                         how many figures it can hit (default 1)
//       bonus: { label, mod },           optional situational modifier the user ticks
//                                        per target; replaces `mod` when ticked
//       doubleIfInvisible,               damage x2 if the attacker is Invisible
//       drain,                           if the target is an adversary, the user or an
//                                        adjacent ally recovers the HP the target lost
//       rangeMod,                        Range +N / −N on the figure's base range
//       noAccuracy,                      never rolls Accuracy; always reaches the target
//       critOnSuccess,                   a success without a Critical Strike still
//                                        activates the critical ability
//       stunInstead }                    on a success, may inflict Stunned instead of damage
// Critical effect { type: 'doubleDamage' } doubles the Attack's damage;
// { type: 'extraDamage', value } deals that much more damage once the Attack completes
// (direct damage, so Guard doesn't reduce it).
//   effect   — 'temporary' or 'persistent' (the icons on the card, rulebook p.41/43).
//              A temporary card stays in play until the start of its owner's next
//              turn, then goes to the discard pile; a persistent card stays until the
//              player discards it. Cards that say "for round" are temporary.
//   onlyCard — true if it may only be played when it is the round's only selected
//              card (otherwise it can still be converted to a Move or Attack)

function placeholderDeck(prefix, apCosts) {
  return apCosts.map((ap, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix} Card ${i + 1}`,
    ap,
    text: 'Card text to be defined.',
  }));
}

// ---- Player side ---------------------------------------------------------

// A player character is a species plus a class.
// Species: HP, AP budget per round, Guard, and a special ability.
//   guard         — reduces each incoming attack's damage
//   guardVsRanged — extra Guard against ranged attacks only
//   convertMoveBonus — extra MP when converting an Action card to a Move
const PLAYER_SPECIES = [
  { id: 'slink',    name: 'Slink',     hp: 13, ap: 11, guard: 0, guardVsRanged: 1, ability: 'Guard +1 against Ranged Attacks' },
  { id: 'human',    name: 'Human',     hp: 15, ap: 10, guard: 0, convertMoveBonus: 1, ability: 'When converting an Action card to a Move, add +1 MP' },
];

// Class: a critical ability and the 10-card deck. Each class can be taken by
// only one player. Card text may span several lines (one effect per line).
//   weapon — { name, range }: the class board's weapon; range is the base range
//            of every Attack (rulebook p.18, p.41)
//   criticalEffects — optional; what the app applies when this class rolls a
//                     Critical Strike (same format as card actions; `vsAdversary`
//                     limits it to Critical Strikes against adversaries)
const PLAYER_CLASSES = [
  {
    id: 'rogue',
    name: 'Rogue',
    weapon: { name: 'Enigma Blade', range: 1 },
    critical: 'Gain Invisible',
    criticalEffects: [{ type: 'gain', status: 'invisible' }],
    deck: [
      {
        id: 'rogue-backstab', name: 'Backstab', ap: 4,
        text: 'Attack +1, Attack +3 instead if another ally is also adjacent to the target',
        actions: [{ type: 'attack', mod: 1, bonus: { label: 'Another ally is adjacent to the target', mod: 3 } }],
      },
      {
        id: 'rogue-shadows', name: 'Into the Shadows', ap: 3,
        text: 'Move 2\nGain Invisible',
        actions: [{ type: 'move', value: 2 }, { type: 'gain', status: 'invisible' }],
      },
      {
        id: 'rogue-sneak', name: 'Sneak Attack', ap: 5,
        text: 'Attack, Damage x2 if the Attack is performed while Invisible',
        actions: [{ type: 'attack', mod: 0, doubleIfInvisible: true }],
      },
      {
        id: 'rogue-flurry', name: 'Flurry', ap: 2,
        text: 'Attack -1\nAttack -1',
        actions: [{ type: 'attack', mod: -1 }, { type: 'attack', mod: -1 }],
      },
      {
        id: 'rogue-parkour', name: 'Parkour', ap: 3,
        text: 'Leap 4',
        actions: [{ type: 'leap', value: 4 }],
      },
      {
        id: 'rogue-sprint', name: 'Sprint', ap: 2,
        text: 'Move 4',
        actions: [{ type: 'move', value: 4 }],
      },
      {
        id: 'rogue-fight-dirty', name: 'Fight Dirty', ap: 3,
        text: 'Attack -1 (Inflict Blinded)',
        actions: [{ type: 'attack', mod: -1, inflict: ['blinded'] }],
      },
      {
        id: 'rogue-vulnerability', name: 'Find Vulnerability', ap: 2,
        text: 'Play before performing any one Attack action. The Attack gains Pierce 4.',
        actions: [{ type: 'pierce', value: 4 }],
      },
      {
        id: 'rogue-knife', name: 'Throwing Knife', ap: 3,
        text: 'Attack (Range 4)',
        actions: [{ type: 'attack', mod: 0, range: 4 }],
      },
      {
        id: 'rogue-serrated', name: 'Serrated Edge', ap: 4,
        text: 'Attack (Inflict Bleeding)',
        actions: [{ type: 'attack', mod: 0, inflict: ['bleeding'] }],
      },
    ],
  },
  {
    id: 'warrior',
    name: 'Warrior',
    weapon: { name: 'Radiant Sword', range: 1 },
    critical: 'Gain Barrier and Vengeful',
    criticalEffects: [{ type: 'gain', status: 'barrier' }, { type: 'gain', status: 'vengeful' }],
    deck: [
      {
        id: 'warrior-bash', name: 'Shield Bash', ap: 3,
        text: 'Guard +1 for round\nAttack',
        effect: 'temporary',
        actions: [{ type: 'guard', value: 1 }, { type: 'attack', mod: 0 }],
      },
      {
        id: 'warrior-lunge', name: 'Lunge', ap: 4,
        text: 'Attack +1 (Range 2)',
        actions: [{ type: 'attack', mod: 1, range: 2 }],
      },
      {
        id: 'warrior-parry', name: 'Parry', ap: 7,
        text: 'Guard +2 for round\nAttack +2',
        effect: 'temporary',
        actions: [{ type: 'guard', value: 2 }, { type: 'attack', mod: 2 }],
      },
      {
        id: 'warrior-heavy', name: 'Heavy Swing', ap: 6,
        text: 'Attack +3',
        actions: [{ type: 'attack', mod: 3 }],
      },
      {
        id: 'warrior-shield-up', name: 'Shield Up', ap: 3,
        text: 'Guard +3 for round',
        effect: 'temporary',
        actions: [{ type: 'guard', value: 3 }],
      },
      {
        id: 'warrior-dash', name: 'Dash', ap: 1,
        text: 'Move 2',
        actions: [{ type: 'move', value: 2 }],
      },
      {
        id: 'warrior-tackle', name: 'Tackle', ap: 2,
        text: 'Move 4\nMust end in a space adjacent to a visible enemy. After the Move action, roll the Accuracy die. If a Block or Success is rolled, inflict Knocked Down on one adjacent enemy.',
        actions: [{ type: 'move', value: 4 }, { type: 'inflictCheck', status: 'knocked' }],
      },
      {
        id: 'warrior-vault', name: 'Vault', ap: 3,
        text: 'Leap 4, Must Leap through spaces in a straight line',
        actions: [{ type: 'leap', value: 4 }],
      },
      {
        id: 'warrior-brick-wall', name: 'Brick Wall', ap: 4,
        text: 'For round, all damage against the Warrior is treated as 0, and new detrimental conditions cannot be inflicted on the Warrior.\nThis must be the only card selected this turn, otherwise it must be discarded or converted to a Move or Attack action.',
        effect: 'temporary',
        onlyCard: true,
        actions: [{ type: 'brickWall' }],
      },
    ],
  },
  {
    id: 'healer',
    name: 'Healer',
    weapon: { name: "Chirurgeon's Knife", range: 1 },
    critical: 'If target is an adversary, remove one bandage from self or any ally',
    criticalEffects: [{ type: 'support', effect: 'removeBandage', who: 'any', vsAdversary: true }],
    deck: [
      {
        id: 'healer-anatomical', name: 'Anatomical Strike', ap: 4,
        text: 'Attack +1 (Pierce 3)',
        actions: [{ type: 'attack', mod: 1, pierce: 3 }],
      },
      {
        id: 'healer-invigorating', name: 'Invigorating Strike', ap: 5,
        text: 'Attack: If target is an adversary, recover HP on self or adjacent ally equal to the amount of HP the target loses',
        actions: [{ type: 'attack', mod: 0, drain: true }],
      },
      {
        id: 'healer-poultice', name: 'Herbal Poultice', ap: 4,
        text: 'Heal 5',
        actions: [{ type: 'support', effect: 'heal', value: 5, who: 'one' }],
      },
      {
        id: 'healer-mist', name: 'Healing Mist', ap: 4,
        text: 'Heal 3, Affects self and all adjacent allies',
        actions: [{ type: 'support', effect: 'heal', value: 3, who: 'all' }],
      },
      {
        id: 'healer-rush', name: 'Rush to their Aid', ap: 2,
        text: 'Move 6, Must end in a space adjacent to an ally',
        actions: [{ type: 'move', value: 6 }],
      },
      {
        id: 'healer-drag', name: 'Drag to Safety', ap: 3,
        text: 'Move 6: At any time during the Move action, the Healer may give any number of remaining MP to one adjacent ally. The ally must use the MP immediately after the Healer finishes Moving and must end adjacent to the Healer.',
        actions: [{ type: 'move', value: 6 }],
      },
      {
        id: 'healer-self-medicate', name: 'Self-Medicate', ap: 2,
        text: 'Heal 3 (Self)',
        actions: [{ type: 'support', effect: 'heal', value: 3, who: 'self' }],
      },
      {
        id: 'healer-balm', name: 'Soothing Balm', ap: 3,
        text: 'Remove all detrimental conditions from self or adjacent ally',
        actions: [{ type: 'support', effect: 'cleanse', who: 'one' }],
      },
      {
        id: 'healer-poisoned', name: 'Poisoned Strike', ap: 4,
        text: 'Attack (Inflict Weakened)',
        actions: [{ type: 'attack', mod: 0, inflict: ['weakened'] }],
      },
      {
        id: 'healer-preventative', name: 'Preventative Measures', ap: 5,
        text: 'Apply Resilient and Barrier to self or an adjacent ally',
        actions: [{ type: 'support', effect: 'gain', statuses: ['resilient', 'barrier'], who: 'one' }],
      },
    ],
  },
  {
    id: 'ranger',
    name: 'Ranger',
    weapon: { name: 'Ethereal Bow', range: 5 },
    critical: 'Damage x2',
    criticalEffects: [{ type: 'doubleDamage' }],
    deck: [
      {
        id: 'ranger-snipe', name: 'Snipe', ap: 4,
        text: 'Attack (Range +3), Do not roll any accuracy checks. The attack automatically reaches the intended target.',
        actions: [{ type: 'attack', mod: 0, rangeMod: 3, noAccuracy: true }],
      },
      {
        id: 'ranger-spread', name: 'Spread Shot', ap: 6,
        text: 'Attack (Target 3)',
        actions: [{ type: 'attack', mod: 0, targets: 3 }],
      },
      {
        id: 'ranger-penetrating', name: 'Penetrating Shot', ap: 5,
        text: 'Attack +1 (Range -1), On all accuracy checks during this attack, if a Success or Block is rolled, the attack applies as if a Block was rolled, but then continues on as if a Success was rolled. A Critical Strike hits every non-adjacent enemy and object in the line of sight.',
        actions: [{ type: 'attack', mod: 1, rangeMod: -1 }],
      },
      {
        id: 'ranger-reposition', name: 'Reposition', ap: 2,
        text: 'Move 5, Must end in a space adjacent to a wall or object.',
        actions: [{ type: 'move', value: 5 }],
      },
      {
        id: 'ranger-cover', name: 'Take Cover', ap: 3,
        text: 'Pick one adjacent destructible object. Infinite duration, Ranged Attacks targeting the Ranger instead target the destructible object, though range and line of sight is still drawn to the Ranger. Discard this card if the Ranger leaves their current space, or the object is destroyed.',
        effect: 'persistent',
        actions: [],
      },
      {
        id: 'ranger-evasive', name: 'Evasive Maneuvers', ap: 3,
        text: 'Move 3\nGuard +2 for round',
        effect: 'temporary',
        actions: [{ type: 'move', value: 3 }, { type: 'guard', value: 2 }],
      },
      {
        id: 'ranger-piercing', name: 'Piercing Shot', ap: 5,
        text: 'Attack (Pierce 3)',
        actions: [{ type: 'attack', mod: 0, pierce: 3 }],
      },
      {
        id: 'ranger-headshot', name: 'Headshot', ap: 5,
        text: 'Attack, If the attack succeeds but a Critical Strike was not rolled, activate an available critical ability anyway.',
        actions: [{ type: 'attack', mod: 0, critOnSuccess: true }],
      },
      {
        id: 'ranger-blunt', name: 'Blunt Shot', ap: 3,
        text: 'Attack, If the Attack succeeds, optionally inflict Stunned instead of dealing damage.',
        actions: [{ type: 'attack', mod: 0, stunInstead: true }],
      },
      {
        id: 'ranger-camouflage', name: 'Camouflage', ap: 2,
        text: 'Gain Invisible',
        actions: [{ type: 'gain', status: 'invisible' }],
      },
    ],
  },
];

// ---- Monster side --------------------------------------------------------

// Adversaries of one type (species + class) share one Species Action card and
// one Class Action card each round. Class cards list an AP cost for each of
// the four HP-base colours (lowest first); each adversary acts on its colour's
// line, so its initiative is species AP + its colour's class AP.
// Characters are shown in this colour, numbered 1–4.
const PLAYER_COLOR = '#ff9f43';

// Each adversary group (same species and class) shares one HP-base colour
// and plays that colour's line of its class card; members are numbered.
const ADVERSARY_COLORS = [
  { id: 'darkblue',  name: 'Dark blue',  css: '#3b6fe0' },
  { id: 'lightblue', name: 'Light blue', css: '#5cc8ff' },
  { id: 'red',       name: 'Red',        css: '#ff5c6c' },
  { id: 'yellow',    name: 'Yellow',     css: '#f2c14e' },
];

// Class card format: { id, lines: [...] } — one line per HP-base colour,
// top to bottom as printed (lowest AP first; colours move around per card):
//   { color, name, ap, text, actions }
// An adversary plays the line matching its colour. Card actions use the same
// format as character cards, plus:
//   attack rangeMod      Range +N / −N on the adversary's base range
//   { type: 'retreat', value }       reminder only
//   inflictCheck target: 'primary'   the check is against the primary target
//   round — a round effect (the (R) icon): active all round for adversaries of
//           this type and colour, except while Knocked Down or Stunned
//           (rulebook p.28, p.37):
//     guard          Guard +N for the adversary itself
//     aura: { kind: 'bonus', value, notClass }  adjacent allies get Guard +value
//                                               (except adversaries of notClass)
//     aura: { kind: 'share' }                   adjacent allies use the higher of
//                                               this adversary's Guard or their own
function placeholderClassDeck(prefix, baseCosts) {
  return baseCosts.map((ap, i) => ({
    id: `${prefix}-${i + 1}`,
    lines: ADVERSARY_COLORS.map((col, j) => ({
      color: col.id,
      name: `${prefix} Card ${i + 1}`,
      ap: ap + [0, 0, 1, 2][j],
      text: 'Card text to be defined.',
    })),
  }));
}

// Archer class lines, reused across its cards.
const ARCHER = {
  triple: { name: 'Triple Shot', ap: 3, text: 'Attack -2 (Target 3)',
    actions: [{ type: 'attack', mod: -2, targets: 3 }] },
  retreating: { name: 'Retreating Fire', ap: 3, text: 'Attack -1\nRetreat 2',
    actions: [{ type: 'attack', mod: -1 }, { type: 'retreat', value: 2 }] },
  fireArrows: { name: 'Fire Arrows', ap: 4,
    text: 'If the primary target is an enemy in range and line of sight, roll the Accuracy die. If a Success or Block is rolled, the target is inflicted with Burning.',
    actions: [{ type: 'inflictCheck', status: 'burning', target: 'primary' }] },
  fullDraw: { name: 'Full Draw', ap: 4, text: 'Attack (Range +2)',
    actions: [{ type: 'attack', mod: 0, rangeMod: 2 }] },
  precise: { name: 'Precise Shot', ap: 5, text: 'Attack (Pierce 3)',
    actions: [{ type: 'attack', mod: 0, pierce: 3 }] },
};
const line = (color, action) => ({ color, ...action });

// Sentry class lines.
const SENTRY_FALLBACK = 'If able, Attack -2 on primary target. If not, Move 3 toward closest ally. If no path to an ally exists, Move normally.';
const SENTRY = {
  shieldWall: { name: 'Shield Wall', ap: 2,
    text: `(R) Adjacent allies and objects use the higher of this adversary's Guard value or their own.\n${SENTRY_FALLBACK}`,
    round: { aura: { kind: 'share' } },
    actions: [{ type: 'attack', mod: -2 }] },
  strike: { name: 'Strike', ap: 3, text: 'Attack',
    actions: [{ type: 'attack', mod: 0 }] },
  stoic: { name: 'Stoic Defender', ap: 3,
    text: `(R) Guard +1 to self, adjacent non-Sentry allies, and adjacent objects.\n${SENTRY_FALLBACK}`,
    round: { guard: 1, aura: { kind: 'bonus', value: 1, notClass: 'sentry' } },
    actions: [{ type: 'attack', mod: -2 }] },
  subdue: { name: 'Subdue', ap: 4, text: 'Attack (Inflict Knocked Down)',
    actions: [{ type: 'attack', mod: 0, inflict: ['knocked'] }] },
  impenetrable: { name: 'Impenetrable Defense', ap: 5, text: 'Gain Resilient and Barrier',
    actions: [{ type: 'gain', status: 'resilient' }, { type: 'gain', status: 'barrier' }] },
};

// The Sentry class deck (all 10 cards).
const SENTRY_DECK = [
  { id: 'sentry-1', lines: [line('yellow', SENTRY.shieldWall), line('lightblue', SENTRY.strike), line('darkblue', SENTRY.strike), line('red', SENTRY.stoic)] },
  { id: 'sentry-2', lines: [line('lightblue', SENTRY.shieldWall), line('yellow', SENTRY.strike), line('darkblue', SENTRY.strike), line('red', SENTRY.stoic)] },
  { id: 'sentry-3', lines: [line('lightblue', SENTRY.shieldWall), line('darkblue', SENTRY.strike), line('red', SENTRY.subdue), line('yellow', SENTRY.impenetrable)] },
  { id: 'sentry-4', lines: [line('red', SENTRY.shieldWall), line('lightblue', SENTRY.stoic), line('yellow', SENTRY.strike), line('darkblue', SENTRY.subdue)] },
  { id: 'sentry-5', lines: [line('darkblue', SENTRY.shieldWall), line('lightblue', SENTRY.subdue), line('yellow', SENTRY.subdue), line('red', SENTRY.impenetrable)] },
  { id: 'sentry-6', lines: [line('lightblue', SENTRY.stoic), line('red', SENTRY.strike), line('yellow', SENTRY.strike), line('darkblue', SENTRY.impenetrable)] },
  { id: 'sentry-7', lines: [line('darkblue', SENTRY.shieldWall), line('yellow', SENTRY.stoic), line('red', SENTRY.subdue), line('lightblue', SENTRY.impenetrable)] },
  { id: 'sentry-8', lines: [line('yellow', SENTRY.shieldWall), line('red', SENTRY.strike), line('lightblue', SENTRY.subdue), line('darkblue', SENTRY.subdue)] },
  { id: 'sentry-9', lines: [line('yellow', SENTRY.stoic), line('darkblue', SENTRY.stoic), line('red', SENTRY.strike), line('lightblue', SENTRY.strike)] },
  { id: 'sentry-10', lines: [line('red', SENTRY.shieldWall), line('darkblue', SENTRY.stoic), line('lightblue', SENTRY.strike), line('yellow', SENTRY.subdue)] },
];

// The Archer class deck (all 10 cards).
const ARCHER_DECK = [
  { id: 'archer-1', lines: [line('red', ARCHER.triple), line('yellow', ARCHER.retreating), line('lightblue', ARCHER.triple), line('darkblue', ARCHER.retreating)] },
  { id: 'archer-2', lines: [line('yellow', ARCHER.triple), line('red', ARCHER.fireArrows), line('lightblue', ARCHER.fullDraw), line('darkblue', ARCHER.precise)] },
  { id: 'archer-3', lines: [line('lightblue', ARCHER.triple), line('yellow', ARCHER.retreating), line('darkblue', ARCHER.fullDraw), line('red', ARCHER.fullDraw)] },
  { id: 'archer-4', lines: [line('lightblue', ARCHER.retreating), line('red', ARCHER.retreating), line('yellow', ARCHER.fireArrows), line('darkblue', ARCHER.precise)] },
  { id: 'archer-5', lines: [line('darkblue', ARCHER.triple), line('lightblue', ARCHER.retreating), line('yellow', ARCHER.fullDraw), line('red', ARCHER.precise)] },
  { id: 'archer-6', lines: [line('lightblue', ARCHER.retreating), line('red', ARCHER.retreating), line('darkblue', ARCHER.fullDraw), line('yellow', ARCHER.precise)] },
  { id: 'archer-7', lines: [line('yellow', ARCHER.triple), line('darkblue', ARCHER.fireArrows), line('red', ARCHER.fullDraw), line('lightblue', ARCHER.precise)] },
  { id: 'archer-8', lines: [line('darkblue', ARCHER.retreating), line('lightblue', ARCHER.fireArrows), line('red', ARCHER.precise), line('yellow', ARCHER.precise)] },
  { id: 'archer-9', lines: [line('red', ARCHER.retreating), line('darkblue', ARCHER.retreating), line('yellow', ARCHER.fullDraw), line('lightblue', ARCHER.precise)] },
  { id: 'archer-10', lines: [line('darkblue', ARCHER.triple), line('yellow', ARCHER.retreating), line('red', ARCHER.triple), line('lightblue', ARCHER.fullDraw)] },
];

// Species Action cards: { id, name, ap, text, actions, round } — one action
// for every adversary of the species type that drew it. `round` works as on
// class lines. Extra action:
//   { type: 'trample', damage, inflict }  pick the enemies Moved through; each
//                                         takes direct damage and the conditions
// Extra round effect:
//   immune: true   immune to detrimental conditions; any already on the adversary
//                  are removed when the card is drawn (start of the round)
const GRALLOK_DECK = [
  { id: 'grallok-1', name: 'Lumbering Charge', ap: 4, text: 'Move 3\nAttack -2',
    actions: [{ type: 'move', value: 3 }, { type: 'attack', mod: -2 }] },
  { id: 'grallok-2', name: 'Defensive Stride', ap: 4, text: '(R) Guard +1\nMove 2',
    round: { guard: 1 },
    actions: [{ type: 'move', value: 2 }] },
  { id: 'grallok-3', name: 'Cumbersome Run', ap: 3, text: 'Move 4',
    actions: [{ type: 'move', value: 4 }] },
  { id: 'grallok-4', name: 'Bowl Over', ap: 7,
    text: 'Move 4\nMove through the primary target and as many other enemies as possible. Inflict 1 damage and Knocked Down on all enemies Moved through.\nIf the primary target is no longer in range, select a new primary target before resuming normal movement rules with any remaining MP.',
    actions: [{ type: 'move', value: 4 }, { type: 'trample', damage: 1, inflict: ['knocked'] }] },
  { id: 'grallok-5', name: 'Lumbering Charge', ap: 4, text: 'Move 3\nAttack -2',
    actions: [{ type: 'move', value: 3 }, { type: 'attack', mod: -2 }] },
  { id: 'grallok-6', name: 'Cumbersome Run', ap: 3, text: 'Move 4',
    actions: [{ type: 'move', value: 4 }] },
  { id: 'grallok-7', name: 'Lumbering Charge', ap: 4, text: 'Move 3\nAttack -2',
    actions: [{ type: 'move', value: 3 }, { type: 'attack', mod: -2 }] },
  { id: 'grallok-8', name: 'Defensive Stride', ap: 4, text: '(R) Guard +1\nMove 2',
    round: { guard: 1 },
    actions: [{ type: 'move', value: 2 }] },
  { id: 'grallok-9', name: 'Invincible Grallok', ap: 5,
    text: '(R) The Grallok is immune to detrimental conditions. Remove any such conditions already on the Grallok at the start of the round, including conditions that normally interrupt round effects.',
    round: { immune: true },
    actions: [] },
  { id: 'grallok-10', name: 'Cumbersome Run', ap: 3, text: 'Move 4',
    actions: [{ type: 'move', value: 4 }] },
];

// Adversary species and classes decide which Action-card decks an adversary
// draws from.
const MONSTER_SPECIES = [
  { id: 'grallok',  name: 'Grallok',  deck: GRALLOK_DECK }, // all 10 cards
  { id: 'gryllo',   name: 'Gryllo',   deck: placeholderDeck('Gryllo', [1, 2, 2, 3, 4, 5]) },
  { id: 'human',    name: 'Human',    deck: placeholderDeck('Human', [1, 2, 3, 3, 4, 5]) },
  { id: 'lypran',   name: 'Lypran',   deck: placeholderDeck('Lypran', [1, 2, 2, 3, 4, 4]) },
  { id: 'other',    name: 'Other',    deck: placeholderDeck('Other', [1, 1, 2, 3, 4, 5]) },
  { id: 'slink',    name: 'Slink',    deck: placeholderDeck('Slink', [1, 2, 2, 3, 3, 4]) },
  { id: 'timeless', name: 'Timeless', deck: placeholderDeck('Timeless', [2, 2, 3, 4, 4, 5]) },
  { id: 'wolf',     name: 'Wolf',     deck: placeholderDeck('Wolf', [1, 2, 2, 3, 4, 5]) },
];

const MONSTER_CLASSES = [
  { id: 'archer',    name: 'Archer',        deck: ARCHER_DECK },
  { id: 'berserker', name: 'Berserker',     deck: placeholderClassDeck('Berserker', [2, 3, 3, 4, 5, 6]) },
  { id: 'scout',     name: 'Scout',         deck: placeholderClassDeck('Scout', [1, 1, 2, 3, 4, 5]) },
  { id: 'sentry',    name: 'Sentry',        deck: SENTRY_DECK },
  { id: 'trained',   name: 'Trained Beast', deck: placeholderClassDeck('Trained', [1, 2, 3, 3, 4, 5]) },
  { id: 'wild',      name: 'Wild Beast',    deck: placeholderClassDeck('Wild', [1, 2, 2, 3, 4, 6]) },
];

// Adversary types: one per Adversary Description card. Stats are per level
// (difficulty); a mission normally uses adversaries of its own difficulty.
//   hp, guard, attack (added to every Attack), range (maximum Attack range)
//   critical — the card's text, always shown as a reminder
//   crit     — the parts the app applies on a Critical Strike:
//     { type: 'inflict', status }      inflict a condition on the target
//     { type: 'gain', status }         the adversary gains a condition
//     { type: 'selfInflict', status }  the adversary suffers a condition
//     { type: 'cleanse' }              the adversary removes its detrimental conditions
//     { type: 'healSelf', value }      the adversary Heals itself
//     { type: 'drainHalf' }            restore HP equal to half the damage dealt (round up)
//     { type: 'blitz', damage }        +damage if the Blitz Attack die also rolls a Critical Strike
//     { type: 'weakenOrDamage', damage } inflict Weakened, or +damage if already Weakened
//   manual   — true when part of the critical (movement, teleport, hazards) is
//              left to the player on the board
function advType(speciesId, classId, levels) {
  const sp = MONSTER_SPECIES.find((x) => x.id === speciesId);
  const cl = MONSTER_CLASSES.find((x) => x.id === classId);
  return { id: `${speciesId}-${classId}`, speciesId, classId, name: `${sp.name} ${cl.name}`, levels };
}

const ADVERSARY_TYPES = [
  advType('slink', 'archer', { 1: { hp: 5, guard: -1, attack: 3, range: 5,
    critical: 'At the end of the current turn, Retreat 3 and Heal 2 to self.',
    crit: [{ type: 'healSelf', value: 2 }], manual: true } }),
  advType('grallok', 'berserker', { 1: { hp: 9, guard: -1, attack: 3, range: 1,
    critical: 'Roll the Blitz Attack die. If a Critical Strike is rolled, add 3 damage to this Attack.',
    crit: [{ type: 'blitz', damage: 3 }] } }),
  advType('grallok', 'archer', { 1: { hp: 7, guard: -1, attack: 1, range: 5,
    critical: 'Inflict 1 Bleeding.',
    crit: [{ type: 'inflict', status: 'bleeding' }] } }),
  advType('grallok', 'sentry', { 1: { hp: 11, guard: 2, attack: 1, range: 1,
    critical: 'Gain Barrier.',
    crit: [{ type: 'gain', status: 'barrier' }] } }),
  advType('grallok', 'scout', { 1: { hp: 7, guard: 1, attack: 0, range: 3,
    critical: 'Remove any detrimental conditions, then gain Resilient.',
    crit: [{ type: 'cleanse' }, { type: 'gain', status: 'resilient' }] } }),
  advType('slink', 'berserker', { 1: { hp: 7, guard: 1, attack: 1, range: 1,
    critical: 'Restore HP equal to half of the damage dealt. Round up.',
    crit: [{ type: 'drainHalf' }] } }),
  advType('slink', 'sentry', { 1: { hp: 9, guard: 2, attack: -1, range: 1,
    critical: 'Inflict Knocked Down.',
    crit: [{ type: 'inflict', status: 'knocked' }] } }),
  advType('slink', 'scout', { 1: { hp: 5, guard: 1, attack: 2, range: 3,
    critical: 'Heal 4 to self.',
    crit: [{ type: 'healSelf', value: 4 }] } }),
  advType('human', 'archer', { 1: { hp: 6, guard: -2, attack: 3, range: 5,
    critical: 'Inflict Stunned.',
    crit: [{ type: 'inflict', status: 'stunned' }] } }),
  advType('human', 'berserker', { 1: { hp: 8, guard: -2, attack: 3, range: 1,
    critical: 'Inflict Vulnerable.',
    crit: [{ type: 'inflict', status: 'vulnerable' }] } }),
  advType('human', 'sentry', { 1: { hp: 10, guard: 1, attack: 1, range: 1,
    critical: 'Gain Vengeful.',
    crit: [{ type: 'gain', status: 'vengeful' }] } }),
  advType('human', 'scout', { 1: { hp: 6, guard: 0, attack: 2, range: 3,
    critical: 'Force target to Retreat 2 following adversary rules at the end of the current turn.',
    crit: [], manual: true } }),
  advType('gryllo', 'trained', { 1: { hp: 6, guard: 1, attack: 1, range: 1,
    critical: 'Place a poison hazard in an empty space adjacent to the target, using the Decision die.',
    crit: [], manual: true } }),
  advType('gryllo', 'wild', { 1: { hp: 7, guard: 0, attack: 2, range: 1,
    critical: 'Inflict Weakened or add 2 damage to the Attack if the target is already Weakened.',
    crit: [{ type: 'weakenOrDamage', damage: 2 }] } }),
  advType('other', 'scout', { 1: { hp: 3, guard: 2, attack: 1, range: 3,
    critical: 'Gain Invisible at the end of the current turn.',
    crit: [{ type: 'gain', status: 'invisible' }] } }),
  advType('lypran', 'wild', { 1: { hp: 5, guard: 0, attack: 3, range: 2,
    critical: 'Retreat 1, then Teleport the target into the space the Lypran left.',
    crit: [], manual: true } }),
  advType('lypran', 'trained', { 1: { hp: 4, guard: 1, attack: 2, range: 2,
    critical: 'Teleport target to an empty space adjacent to the Lypran, determined by the Decision die.',
    crit: [], manual: true } }),
  advType('timeless', 'archer', { 1: { hp: 7, guard: -1, attack: 3, range: 4,
    critical: 'Leap 5.',
    crit: [], manual: true } }),
  advType('timeless', 'berserker', { 1: { hp: 9, guard: -1, attack: 3, range: 1,
    critical: 'Inflict Knocked Down and Bleeding on target, and Knocked Down on self.',
    crit: [{ type: 'inflict', status: 'knocked' }, { type: 'inflict', status: 'bleeding' }, { type: 'selfInflict', status: 'knocked' }] } }),
  advType('wolf', 'trained', { 1: { hp: 5, guard: 0, attack: 2, range: 1,
    critical: 'Inflict Stunned.',
    crit: [{ type: 'inflict', status: 'stunned' }] } }),
  advType('wolf', 'wild', { 1: { hp: 6, guard: -1, attack: 3, range: 1,
    critical: 'Inflict Bleeding.',
    crit: [{ type: 'inflict', status: 'bleeding' }] } }),
  advType('timeless', 'sentry', { 1: { hp: 11, guard: 2, attack: 1, range: 2,
    critical: 'All adjacent enemies that are not Knocked Down Retreat 1 using adversary rules.',
    crit: [], manual: true } }),
];

// ---- Statuses ------------------------------------------------------------

// Condition tokens (rulebook p.37). The rules in the text are applied by
// combat.js; `type` decides which side of the checkbox list they appear on
// and whether Resilient blocks them. Unless noted otherwise, detrimental
// conditions on characters last until they rest; on adversaries they are
// permanent.
const STATUSES = [
  { id: 'barrier',   type: 'beneficial', name: 'Barrier',
    text: 'The next time the figure would receive damage, remove this condition instead.' },
  { id: 'invisible', type: 'beneficial', name: 'Invisible',
    text: 'Cannot be Attacked, Healed, or otherwise affected by any action performed by any figure other than itself. Line of sight can never be drawn to an Invisible figure. May Move through enemies and vice versa. Remove at the end of the figure\'s next full turn after receiving it, or upon performing an Attack action, even if the Attack fails.' },
  { id: 'resilient', type: 'beneficial', name: 'Resilient',
    text: 'The next time the figure would receive a new detrimental condition, remove this condition instead.' },
  { id: 'vengeful',  type: 'beneficial', name: 'Vengeful',
    text: 'After a Melee Attack completes against the figure and does not result in it being Knocked Down, Stunned, defeated, or otherwise unable to Attack, the figure performs an Attack -1 in retaliation, then removes this condition. If another effect defeats the attacker first, keep this condition.' },

  { id: 'bleeding',  type: 'detrimental', name: 'Bleeding',
    text: 'Take 2 damage at the start of each non-rest turn.' },
  { id: 'blinded',   type: 'detrimental', name: 'Blinded',
    text: 'Before rolling any Attack, roll the Accuracy die, proceeding only on a Success.' },
  { id: 'burning',   type: 'detrimental', name: 'Burning',
    text: 'Take 3 damage at the start of the next non-rest turn, then remove this condition. If the figure would be inflicted with Frozen, remove Burning instead.' },
  { id: 'frozen',    type: 'detrimental', name: 'Frozen',
    text: 'AP cost (including for initiative) of all Action cards is doubled, and Action cards cannot be converted to movement. Remove at the end of the figure\'s next full turn after receiving it. If the figure would be inflicted with Burning, remove Frozen instead.' },
  { id: 'knocked',   type: 'detrimental', name: 'Knocked Down',
    text: 'Cannot Attack, take any non-Move or non-Leap action, use items, or activate equipment/attachments with manual triggers until spending 1 MP to remove this condition. Adversary round effects are inactive meanwhile, and adversaries convert their next Action card to movement if it has no round effect, Move or Leap.' },
  { id: 'stunned',   type: 'detrimental', name: 'Stunned',
    text: 'Characters cannot take any action, use items, or activate manual equipment/attachments until resting or discarding a selected Action card. Adversaries cannot act until the end of their next full turn after being Stunned, then remove it; their round effects are inactive meanwhile.' },
  { id: 'vulnerable', type: 'detrimental', name: 'Vulnerable',
    text: '-2 to Guard (Guard can go below 0, which increases damage taken).' },
  { id: 'weakened',  type: 'detrimental', name: 'Weakened',
    text: '-2 to all Attacks.' },
];

// ---- Gear ----------------------------------------------------------------

// Every player character has these slots. `type` says which list below can
// fill it; equipment is further limited to items whose `slot` matches.
const GEAR_SLOTS = [
  { id: 'head',        label: 'Head',         type: 'equipment', group: 'Equipment' },
  { id: 'body',        label: 'Body',         type: 'equipment', group: 'Equipment' },
  { id: 'feet',        label: 'Feet',         type: 'equipment', group: 'Equipment' },
  { id: 'attachment1', label: 'Attachment 1', type: 'attachment', group: 'Attachments' },
  { id: 'attachment2', label: 'Attachment 2', type: 'attachment', group: 'Attachments' },
  { id: 'item1',       label: 'Item 1',       type: 'item',      group: 'Items' },
  { id: 'item2',       label: 'Item 2',       type: 'item',      group: 'Items' },
];

// Item format: { id, name, text } — equipment also has `slot`: head | body | feet.
const GEAR = {
  equipment: [
    { id: 'eq-head1',  slot: 'head',  name: 'Head Gear 1',  text: 'Effect to be defined.' },
    { id: 'eq-head2',  slot: 'head',  name: 'Head Gear 2',  text: 'Effect to be defined.' },
    { id: 'eq-body1', slot: 'body',  name: 'Body Gear 1', text: 'Effect to be defined.' },
    { id: 'eq-body2', slot: 'body',  name: 'Body Gear 2', text: 'Effect to be defined.' },
    { id: 'eq-feet1',  slot: 'feet',  name: 'Feet Gear 1',  text: 'Effect to be defined.' },
    { id: 'eq-feet2',  slot: 'feet',  name: 'Feet Gear 2',  text: 'Effect to be defined.' },
  ],
  // Attachments may also have:
  //   classId  — a class's starting attachment: only that class can equip it
  //   starting — equipped automatically when a character of that class is created
  //   critical / criticalEffects — an extra critical ability (rulebook p.20: when
  //              several are available, the player picks one per Critical Strike)
  attachment: [
    { id: 'corporeal-arrows', name: 'Corporeal Arrows', classId: 'ranger', starting: true,
      text: 'Critical Ability: Inflict Vulnerable',
      critical: 'Inflict Vulnerable', criticalEffects: [{ type: 'inflict', status: 'vulnerable' }] },
    { id: 'hemorrhage-inducer', name: 'Hemorrhage Inducer', classId: 'healer', starting: true,
      text: 'Critical Ability: Inflict Bleeding',
      critical: 'Inflict Bleeding', criticalEffects: [{ type: 'inflict', status: 'bleeding' }] },
    { id: 'radiant-spark', name: 'Radiant Spark', classId: 'warrior', starting: true,
      text: 'Critical Ability: Inflict Stunned',
      critical: 'Inflict Stunned', criticalEffects: [{ type: 'inflict', status: 'stunned' }] },
    { id: 'hidden-barb', name: 'Hidden Barb', classId: 'rogue', starting: true,
      text: 'Critical Ability: Deal an additional 3 damage after the Attack action completes.',
      critical: 'Deal an additional 3 damage after the Attack', criticalEffects: [{ type: 'extraDamage', value: 3 }] },
    { id: 'att1', name: 'Attachment 1', text: 'Effect to be defined.' },
    { id: 'att2', name: 'Attachment 2', text: 'Effect to be defined.' },
    { id: 'att3', name: 'Attachment 3', text: 'Effect to be defined.' },
  ],
  // Items may also have:
  //   use            — what using it does (same format as a card action)
  //   oncePerMission — flipped over after use until the next mission
  item: [
    { id: 'medical-kit', name: 'Medical Kit', classId: 'healer', starting: true, oncePerMission: true,
      text: 'Once per mission, remove two Bandages from self or an adjacent ally.',
      use: { type: 'support', effect: 'removeBandage', value: 2, who: 'one' } },
    { id: 'item1', name: 'Item 1', text: 'Effect to be defined.' },
    { id: 'item2', name: 'Item 2', text: 'Effect to be defined.' },
    { id: 'item3', name: 'Item 3', text: 'Effect to be defined.' },
  ],
};

// Bandage tokens: a character gains one each time a Heal action restores HP,
// and can't be Healed once every slot is full.
const BANDAGE_SLOTS = 2;

// Up to 4 characters per mission, at most one per class (rulebook p.8).
const MAX_CHARACTERS = 4;
