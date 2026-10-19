// Phantom Epoch — combat rules (rulebook pp.20–23, 37).
// Conditions, Guard, the Attack flow and start/end-of-turn effects. These work
// on the shared `state` from app.js and report what happened to the round log.
//
// Attack flow, per target (each target of a multi-target Attack is its own roll):
//   1. Roll the Attack die on the table and enter the result. A Fumble misses
//      and ends the attacker's Attacks for the turn (characters may convert it
//      to 0 by becoming Knocked Down). A Critical Strike counts as 3, pierces
//      all positive Guard, skips the Accuracy die and triggers a critical ability.
//   2. Attack value = roll + card modifier + adversary Attack attribute
//      (−2 if Weakened).
//   3. Ranged (non-adjacent) Attacks roll the Accuracy die for each figure or
//      object on the line of sight; on a Miss the Attack fails. (On a Block,
//      pick the blocker as the target instead.)
//   4. Guard = all sources (−2 if Vulnerable); may be negative. Pierce lowers a
//      positive Guard, never below 0.
//   5. Damage = Attack value − Guard (min 0); "Damage x2" applies after Guard.
//   6. Conditions apply only if the Attack succeeded: Attack value > Guard.

const has = (c, sid) => c.statuses.includes(sid);
const isDown = (c) => c.hp <= 0;
const signed = (n) => (n >= 0 ? `+${n}` : `−${-n}`);

function log(msg) {
  state.log.unshift({ round: state.round, msg });
  if (state.log.length > 200) state.log.length = 200;
}

function actingId() {
  return state.phase === 'initiative' ? state.order[state.turn] : null;
}

// ---- Cards in play (temporary / persistent effects) ---------------------

// Each entry in c.effects is a played card whose effect is still active:
// { cardId, name, kind: 'temporary' | 'persistent', guard, brickWall }.
const hasBrickWall = (c) => c.effects.some((e) => e.brickWall);

// Put a played card's lasting effect into play.
function addEffect(c, card) {
  const actions = card.actions || [];
  const effect = {
    cardId: card.id,
    name: card.name,
    text: card.text,
    kind: card.effect,
    guard: actions.filter((a) => a.type === 'guard').reduce((sum, a) => sum + a.value, 0),
    brickWall: actions.some((a) => a.type === 'brickWall'),
  };
  c.effects.push(effect);
  const bits = [];
  if (effect.guard) bits.push(`Guard +${effect.guard}`);
  if (effect.brickWall) bits.push('damage is 0 and no new detrimental conditions');
  const until = effect.kind === 'persistent' ? 'until discarded' : `until the start of ${c.name}'s next turn`;
  log(`${card.name} stays in play${bits.length ? ` (${bits.join('; ')})` : ''} ${until}`);
}

// Take a card out of play. Character cards go to their discard pile.
function endEffect(c, effect) {
  c.effects = c.effects.filter((e) => e !== effect);
  if (c.discard && !c.discard.includes(effect.cardId) && !c.selected.includes(effect.cardId)) c.discard.push(effect.cardId);
  log(`${c.name}'s ${effect.name} ends and is discarded`);
}

// ---- Costs, Attack and Guard ---------------------------------------------

// Frozen doubles the AP cost of every Action card (initiative included).
function cardCost(c, card) {
  return card.ap * (has(c, 'frozen') ? 2 : 1);
}

// Flat bonus added to every Attack the figure makes.
function attackBonus(kind, c) {
  if (kind === 'player') return 0;
  return monsterStats(c).attack;
}

function baseGuard(kind, c) {
  if (kind === 'player') return PSPECIES[c.speciesId].guard || 0;
  return monsterStats(c).guard;
}

// ---- Adversary round effects ---------------------------------------------

// Round effects on an adversary's cards this round — its species card and
// its class line — while active (not while Knocked Down or Stunned,
// rulebook p.37). Each is { name, guard?, aura? }.
function roundEffects(m) {
  if (isDown(m) || waiting(m) || has(m, 'knocked') || has(m, 'stunned')) return [];
  return monsterCards(m).filter((card) => card.round).map((card) => ({ name: card.name, ...card.round }));
}

// Start of the round: adversaries whose drawn cards make them immune shed
// their detrimental conditions (even ones that would switch round effects off).
function applyImmunity() {
  for (const m of state.monsters) {
    if (isDown(m) || waiting(m) || !monsterCards(m).some((card) => card.round && card.round.immune)) continue;
    const bad = m.statuses.filter((sid) => STATUS[sid].type === 'detrimental');
    bad.forEach((sid) => removeStatus(m, sid));
    if (bad.length) log(`${m.name} is immune this round and removes ${bad.map((sid) => STATUS[sid].name).join(', ')}`);
  }
}

// Round effects that can protect a target T standing next to adversary S.
function aurasFor(S, T) {
  return roundEffects(S).filter((r) => r.aura && !(r.aura.kind === 'bonus' && r.aura.notClass === T.c.classId));
}

function describeRound(r) {
  const bits = [];
  if (r.guard) bits.push(`Guard +${r.guard} to self`);
  if (r.aura && r.aura.kind === 'bonus') bits.push(`adjacent ${r.aura.notClass ? `non-${MCLASSES[r.aura.notClass].name} ` : ''}allies Guard +${r.aura.value}`);
  if (r.aura && r.aura.kind === 'share') bits.push("adjacent allies use the higher of its Guard or their own");
  if (r.immune) bits.push('immune to detrimental conditions');
  return bits.join('; ');
}

// Adversaries protecting target T: those that picked T as adjacent when they
// played their card this round, while their round effect is still active.
function protectorsOf(T) {
  if (T.kind !== 'monster') return [];
  return state.monsters.filter((S) => S.id !== T.c.id
    && ((state.auraLinks || {})[S.id] || []).includes(T.c.id) && aurasFor(S, T).length);
}

// Guard against one Attack, with a breakdown of what changed it.
function guardAgainst(kind, c, { ranged = false, pierce = 0, crit = false } = {}) {
  let value = baseGuard(kind, c);
  const parts = [`Guard ${value}`];
  for (const r of kind === 'monster' ? roundEffects(c) : []) {
    if (r.guard) { value += r.guard; parts.push(`+${r.guard} ${r.name}`); }
  }
  const vsRanged = kind === 'player' ? PSPECIES[c.speciesId].guardVsRanged || 0 : 0;
  if (ranged && vsRanged) { value += vsRanged; parts.push(`${signed(vsRanged)} vs ranged`); }
  for (const e of c.effects) {
    if (e.guard) { value += e.guard; parts.push(`+${e.guard} ${e.name}`); }
  }
  // "Use the higher Guard" replaces the base before any +N bonuses are added.
  const T = { kind, c };
  const protections = protectorsOf(T).flatMap((S) => aurasFor(S, T).map((r) => ({ S, r })))
    .sort((a, b) => (a.r.aura.kind === 'share' ? 0 : 1) - (b.r.aura.kind === 'share' ? 0 : 1));
  for (const { S, r } of protections) {
    if (r.aura.kind === 'share') {
      const theirs = guardAgainst('monster', S).value;
      if (theirs > value) { value = theirs; parts.push(`uses ${S.name}'s Guard ${theirs}`); }
    } else {
      value += r.aura.value;
      parts.push(`+${r.aura.value} ${r.name}`);
    }
  }
  if (has(c, 'vulnerable')) { value -= 2; parts.push('−2 Vulnerable'); }
  if (value > 0 && crit) {
    value = 0;
    parts.push('pierced by Critical Strike');
  } else if (value > 0 && pierce) {
    const cut = Math.min(value, pierce);
    value -= cut;
    parts.push(`−${cut} Pierce`);
  }
  return { value, parts };
}

// ---- Conditions ----------------------------------------------------------

// Apply a condition through the rules (Resilient, Burning/Frozen). Returns a log line.
function addStatus(c, sid) {
  const s = STATUS[sid];
  if (has(c, sid)) return `${c.name}'s ${s.name} is refreshed`;
  if (s.type === 'detrimental' && hasBrickWall(c)) return `${c.name}'s Brick Wall prevents ${s.name}`;
  if (s.type === 'detrimental' && c.typeId) {
    const immune = roundEffects(c).find((r) => r.immune);
    if (immune) return `${c.name} is immune to ${s.name} (${immune.name})`;
  }
  if (s.type === 'detrimental' && has(c, 'resilient')) {
    removeStatus(c, 'resilient');
    return `${c.name}'s Resilient blocks ${s.name} (Resilient removed)`;
  }
  if (sid === 'frozen' && has(c, 'burning')) {
    removeStatus(c, 'burning');
    return `${c.name}: Frozen removes Burning instead`;
  }
  if (sid === 'burning' && has(c, 'frozen')) {
    removeStatus(c, 'frozen');
    return `${c.name}: Burning removes Frozen instead`;
  }
  c.statuses.push(sid);
  // Gained during the figure's own turn: that turn isn't a "full turn", so
  // timed conditions last through the figure's next turn.
  if (actingId() === c.id) c.hold[sid] = true;
  return `${c.name} gains ${s.name}`;
}

function removeStatus(c, sid) {
  c.statuses = c.statuses.filter((s) => s !== sid);
  delete c.hold[sid];
}

// Damage from any source; Barrier soaks the whole hit. Guard never applies
// here (Burning and Bleeding are direct damage). Returns a log line.
function takeDamage(c, amount, source) {
  if (amount <= 0) return `${c.name} takes no damage from ${source}`;
  if (hasBrickWall(c)) return `${c.name}'s Brick Wall reduces ${amount} damage from ${source} to 0`;
  if (has(c, 'barrier')) {
    removeStatus(c, 'barrier');
    return `${c.name}'s Barrier absorbs ${amount} damage from ${source} (Barrier removed)`;
  }
  c.hp = Math.max(0, c.hp - amount);
  if (isDown(c)) {
    c.statuses = [];
    c.hold = {};
    [...c.effects].forEach((e) => endEffect(c, e));
    return `${c.name} takes ${amount} damage from ${source} and is defeated`;
  }
  return `${c.name} takes ${amount} damage from ${source} (${c.hp} HP left)`;
}

// A Heal action. Characters gain a Bandage token each time one restores HP,
// and can't be Healed once their bandage slots are full; adversaries have no limit.
function heal(kind, c, amount) {
  if (isDown(c)) return `${c.name} is defeated and can't be Healed`;
  const max = maxHp(kind, c);
  if (c.hp >= max) return `${c.name} is already at full HP (no Bandage)`;
  if (kind === 'player' && c.bandages >= BANDAGE_SLOTS) return `${c.name}'s bandage slots are full — the Heal has no effect`;
  const gained = Math.min(amount, max - c.hp);
  c.hp += gained;
  if (kind === 'player') c.bandages += 1;
  return `${c.name} is Healed for ${gained} (${c.hp} HP)${kind === 'player' ? ` and gains a Bandage (${c.bandages}/${BANDAGE_SLOTS})` : ''}`;
}

// ---- Support actions (heal, cleanse, ...) --------------------------------

const SUPPORT_WHO = {
  self: 'self',
  one: 'self or an adjacent ally',
  all: 'self and all adjacent allies',
  any: 'self or any ally',
};

function describeSupport(a) {
  const what = {
    heal: `Heal ${a.value}`,
    restore: `Recover ${a.value} HP`,
    cleanse: 'Remove all detrimental conditions',
    gain: `Apply ${(a.statuses || []).map((sid) => STATUS[sid].name).join(' and ')}`,
    removeBandage: (a.value || 1) > 1 ? `Remove ${a.value} Bandages` : 'Remove one Bandage',
  }[a.effect];
  return `${what} — ${SUPPORT_WHO[a.who]}`;
}

// What a support action would do to one figure F = { kind, c }, as a preview line.
function previewSupport(a, F) {
  const { kind, c } = F;
  const max = maxHp(kind, c);
  switch (a.effect) {
    case 'heal':
      if (c.hp >= max) return `Already at full HP — no effect${kind === 'player' ? ', no Bandage' : ''}`;
      if (kind !== 'player') return `HP ${c.hp} → ${Math.min(max, c.hp + a.value)}`;
      if (c.bandages >= BANDAGE_SLOTS) return 'Bandage slots full — no effect';
      return `HP ${c.hp} → ${Math.min(max, c.hp + a.value)}, gains a Bandage (${c.bandages + 1}/${BANDAGE_SLOTS})`;
    case 'restore':
      return c.hp >= max ? 'Already at full HP' : `HP ${c.hp} → ${Math.min(max, c.hp + a.value)} (no Bandage)`;
    case 'cleanse': {
      const bad = c.statuses.filter((sid) => STATUS[sid].type === 'detrimental');
      return bad.length ? `Removes ${bad.map((sid) => STATUS[sid].name).join(', ')}` : 'No detrimental conditions';
    }
    case 'gain':
      return `Gains ${a.statuses.map((sid) => STATUS[sid].name).join(' and ')}`;
    case 'removeBandage':
      return c.bandages ? `Bandages ${c.bandages} → ${Math.max(0, c.bandages - (a.value || 1))}` : 'No Bandages to remove';
    default:
      return '';
  }
}

// Apply a support action to one figure F = { kind, c }. Returns a log line.
function applySupport(a, F) {
  const { kind, c } = F;
  switch (a.effect) {
    case 'heal':
      return heal(kind, c, a.value);
    case 'restore': {
      const gained = Math.min(a.value, maxHp(kind, c) - c.hp);
      if (gained <= 0) return `${c.name} is already at full HP`;
      c.hp += gained;
      return `${c.name} recovers ${gained} HP (${c.hp} HP)`;
    }
    case 'cleanse': {
      const bad = c.statuses.filter((sid) => STATUS[sid].type === 'detrimental');
      bad.forEach((sid) => removeStatus(c, sid));
      return bad.length ? `${c.name} is cleared of ${bad.map((sid) => STATUS[sid].name).join(', ')}` : `${c.name} has no detrimental conditions`;
    }
    case 'gain':
      return a.statuses.map((sid) => addStatus(c, sid)).join('; ');
    case 'removeBandage': {
      if (!c.bandages) return `${c.name} has no Bandages`;
      const removed = Math.min(c.bandages, a.value || 1);
      c.bandages -= removed;
      return `${c.name} removes ${removed} Bandage${removed === 1 ? '' : 's'} (${c.bandages}/${BANDAGE_SLOTS})`;
    }
    default:
      return '';
  }
}

// ---- Turns ---------------------------------------------------------------

// Runs once per figure per round, when its turn begins.
function startTurn(idx) {
  const id = state.order[idx];
  if (!id || state.started[id]) return;
  state.started[id] = true;
  const e = charById(id);
  if (!e || isDown(e.c)) return;
  const { kind, c } = e;

  // Step 1: remove temporary effects (their cards are discarded).
  c.effects.filter((x) => x.kind === 'temporary').forEach((x) => endEffect(c, x));

  if (kind === 'player' && c.resting) {
    // Rest turn: detrimental conditions may be removed before any effects.
    const bad = c.statuses.filter((s) => STATUS[s].type === 'detrimental');
    bad.forEach((s) => removeStatus(c, s));
    log(`${c.name} rests${bad.length ? ` and removes ${bad.map((s) => STATUS[s].name).join(', ')}` : ''}`);
    return;
  }
  if (has(c, 'bleeding')) log(takeDamage(c, 2, 'Bleeding'));
  if (has(c, 'burning')) {
    log(takeDamage(c, 3, 'Burning'));
    removeStatus(c, 'burning');
  }
  if (isDown(c)) return;
  if (has(c, 'stunned')) {
    log(kind === 'monster'
      ? `${c.name} is Stunned and cannot act this turn`
      : `${c.name} is Stunned: discard a selected card before acting`);
  }
  if (has(c, 'knocked')) {
    log(kind === 'monster'
      ? `${c.name} is Knocked Down: it spends 1 MP to stand, and converts its next Action card to movement unless it has a round effect, Move or Leap`
      : `${c.name} is Knocked Down: spend 1 MP to stand before Attacking`);
  }
}

// Runs once per figure per round, when its turn ends.
function endTurn(idx) {
  const id = state.order[idx];
  if (!id || state.ended[id]) return;
  state.ended[id] = true;
  const e = charById(id);
  if (!e) return;
  const { kind, c } = e;

  const expiring = ['frozen', 'invisible'];
  if (kind === 'monster') expiring.push('stunned');
  for (const sid of expiring) {
    if (!has(c, sid) || c.hold[sid]) continue;
    removeStatus(c, sid);
    log(`${c.name}'s ${STATUS[sid].name} wears off`);
  }
  c.hold = {};
  c.pierce = 0; // "Play before any one Attack action" — unused Pierce lapses
  c.fumbled = false;
  c.mp = false;
  c.attackedThisTurn = false;
  c.convertedAttack = false;
}

// ---- Cards ---------------------------------------------------------------

// Why a card can't be played (only converted) right now, or null.
function playBlocker(kind, c, card) {
  if (card.onlyCard && roundCards(kind, c).length > 1) return 'must be the only card selected this round — discard or convert it';
  return null;
}

// Play a card. Non-attack effects apply at once; attacks and checks open the
// action panel; temporary/persistent cards stay in play.
function useCard(kind, c, card) {
  if (c.used.includes(card.id)) return;
  if (!(kind === 'player' && has(c, 'stunned')) && playBlocker(kind, c, card)) return;
  c.used.push(card.id);

  if (kind === 'player' && has(c, 'stunned')) {
    removeStatus(c, 'stunned');
    log(`${c.name} discards ${card.name} to recover from Stunned`);
    return;
  }

  const actions = card.actions || [];
  const notes = actions.filter((a) => ['move', 'leap', 'retreat'].includes(a.type))
    .map((a) => `${{ move: 'Move', leap: 'Leap', retreat: 'Retreat' }[a.type]} ${a.value}`);
  log(`${c.name} plays ${card.name}${notes.length ? ` (${notes.join(', ')})` : ''}`);
  if (notes.length) c.mp = true; // MP to spend, e.g. to stand up from Knocked Down

  if (card.effect) addEffect(c, card);
  for (const a of actions) {
    if (a.type === 'support' && a.who === 'self') log(applySupport(a, { kind, c }));
    if (a.type === 'gain') log(addStatus(c, a.status));
    if (a.type === 'pierce') {
      c.pierce = (c.pierce || 0) + a.value;
      log(`${c.name}'s next Attack gains Pierce ${a.value}`);
    }
  }
  const queued = actions.filter((a) => ['attack', 'inflictCheck', 'trample'].includes(a.type) || (a.type === 'support' && a.who !== 'self'));
  // A round effect that protects adjacent allies: pick them now, as the card is played.
  if (kind === 'monster' && card.round && card.round.aura) queued.unshift({ type: 'auraAllies', round: card.round, name: card.name });
  if (queued.length) {
    state.attack = newAttack(c.id, card.name, queued);
    state.attack.text = card.text; // the card's full wording, shown in the panel
    state.attack.round = card.round || null; // a round effect is separate from the action
    state.attack.cardId = card.id; // so Cancel can return the card
  }
}

// Why a card can't be converted right now, or null.
function conversionBlocker(c, to, card = null) {
  if (to === 'move' && has(c, 'frozen')) return 'Frozen figures cannot convert cards to movement';
  if (to === 'move' && card && card.round) return 'cards with a round effect are never converted to movement';
  if (to === 'attack' && c.attackedThisTurn) return 'already Attacked with a card this turn';
  if (to === 'attack' && c.convertedAttack) return 'already converted a card to an Attack this turn';
  return null;
}

// MP from converting a card to a Move: its AP, plus any species bonus.
function convertMp(kind, c, card) {
  return card.ap + (kind === 'player' ? PSPECIES[c.speciesId].convertMoveBonus || 0 : 0);
}

// Convert a selected card into Move (MP = its AP) or an Attack with base 0.
// No action on the card is performed either way.
function convertCard(kind, c, card, to) {
  if (c.used.includes(card.id) || conversionBlocker(c, to, card)) return;
  c.used.push(card.id);
  if (to === 'move') {
    log(`${c.name} converts ${card.name} to Move ${convertMp(kind, c, card)}`);
    c.mp = true;
    return;
  }
  c.convertedAttack = true;
  log(`${c.name} converts ${card.name} to an Attack`);
  state.attack = newAttack(c.id, `${card.name} (converted)`, [{ type: 'attack', mod: 0 }]);
  state.attack.converted = true;
  state.attack.cardId = card.id;
}

// ---- Attacks -------------------------------------------------------------

function newAttack(attackerId, source, actions) {
  return { attackerId, source, actions, step: 0, targets: {}, accuracy: null, retaliation: false, converted: false, parts: [] };
}

// Every part of a card (each action from the current step on) is shown on one
// screen with its own selections: att.parts[i] = { targets, accuracy }.
// Follow-ups created by results (HP drain, critical abilities) are inserted
// as empty slots and shown on the next screen.
function partData(att, i) {
  att.parts = att.parts || [];
  if (!att.parts[i]) {
    att.parts[i] = i === att.step ? { targets: att.targets, accuracy: att.accuracy } : { targets: {}, accuracy: null };
  }
  return att.parts[i];
}

// Run fn as if part i were the current step (for previews and checks).
function withPart(att, i, fn) {
  const saved = { step: att.step, targets: att.targets, accuracy: att.accuracy };
  const d = partData(att, i);
  att.step = i;
  att.targets = d.targets;
  att.accuracy = d.accuracy;
  try { return fn(); } finally { Object.assign(att, saved); }
}

// The parts shown on the current screen: from the current step to the end.
function shownParts(att) {
  const parts = [];
  for (let i = att.step; i < att.actions.length; i++) parts.push(i);
  return parts;
}

const partIsEmpty = (att, i) => {
  const d = partData(att, i);
  const blindMiss = att.actions[i].type === 'attack' && d.accuracy === false;
  return !Object.keys(d.targets).length && !blindMiss;
};

// Ready when every part is either left empty (skipped) or fully filled in.
function allPartsReady(att) {
  return shownParts(att).every((i) => partIsEmpty(att, i) || withPart(att, i, () => attackReady(att)));
}

// Apply every part on screen in order; empty parts are skipped. Stops early
// if a Fumble ends the Attacks, or when a follow-up needs its own screen.
function applyAll() {
  const att = state.attack;
  const onScreen = new Set(shownParts(att));
  for (const i of onScreen) partData(att, i);
  while (state.attack === att && att.step < att.actions.length && att.parts[att.step]) {
    const d = att.parts[att.step];
    att.targets = d.targets;
    att.accuracy = d.accuracy;
    if (partIsEmpty(att, att.step)) skipAttack();
    else applyAttack();
  }
}

function customAttack(attackerId) {
  const A = charById(attackerId);
  const range = A.kind === 'monster' && monsterStats(A.c).range > 1 ? monsterStats(A.c).range : 0;
  return newAttack(attackerId, 'Attack', [{ type: 'attack', mod: 0, range, pierce: 0, inflict: [], targets: 1, custom: true }]);
}

// The critical abilities a figure can choose from (rulebook p.20): an
// adversary's own, or a character's class ability plus any from equipped gear.
function critOptions(F) {
  if (F.kind === 'monster') return [{ label: monsterStats(F.c).critical, source: F.c.name, effects: monsterStats(F.c).crit || [] }];
  const cls = PCLASSES[F.c.classId];
  const options = [{ label: cls.critical, source: cls.name, effects: cls.criticalEffects || [] }];
  for (const slot of GEAR_SLOTS) {
    const item = GEAR_ITEMS[F.c.gear[slot.id]];
    if (item && item.criticalEffects) options.push({ label: item.critical, source: item.name, effects: item.criticalEffects });
  }
  return options;
}

// Effects of the chosen critical ability (the first one by default).
function critEffects(F, choice = 0) {
  const options = critOptions(F);
  return (options[choice] || options[0]).effects;
}

function currentAction(att) {
  return att.actions[att.step];
}

// An Attack's range: an explicit range, or the figure's base range with any
// Range +/- modifier (never below 1). 0 = unknown (class weapon not entered).
function actionRange(A, a) {
  if (a.range) return a.range;
  const base = baseRange(A);
  return base ? Math.max(1, base + (a.rangeMod || 0)) : 0;
}

// Base range: an adversary's Description card, or a character's class weapon.
function baseRange(A) {
  if (!A) return 0;
  if (A.kind === 'monster') return monsterStats(A.c).range;
  const weapon = PCLASSES[A.c.classId].weapon;
  return weapon ? weapon.range : 0;
}

function targetDefaults(action, A = null) {
  if (action.type === 'inflictCheck') return { reached: null };
  if (action.type === 'trample' || action.type === 'auraAllies') return {};
  if (action.type === 'support') return {};
  return { roll: '', ranged: actionRange(A, action) > 1 || !!action.rangeMod && action.rangeMod > 0, reached: true, convert: false, bonus: false, stunInstead: false, critChoice: 0 };
}

// Why this figure can't make this Attack, or null.
function attackBlocker(kind, c, att = null) {
  if (isDown(c)) return 'is defeated';
  if (has(c, 'knocked')) return 'is Knocked Down and cannot Attack until spending 1 MP to stand';
  if (has(c, 'stunned')) {
    return kind === 'monster'
      ? 'is Stunned and cannot act until the end of its next full turn'
      : 'is Stunned and cannot act until discarding a selected card or resting';
  }
  if (att && currentAction(att).type !== 'attack') return null; // not an Attack
  if (att && !att.retaliation) {
    if (c.fumbled) return 'rolled a Fumble and cannot Attack again this turn';
    if (c.convertedAttack && !att.converted) return 'converted a card to an Attack, so no other card Attacks are allowed this turn';
  }
  return null;
}

// Invisible figures can only be affected by themselves.
function canTarget(attacker, target) {
  return target.id === attacker.id || !has(target, 'invisible');
}

function describeAction(a, A = null) {
  if (a.type === 'support') return describeSupport(a);
  if (a.type === 'auraAllies') return `${a.name}: pick the allies adjacent now — ${describeRound({ aura: a.round.aura })} for the rest of the round`;
  if (a.type === 'trample') {
    return `Pick every enemy Moved through: each takes ${a.damage} damage${(a.inflict || []).map((sid) => ` and ${STATUS[sid].name}`).join('')}`;
  }
  if (a.type === 'inflictCheck') {
    return `Roll the Accuracy die: on a Success or Block, inflict ${STATUS[a.status].name} on ${a.target === 'primary' ? 'the primary target (an enemy in range and line of sight)' : 'one adjacent enemy'}`;
  }
  const bits = [`Attack ${signed(a.mod || 0)}`];
  const range = actionRange(A, a);
  if (range) bits.push(`Range ${range}${a.rangeMod ? ` (${signed(a.rangeMod)})` : ''}`);
  else if (a.rangeMod) bits.push(`Range ${signed(a.rangeMod)} on base range`);
  if (a.noAccuracy) bits.push('no Accuracy rolls');
  if (a.critOnSuccess) bits.push('critical ability on any success');
  if (a.stunInstead) bits.push('may Stun instead of damage');
  if (a.pierce) bits.push(`Pierce ${a.pierce}`);
  if ((a.targets || 1) > 1) bits.push(`Target ${a.targets}`);
  for (const sid of a.inflict || []) bits.push(`Inflict ${STATUS[sid].name}`);
  if (a.bonus) bits.push(`${signed(a.bonus.mod)} instead if: ${a.bonus.label}`);
  if (a.doubleIfInvisible) bits.push('Damage ×2 while Invisible');
  return bits.join(' · ');
}

// Outcome against one target, with the working shown.
function resolveTarget(att, targetId) {
  const action = currentAction(att);
  const A = charById(att.attackerId);
  const T = charById(targetId);
  const t = att.targets[targetId];
  if (action.type === 'support') return { ready: true, text: previewSupport(action, T) };
  if (action.type === 'auraAllies') {
    const A2 = charById(att.attackerId);
    return { ready: true, text: action.round.aura.kind === 'share'
      ? `Uses the higher of its Guard or ${A2.c.name}'s Guard (${guardAgainst('monster', A2.c).value}) this round`
      : `Guard +${action.round.aura.value} this round` };
  }
  if (action.type === 'trample') {
    return { ready: true, text: `${action.damage} damage (not an Attack, so no Guard)${(action.inflict || []).map((sid) => `, ${STATUS[sid].name}`).join('')}` };
  }
  if (action.type === 'inflictCheck') {
    if (t.reached === null) return { ready: false, text: 'Enter the Accuracy die result' };
    return t.reached
      ? { ready: true, text: `Success or Block → inflict ${STATUS[action.status].name}` }
      : { ready: true, miss: true, text: 'Miss → no effect' };
  }
  const crit = t.roll === 'crit';
  const fumble = t.roll === 'fumble';
  if (!crit && !fumble && (t.roll === '' || Number.isNaN(Number(t.roll)))) {
    return { ready: false, text: 'Enter the Attack die result' };
  }
  if (fumble && !(A.kind === 'player' && t.convert)) {
    return { ready: true, miss: true, fumble: true, damage: 0, text: 'Fumble — the Attack misses, and no further Attacks this turn' };
  }
  if (t.ranged && !crit && !t.reached && !action.noAccuracy) {
    return { ready: true, miss: true, damage: 0, text: 'Missed on the Accuracy die' };
  }

  const roll = crit ? 3 : fumble ? 0 : Number(t.roll);
  const mod = t.bonus && action.bonus ? action.bonus.mod : action.mod || 0;
  const flat = attackBonus(A.kind, A.c);
  const weak = has(A.c, 'weakened') ? 2 : 0;
  const value = roll + mod + flat - weak;
  const pierce = (action.pierce || 0) + (A.c.pierce || 0);
  const guard = guardAgainst(T.kind, T.c, { ranged: t.ranged, pierce, crit });
  const double = action.doubleIfInvisible && has(A.c, 'invisible');
  const baseDamage = Math.max(0, value - guard.value) * (double ? 2 : 1);
  let damage = baseDamage;
  const success = value > guard.value;
  const extras = [];
  // A critical ability fires on a Critical Strike, or on any success for cards like Headshot.
  const critAbility = crit || (action.critOnSuccess && success);
  if (critAbility && A.kind === 'player' && critEffects(A, t.critChoice || 0).some((e) => e.type === 'doubleDamage')) {
    damage *= 2;
    extras.push(`×2 Critical${crit ? '' : ` (${action.critOnSuccess ? 'card ability' : ''})`}`);
  }
  const stunned = action.stunInstead && t.stunInstead && success;
  if (stunned) { damage = 0; extras.push('Stunned instead of damage'); }
  if (crit && A.kind === 'monster') {
    for (const e of critEffects(A)) {
      if (e.type === 'blitz' && t.blitz) { damage += e.damage; extras.push(`+${e.damage} Blitz`); }
      if (e.type === 'weakenOrDamage' && has(T.c, 'weakened')) { damage += e.damage; extras.push(`+${e.damage} (already Weakened)`); }
    }
  }

  const atk = [crit ? 'Critical Strike (3)' : fumble ? 'Fumble converted (0)' : `Roll ${roll}`];
  if (mod) atk.push(signed(mod));
  if (flat) atk.push(`${signed(flat)} Attack`);
  if (weak) atk.push('−2 Weakened');
  const guardText = guard.parts.length > 1 ? `${guard.parts.join(' ')} = ${guard.value}` : guard.parts[0];
  let text = `${atk.join(' ')} = ${value} vs ${guardText} → ${baseDamage} damage`;
  if (double) text += ' (×2 Invisible)';
  if (extras.length) text += ` ${extras.join(' ')} = ${damage}`;
  if (!success) text += ' — fails, so no conditions';
  else if (damage > 0 && hasBrickWall(T.c)) text += ' — Brick Wall makes it 0';
  else if (damage > 0 && has(T.c, 'barrier')) text += ' — Barrier absorbs it';
  return { ready: true, crit, critAbility, stunned, fumble, damage, success, text };
}

function attackReady(att) {
  const A = charById(att.attackerId);
  if (!A || attackBlocker(A.kind, A.c, att)) return false;
  if (currentAction(att).type !== 'attack') {
    const ids = Object.keys(att.targets);
    return ids.length > 0 && ids.every((id) => resolveTarget(att, id).ready);
  }
  if (has(A.c, 'blinded') && att.accuracy === null) return false;
  if (has(A.c, 'blinded') && att.accuracy === false) return true; // a miss needs no targets
  const ids = Object.keys(att.targets);
  return ids.length > 0 && ids.every((id) => resolveTarget(att, id).ready);
}

function applyAttack() {
  const att = state.attack;
  const action = currentAction(att);
  const A = charById(att.attackerId);
  if (action.type === 'support') {
    for (const id of Object.keys(att.targets)) log(applySupport(action, charById(id)));
    advanceAttack();
    return;
  }
  if (action.type === 'auraAllies') {
    const ids = Object.keys(att.targets);
    state.auraLinks = { ...(state.auraLinks || {}), [A.c.id]: ids };
    log(ids.length
      ? `${A.c.name}'s ${action.name} protects ${ids.map((id) => charById(id).c.name).join(', ')} this round`
      : `${A.c.name}'s ${action.name}: no adjacent allies`);
    advanceAttack();
    return;
  }
  if (action.type === 'trample') {
    for (const id of Object.keys(att.targets)) {
      const T = charById(id);
      log(takeDamage(T.c, action.damage, `${A.c.name}'s ${att.source}`));
      if (!isDown(T.c)) for (const sid of action.inflict || []) log(addStatus(T.c, sid));
    }
    advanceAttack();
    return;
  }
  if (action.type === 'inflictCheck') {
    for (const id of Object.keys(att.targets)) {
      const T = charById(id);
      const r = resolveTarget(att, id);
      log(`${A.c.name}'s ${att.source} → ${T.c.name}: ${r.text}`);
      if (!r.miss) log(addStatus(T.c, action.status));
    }
    advanceAttack();
    return;
  }
  const label = `${A.c.name}'s ${att.source}${att.actions.length > 1 ? ` (Attack ${att.step + 1})` : ''}`;
  const critTargets = []; // kinds of the targets hit by Critical Strikes
  const followUps = []; // support actions this Attack triggers

  if (has(A.c, 'blinded') && att.accuracy === false) {
    log(`${label} fails: Blinded, and the Accuracy die was not a Success`);
  } else {
    for (const id of Object.keys(att.targets)) {
      const T = charById(id);
      const t = att.targets[id];
      if (A.c.fumbled) {
        log(`${label} → ${T.c.name}: skipped (Fumble ended this turn's Attacks)`);
        continue;
      }
      const r = resolveTarget(att, id);
      log(`${label} → ${T.c.name}: ${r.text}`);
      if (r.fumble && r.miss) {
        A.c.fumbled = true;
      } else if (r.fumble) {
        if (!has(A.c, 'knocked')) A.c.statuses.push('knocked');
        log(`${A.c.name} converts the Fumble by becoming Knocked Down`);
      }
      if (!r.miss) {
        const before = T.c.hp;
        log(takeDamage(T.c, r.damage, A.c.name));
        const lost = before - T.c.hp;
        if (r.success && !isDown(T.c)) for (const sid of action.inflict || []) log(addStatus(T.c, sid));
        if (r.stunned && !isDown(T.c)) log(addStatus(T.c, 'stunned'));
        if (r.critAbility) critTargets.push({ T, lost, choice: t.critChoice || 0 });
        if (action.drain && T.kind === 'monster' && lost > 0 && A.kind === 'player') {
          followUps.push({ type: 'support', effect: 'restore', value: lost, who: 'one' });
        }
      }
      // Vengeful: any completed Melee Attack, hit or miss.
      if (!t.ranged && !att.retaliation && has(T.c, 'vengeful') && !attackBlocker(T.kind, T.c)) {
        state.retaliations.push({ by: T.c.id, against: A.c.id });
      }
    }
  }

  A.c.pierce = 0; // Pierce from a card applies to one Attack only
  if (!att.retaliation && !att.converted) A.c.attackedThisTurn = true;
  if (has(A.c, 'invisible')) {
    removeStatus(A.c, 'invisible');
    log(`${A.c.name} is no longer Invisible (Attacked)`);
  }
  // Critical abilities resolve after the Attack (so Rogue's Invisible sticks).
  for (const hit of critTargets) followUps.push(...applyCritical(A, hit.T, hit.lost, hit.choice));
  // Effects the Attack triggered (drain, critical abilities) come next, on
  // a screen of their own.
  att.actions.splice(att.step + 1, 0, ...followUps);
  if (att.parts) att.parts.splice(att.step + 1, 0, ...followUps.map(() => null));
  if (att.retaliation) {
    removeStatus(A.c, 'vengeful');
    log(`${A.c.name}'s Vengeful is used up`);
  }
  advanceAttack();
}

// Apply a critical ability after the Attack (rulebook p.20). Immediate
// effects happen now; ones that need a character chosen are returned to be
// queued as follow-up actions.
function applyCritical(A, T, lost, choice = 0) {
  if (A.kind === 'monster') {
    const st = monsterStats(A.c);
    log(`Critical Strike! ${A.c.name}: ${st.critical}`);
    for (const e of st.crit || []) {
      if (e.type === 'inflict' && !isDown(T.c)) log(addStatus(T.c, e.status));
      if (e.type === 'gain') log(addStatus(A.c, e.status));
      if (e.type === 'selfInflict') log(addStatus(A.c, e.status));
      if (e.type === 'healSelf') log(heal('monster', A.c, e.value));
      if (e.type === 'cleanse') {
        const bad = A.c.statuses.filter((sid) => STATUS[sid].type === 'detrimental');
        bad.forEach((sid) => removeStatus(A.c, sid));
        if (bad.length) log(`${A.c.name} removes ${bad.map((sid) => STATUS[sid].name).join(', ')}`);
      }
      if (e.type === 'drainHalf' && lost > 0) {
        const gained = Math.min(Math.ceil(lost / 2), monsterMaxHp(A.c) - A.c.hp);
        A.c.hp += gained;
        log(`${A.c.name} restores ${gained} HP (${A.c.hp} HP)`);
      }
      if (e.type === 'weakenOrDamage' && !isDown(T.c) && !has(T.c, 'weakened')) log(addStatus(T.c, 'weakened'));
    }
    if (st.manual) log(`Do the rest of ${A.c.name}'s critical on the board`);
    return [];
  }
  const option = critOptions(A)[choice] || critOptions(A)[0];
  const effects = option.effects.filter((e) => !e.vsAdversary || T.kind === 'monster');
  if (!effects.length) {
    log(`Critical Strike! Apply ${A.c.name}'s critical ability if it applies`);
    return [];
  }
  const queued = [];
  for (const effect of effects) {
    if (effect.type === 'doubleDamage') log(`Critical ability (${option.source}): ${A.c.name} dealt double damage`);
    if (effect.type === 'inflict' && !isDown(T.c)) log(`Critical ability (${option.source}): ${addStatus(T.c, effect.status)}`);
    if (effect.type === 'extraDamage' && !isDown(T.c)) log(`Critical ability (${option.source}): ${takeDamage(T.c, effect.value, option.source)}`);
    if (effect.type === 'gain') log(`Critical Strike! ${addStatus(A.c, effect.status)}`);
    if (effect.type === 'support') {
      log(`Critical Strike! ${describeSupport(effect)}`);
      queued.push(effect);
    }
  }
  return queued;
}

function skipAttack() {
  const att = state.attack;
  log(`${charById(att.attackerId).c.name} skips ${att.source}${att.actions.length > 1 ? ` (Attack ${att.step + 1})` : ''}`);
  advanceAttack();
}

// Use an equipped item (rulebook p.46). Once-per-mission items are flipped
// over until the next mission.
function useItem(kind, c, item) {
  if (itemBlocker(c, item)) return;
  if (item.oncePerMission) c.itemsUsed.push(item.id);
  log(`${c.name} uses ${item.name}`);
  state.attack = newAttack(c.id, item.name, [item.use]);
  state.attack.text = item.text;
  state.attack.itemId = item.id;
}

// Why an item can't be used right now, or null.
function itemBlocker(c, item) {
  if (item.oncePerMission && c.itemsUsed.includes(item.id)) return 'already used this mission';
  if (has(c, 'stunned') || has(c, 'knocked')) return 'cannot use items while Stunned or Knocked Down';
  return null;
}

// Cancel the panel. If nothing has been applied yet, the card goes back to
// the figure's hand for this turn so it can be played again.
function cancelAttack() {
  const att = state.attack;
  const A = att && charById(att.attackerId);
  // Attacks saved before cardId existed: find the card by its name.
  const cardId = att && (att.cardId || (A && (roundCards(A.kind, A.c).find((cd) => cd.name === att.source) || {}).id));
  if (A && att.itemId && att.step === 0) {
    A.c.itemsUsed = A.c.itemsUsed.filter((id) => id !== att.itemId);
    log(`${A.c.name} puts away ${att.source}`);
  } else if (A && cardId && att.step === 0 && !att.retaliation) {
    A.c.used = A.c.used.filter((id) => id !== cardId);
    if (att.converted) A.c.convertedAttack = false;
    log(`${A.c.name} takes back ${att.source}`);
  }
  state.attack = null;
  state.retaliations = [];
}

function advanceAttack() {
  const att = state.attack;
  att.step += 1;
  att.targets = {};
  att.accuracy = null;
  const A = charById(att.attackerId);
  if (att.step >= att.actions.length || (A && A.c.fumbled && !att.retaliation)) {
    state.attack = null;
    nextRetaliation();
  }
}

// Vengeful: queue an Attack −1 back at the attacker.
function nextRetaliation() {
  while (state.retaliations.length) {
    const r = state.retaliations.shift();
    const by = charById(r.by);
    const vs = charById(r.against);
    if (!by || !vs || isDown(by.c) || !has(by.c, 'vengeful')) continue;
    if (isDown(vs.c)) {
      log(`${vs.c.name} was defeated before ${by.c.name} could retaliate (Vengeful kept)`);
      continue;
    }
    state.attack = newAttack(by.c.id, 'Vengeful retaliation', [{ type: 'attack', mod: -1 }]);
    state.attack.retaliation = true;
    state.attack.targets[vs.c.id] = targetDefaults(currentAction(state.attack), by);
    log(`${by.c.name} is Vengeful and retaliates against ${vs.c.name}`);
    return;
  }
}
