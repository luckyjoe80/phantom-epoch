// Phantom Epoch — solo helper: running a mission.
// Campaigns, their characters and the screens around a mission live in
// campaign.js; `state` here is the campaign's active mission.
// Each round runs through three phases, one screen each (rulebook p.12):
//   1. Party:      tab through the players; each picks cards (total AP <= species AP) or rests.
//   2. Monsters:   each adversary type draws one species card and one class card.
//   3. Initiative: everyone acts in order of total AP, lowest first. The acting
//                  figure plays or converts its cards; attacks are resolved
//                  against targets using the rules in combat.js.
// Ending the round discards played cards, returns a resting player's discard
// pile to their hand, and starts the next round back at the Party phase.

const PHASES = ['players', 'monsters', 'initiative'];

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const PSPECIES = byId(PLAYER_SPECIES);
const PCLASSES = byId(PLAYER_CLASSES);
const MSPECIES = byId(MONSTER_SPECIES);
const MCLASSES = byId(MONSTER_CLASSES);
const ADV = byId(ADVERSARY_TYPES);
const STATUS = byId(STATUSES);
const GEAR_ITEMS = byId(Object.values(GEAR).flat());

let state = null; // the active mission (set by campaign.js)
let boardTab = 'round'; // Initiative board tab: 'round' (cards) or 'stats'
// While an attack/action is being resolved, the Initiative screen shows either
// its panel or the board. A new attack always opens on the panel.
let mainTab = 'attack';
let lastAttack = null;
const uiOpen = new Set(); // <details data-ui="..."> currently expanded

// Attributes for a <details> whose open state survives redraws.
const openAttr = (key) => `data-ui="${key}" ${uiOpen.has(key) ? 'open' : ''}`;

// ---- State ---------------------------------------------------------------

// A fresh mission for the campaign's characters.
function newMissionState(characters, name) {
  return {
    name,
    round: 1,
    phase: 'players',
    activePlayer: 0, // tab index in the Party phase
    players: characters.map(makePlayer),
    monsters: [],
    monsterDecks: {}, // key 'species:<id>' or 'class:<id>' -> { draw: [cardId], discard: [cardId] }
    typeDraws: {}, // adversary type 'species|class' -> { species: cardId, class: cardId } this round
    order: [], // initiative order (character ids), fixed when the Initiative phase starts
    turn: 0, // index into order
    viewing: null, // character shown in the Initiative board; null = whoever's turn it is
    started: {}, // ids whose start-of-turn effects ran this round
    ended: {}, // ids whose end-of-turn effects ran this round
    attack: null, // attack being resolved (see combat.js)
    retaliations: [], // pending Vengeful counter-attacks
    auraLinks: {}, // adversary id -> allies it protects this round (picked when its card was played)
    eventDeck: buildEventDeck(), // event ids, top of the deck last
    eventDiscard: [],
    event: null, // this round's Event card id
    eventRolls: {}, // character ids that already rolled for this round's event
    eventDeckEmpty: false, // no event could be drawn: the mission is lost
    log: [],
    nextMonsterId: 1,
  };
}

// ---- Event deck ------------------------------------------------------------

const EVENTS = Object.fromEntries([...EVENTS_EARLY, ...EVENTS_LATE].map((e) => [e.id, e]));

// 5 random Round 1–5 events on top of the shuffled Round 6+ events.
function buildEventDeck() {
  const early = shuffle(EVENTS_EARLY.map((e) => e.id)).slice(0, EARLY_EVENTS_IN_DECK);
  return [...shuffle(EVENTS_LATE.map((e) => e.id)), ...early];
}

// This round's event's effect ({} if none).
function eventEffect() {
  return (EVENTS[state.event] || {}).effect || {};
}

// Max AP for the round: the species' AP, changed by the event.
function maxAp(p) {
  const fx = eventEffect();
  return PSPECIES[p.speciesId].ap + (fx.type === 'maxAp' ? fx.value : 0);
}

const isLateEvent = (id) => EVENTS_LATE.some((e) => e.id === id);

// Draw the round's event. If the deck is empty, the mission is lost.
function drawEvent() {
  if (state.event) state.eventDiscard.push(state.event);
  state.eventRolls = {};
  state.event = state.eventDeck.pop() || null;
  state.eventDeckEmpty = !state.event;
  log(state.event ? `Event: ${EVENTS[state.event].name}` : 'The Event deck is empty — the mission is lost');
}

// Round-end effects of the event, before the next one is drawn.
function endRoundEvent() {
  const fx = eventEffect();
  if (fx.type === 'evac') {
    const down = state.players.filter((p) => p.hp <= 0);
    if (down.length) log(`Emergency Evac: ${down.map((p) => p.name).join(', ')} defeated — the mission is lost unless all objectives are complete`);
  }
  if (fx.reshuffle && state.players.some((p) => p.hp > 0 && p.bandages < BANDAGE_SLOTS)) {
    // This and every other drawn Round 6+ event go back on top, shuffled.
    const name = EVENTS[state.event].name;
    const back = [state.event, ...state.eventDiscard.filter(isLateEvent)];
    state.eventDiscard = state.eventDiscard.filter((id) => !isLateEvent(id));
    state.eventDeck.push(...shuffle(back));
    state.event = null;
    log(`${name}: a surviving character has an empty bandage slot — ${back.length} Round 6+ event${back.length === 1 ? '' : 's'} shuffled back onto the Event deck`);
  }
}

// Live notes and controls for the event's effect.
function eventHelpHtml(fx) {
  if (fx.type === 'mission') return '<p class="event-help">Perform this mission\'s mission event from the Mission book.</p>';
  if (fx.type === 'restDamage') {
    const resting = state.players.filter((p) => p.resting);
    return `<p class="event-help">Applied automatically on each rest turn${resting.length ? ` — resting: ${resting.map((p) => esc(p.name)).join(', ')}` : ''}.</p>`;
  }
  if (fx.type === 'maxAp') return '<p class="event-help">Applied to every character\'s AP this round.</p>';
  if (fx.type === 'restDiscard') {
    const resting = state.players.filter((p) => p.resting);
    return `<p class="event-help">Applied automatically when the round ends, after resting characters recover their cards${resting.length ? ` — resting: ${resting.map((p) => esc(p.name)).join(', ')}` : ''}.</p>`;
  }
  if (fx.type === 'evac') {
    const down = state.players.filter((p) => p.hp <= 0);
    return `<p class="event-help ${down.length ? 'warn' : ''}">${down.length ? `${down.map((p) => esc(p.name)).join(', ')} defeated — unless all objectives are complete, the mission is lost when the round ends.` : 'No character is defeated.'}</p>`;
  }
  if (fx.type === 'tooQuiet') {
    return state.monsters.some((m) => m.hp > 0)
      ? '<p class="event-help">Enemies are present, so nothing happens.</p>'
      : '<p class="event-help warn">No enemies are present: every character rolls the Blitz die. Place an event adversary next to each who rolls a Fumble (+ Adversary).</p>';
  }
  if (fx.type === 'bandageRoll') {
    const rollers = state.players.filter((p) => p.hp > 0 && p.bandages < BANDAGE_SLOTS);
    if (!rollers.length) return `<p class="event-help">No character has an empty bandage slot${fx.reshuffle ? ' — the event will not reshuffle' : ''}.</p>`;
    const die = ATTACK_DICE.find((d) => d.id === fx.die);
    return `<div class="event-help">Roll the ${die.name} for each character with an empty bandage slot:
      <div class="event-rolls">${rollers.map((p) => state.eventRolls[p.id]
        ? `<span class="tag">${esc(p.name)}: rolled</span>`
        : `<span class="event-roll">${figureName('player', p)}
            <button class="small" data-action="event-roll" data-id="${p.id}" data-value="fumble">Fumble: +1 bandage</button>
            <button class="small ghost" data-action="event-roll" data-id="${p.id}" data-value="other">Other result</button></span>`).join('')}</div>
      ${fx.reshuffle ? '<p class="tag">If a surviving character still has an empty bandage slot when the round ends, this and every drawn Round 6+ event are shuffled back onto the Event deck.</p>' : ''}</div>`;
  }
  return '';
}

// What the event does when the round ends, as notes for the End Round dialog
// ([] if it does nothing then).
function roundEndNotes() {
  const fx = eventEffect();
  const names = (list) => list.map((p) => esc(p.name)).join(', ');
  if (fx.type === 'evac') {
    const down = state.players.filter((p) => p.hp <= 0);
    return [down.length
      ? `<b>${names(down)} ${down.length === 1 ? 'is' : 'are'} defeated.</b> Unless all mission objectives are complete, the mission is lost.`
      : 'No character is defeated, so the mission goes on.'];
  }
  if (fx.type === 'restDiscard') {
    const resting = state.players.filter((p) => p.resting);
    return [resting.length
      ? `${names(resting)} recover${resting.length === 1 ? 's' : ''} their discarded cards, then the app randomly discards one card${resting.length === 1 ? '' : ' each'}. Check the log and discard those cards at the table.`
      : 'No character rested this round, so nothing happens.'];
  }
  if (fx.reshuffle) {
    const open = state.players.filter((p) => p.hp > 0 && p.bandages < BANDAGE_SLOTS);
    const unrolled = open.filter((p) => !state.eventRolls[p.id]);
    const back = 1 + state.eventDiscard.filter(isLateEvent).length;
    return [
      ...(unrolled.length ? [`<b>Not rolled yet:</b> ${names(unrolled)}. Record their rolls on the event first.`] : []),
      open.length
        ? `${names(open)} still ${open.length === 1 ? 'has' : 'have'} an empty bandage slot, so this and the other drawn Round 6+ events (${back} in all) are shuffled back onto the Event deck. Do the same with the cards at the table.`
        : 'No surviving character has an empty bandage slot, so nothing is reshuffled.',
    ];
  }
  return [];
}

// End the round, first showing the event's round-end effects if it has any.
function requestEndRound() {
  const notes = roundEndNotes();
  if (!notes.length) {
    endRound();
    return;
  }
  const dialog = document.getElementById('round-end-dialog');
  dialog.innerHTML = `<h2 id="round-end-title">End of round ${state.round}: ${esc(EVENTS[state.event].name)}</h2>
    <p class="event-text">${esc(EVENTS[state.event].text)}</p>
    <ul class="round-end-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
    <div class="dialog-actions">
      <button class="ghost" data-action="round-end-cancel">Back to the round</button>
      <button class="primary" data-action="round-end-confirm">Apply and start round ${state.round + 1} →</button>
    </div>`;
  dialog.showModal();
}

function eventBannerHtml() {
  if (state.eventDeckEmpty) {
    return `<section class="event-banner lost" aria-label="This round's event">
      <b class="event-name">The Event deck is empty</b>
      <p class="event-text">No Event card could be drawn at the start of the round, so the mission is lost.</p>
    </section>`;
  }
  const e = EVENTS[state.event];
  if (!e) return '';
  return `<section class="event-banner" aria-label="This round's event">
    <span class="section-label">Round ${state.round} event · ${isLateEvent(e.id) ? 'Round 6+' : 'Round 1–5'}</span>
    <b class="event-name">${esc(e.name)}</b>
    <p class="event-text">${esc(e.text)}</p>
    ${eventHelpHtml(e.effect || {})}
    <span class="tag">${state.eventDeck.length} left in the Event deck</span>
  </section>`;
}

// Combat fields every figure carries.
function combatFields() {
  return { statuses: [], hold: {}, used: [], effects: [], pierce: 0, fumbled: false, attackedThisTurn: false, convertedAttack: false, mp: false };
}

// A character as they start a mission: full HP, all 10 cards in hand.
function makePlayer(ch) {
  return {
    id: ch.id,
    name: ch.name,
    speciesId: ch.speciesId,
    classId: ch.classId,
    hp: PSPECIES[ch.speciesId].hp,
    hand: PCLASSES[ch.classId].deck.map((c) => c.id),
    discard: [],
    selected: [],
    resting: false,
    restedLast: false, // characters may not rest two rounds in a row
    bandages: 0,
    itemsUsed: [], // once-per-mission items already used
    gear: { ...emptyGear(), ...ch.gear },
    ...combatFields(),
  };
}

// An adversary placed on the map, from its type's Description card at the
// given level. Adversaries placed after the round's cards were drawn don't
// act until `joinsRound` (rulebook p.26).
function makeMonster(typeId, level, joinsRound, color = null) {
  const type = ADV[typeId];
  const n = state.nextMonsterId++;
  const num = nextGroupNumber(typeId);
  const m = {
    id: `m${n}`,
    name: `${type.name} ${num}`,
    num, // number within its group
    typeId,
    level,
    speciesId: type.speciesId,
    classId: type.classId,
    color: groupColor(typeId) ?? color ?? freeGroupColor(),
    hp: type.levels[level].hp,
    joinsRound,
    ...combatFields(),
  };
  return m;
}

function emptyGear() {
  return Object.fromEntries(GEAR_SLOTS.map((s) => [s.id, null]));
}

// Fill in fields added since a mission was saved.
function normalizeMission(m) {
  const mission = { ...newMissionState([], m.name || 'Mission'), ...m };
  // Adversaries from before Description cards were entered can't be kept.
  const valid = (x) => ADV[x.typeId] && ADV[x.typeId].levels[x.level];
  const dropped = mission.monsters.filter((x) => !valid(x));
  if (dropped.length) {
    mission.monsters = mission.monsters.filter(valid);
    mission.order = mission.order.filter((id) => !dropped.some((x) => x.id === id));
    mission.typeDraws = Object.fromEntries(Object.entries(mission.typeDraws)
      .filter(([key]) => { const [sp, cl] = key.split('|'); return MSPECIES[sp] && MCLASSES[cl]; }));
    mission.monsterDecks = Object.fromEntries(Object.entries(mission.monsterDecks)
      .filter(([key]) => { const [kind, id] = key.split(':'); return (kind === 'species' ? MSPECIES : MCLASSES)[id]; }));
    mission.log.unshift({ round: mission.round, msg: `Removed ${dropped.length} placeholder adversar${dropped.length === 1 ? 'y' : 'ies'} — place real ones with + Adversary` });
  }
  // Adversaries already defeated in older saves count as removed (no dialog).
  for (const m of mission.monsters) if (m.hp <= 0 && m.removed === undefined) m.removed = true;
  // Adversaries saved before groups: number them within their group and give
  // every member the group's colour (the first member's).
  for (const m of mission.monsters) {
    if (m.num) continue;
    const group = mission.monsters.filter((x) => x.typeId === m.typeId);
    group.forEach((x, k) => {
      x.num = k + 1;
      x.color = group[0].color;
      x.name = `${ADV[x.typeId].name} ${x.num}`;
    });
  }
  // Missions from before events, or whose events were placeholders since
  // replaced, get a fresh Event deck and draw this round's event.
  if ((!mission.event && !mission.eventDeckEmpty) || ![mission.event, ...mission.eventDeck, ...mission.eventDiscard].filter(Boolean).every((id) => EVENTS[id])) {
    mission.eventDeck = buildEventDeck();
    mission.eventDiscard = [];
    mission.event = mission.eventDeck.pop();
    mission.eventDeckEmpty = false;
  }
  // Drawn cards or deck piles that refer to cards no longer in the data
  // (e.g. placeholders replaced by real cards) are dropped.
  const cardExists = (kind, id, cardId) => {
    const def = (kind === 'species' ? MSPECIES : MCLASSES)[id];
    return def && def.deck.some((c) => c.id === cardId);
  };
  let staleDraws = 0;
  for (const [key, d] of Object.entries(mission.typeDraws)) {
    const [sp, cl] = key.split('|');
    if (!cardExists('species', sp, d.species) || !cardExists('class', cl, d.class)) {
      delete mission.typeDraws[key];
      staleDraws += 1;
    }
  }
  for (const [key, pile] of Object.entries(mission.monsterDecks)) {
    const [kind, id] = key.split(':');
    if (![...pile.draw, ...pile.discard].every((cardId) => cardExists(kind, id, cardId))) delete mission.monsterDecks[key];
  }
  if (staleDraws) mission.log.unshift({ round: mission.round, msg: 'Some adversary cards were updated; their cards for this round were cleared' });

  for (const c of [...mission.players, ...mission.monsters]) {
    Object.assign(c, { ...combatFields(), ...c });
    c.statuses = c.statuses.filter((sid) => STATUS[sid]); // drop retired statuses
  }
  for (const p of mission.players) {
    p.bandages = p.bandages || 0;
    p.itemsUsed = p.itemsUsed || [];
    p.gear = Object.fromEntries(GEAR_SLOTS.map((g) => [g.id, (p.gear || {})[g.id] || null]));
  }
  return mission;
}

function commit() {
  const defeated = state ? removeDefeated() : [];
  saveRoot();
  render();
  if (defeated.length) showDefeatDialog(defeated);
}

// Adversaries defeated since the last save leave the initiative list at once
// (rulebook p.27). One defeated on its own turn stays listed until the turn
// moves on, so the turn marker isn't disturbed. Returns the newly defeated.
function removeDefeated() {
  // HP set back above 0 by hand: it can be defeated (and removed) again.
  state.monsters.filter((m) => m.removed && m.hp > 0).forEach((m) => { m.removed = false; });
  const gone = state.monsters.filter((m) => m.hp <= 0 && !m.removed);
  for (const m of gone) {
    m.removed = true;
    if (state.viewing === m.id) state.viewing = null;
    log(`${m.name} is defeated and removed from the board`);
  }
  pruneOrder();
  return gone;
}

// Take removed adversaries out of the initiative list, except one whose turn it is.
function pruneOrder() {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const m = state.monsters.find((x) => x.id === state.order[i]);
    if (!m || !m.removed || (state.phase === 'initiative' && i === state.turn)) continue;
    state.order.splice(i, 1);
    if (i < state.turn) state.turn -= 1;
  }
}

function showDefeatDialog(defeated) {
  const dialog = document.getElementById('defeat-dialog');
  const items = defeated.map((m) => {
    const col = ADVERSARY_COLORS[m.color].name;
    const lastOfType = !state.monsters.some((x) => x.typeId === m.typeId && x.hp > 0);
    const novas = m.level;
    return `<li>
      <b>Remove ${figureName('monster', m)} (${esc(col)}) from the board.</b>
      <ul>
        <li>Place ${novas} nova cell${novas === 1 ? '' : 's'} in its space — none if it was placed by an Event card or mission event.</li>
        ${lastOfType ? `<li>It was the last ${esc(ADV[m.typeId].name)}: discard its Adversary Action cards.</li>` : ''}
      </ul>
    </li>`;
  }).join('');
  // A second kill while the dialog is open adds to the same list.
  const list = dialog.open && dialog.querySelector('.defeat-list');
  if (list) {
    list.insertAdjacentHTML('beforeend', items);
    return;
  }
  dialog.innerHTML = `<h2 id="defeat-title">Adversar${defeated.length === 1 ? 'y' : 'ies'} defeated</h2>
    <ul class="defeat-list">${items}</ul>
    <div class="dialog-actions"><button class="primary" data-action="defeat-done">Done</button></div>`;
  dialog.showModal();
}

// ---- Lookups -------------------------------------------------------------

function playerCard(player, cardId) {
  return PCLASSES[player.classId].deck.find((c) => c.id === cardId);
}

function selectedAp(player) {
  return player.selected.reduce((sum, id) => sum + cardCost(player, playerCard(player, id)), 0);
}

function isReady(player) {
  return player.hp <= 0 || player.resting || player.selected.length > 0;
}

// Why a player can't rest this round, or null (rulebook p.13).
function restBlocker(p) {
  if (p.restedLast) return 'Rested last round';
  if (!p.discard.length) return 'No discarded cards';
  return null;
}

// The adversary's Description card stats at its level.
function monsterStats(m) {
  return ADV[m.typeId].levels[m.level];
}

function monsterMaxHp(m) {
  return monsterStats(m).hp;
}

function deckDef(key) {
  const [kind, id] = key.split(':');
  return kind === 'species' ? MSPECIES[id] : MCLASSES[id];
}

function monsterCard(key, cardId) {
  return deckDef(key).deck.find((c) => c.id === cardId);
}

const typeKey = (m) => `${m.speciesId}|${m.classId}`;

// The species card and this monster's colour line of the class card, both
// shared by every adversary of its type this round.
// This monster's line (by HP-base colour) of its type's drawn Class card.
function classLine(m) {
  const card = monsterCard(`class:${m.classId}`, state.typeDraws[typeKey(m)].class);
  const col = ADVERSARY_COLORS[m.color].id;
  const row = card.lines.findIndex((l) => l.color === col);
  return { ...card.lines[row], id: card.id, row };
}

// Placed this round after the cards were drawn: no cards and no turn yet.
const waiting = (m) => (m.joinsRound || 0) > state.round;

function monsterCards(m) {
  if (waiting(m)) return [];
  const draws = state.typeDraws[typeKey(m)];
  if (!draws) return [];
  return [monsterCard(`species:${m.speciesId}`, draws.species), classLine(m)];
}

function monsterAp(m) {
  const cards = monsterCards(m);
  return cards.length ? cards.reduce((sum, c) => sum + cardCost(m, c), 0) : null;
}

// The cards a figure has for this round.
function roundCards(kind, c) {
  if (kind === 'player') return c.resting ? [] : c.selected.map((id) => playerCard(c, id));
  return monsterCards(c);
}

function findChar(kind, id) {
  return (kind === 'monster' ? state.monsters : state.players).find((x) => x.id === id);
}

function charById(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) return { kind: 'player', c: p };
  const m = state.monsters.find((x) => x.id === id);
  return m ? { kind: 'monster', c: m } : null;
}

function maxHp(kind, c) {
  return kind === 'monster' ? monsterMaxHp(c) : PSPECIES[c.speciesId].hp;
}

function subtitle(kind, c) {
  return kind === 'player'
    ? `${PSPECIES[c.speciesId].name} · ${PCLASSES[c.classId].name}`
    : `${ADV[c.typeId].name} · Level ${c.level} · ${ADVERSARY_COLORS[c.color].name}`;
}

// ---- Monster decks -------------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getDeck(key) {
  if (!state.monsterDecks[key]) {
    state.monsterDecks[key] = { draw: shuffle(deckDef(key).deck.map((c) => c.id)), discard: [] };
  }
  return state.monsterDecks[key];
}

function drawFrom(key) {
  const deck = getDeck(key);
  if (deck.draw.length === 0) {
    deck.draw = shuffle(deck.discard);
    deck.discard = [];
  }
  return deck.draw.pop();
}

// One species card and one class card per adversary type per round.
function drawForType(speciesId, classId) {
  const key = `${speciesId}|${classId}`;
  if (state.typeDraws[key]) return;
  state.typeDraws[key] = { species: drawFrom(`species:${speciesId}`), class: drawFrom(`class:${classId}`) };
}

// ---- Adversary groups ----------------------------------------------------
// All adversaries of one type form a group: one colour, numbered 1, 2, 3…

// The colour an existing group already uses, or null.
function groupColor(typeId) {
  const member = state.monsters.find((m) => m.typeId === typeId);
  return member ? member.color : null;
}

// The next member number in a group (numbers aren't reused within a mission).
function nextGroupNumber(typeId) {
  return Math.max(0, ...state.monsters.filter((m) => m.typeId === typeId).map((m) => m.num || 0)) + 1;
}

// A colour no group on the map uses yet (or the first, if all four are taken).
function freeGroupColor(taken = state.monsters.map((m) => m.color)) {
  const i = ADVERSARY_COLORS.findIndex((_, ci) => !taken.includes(ci));
  return i < 0 ? 0 : i;
}

// ---- Phase flow ----------------------------------------------------------

function goToMonsters() {
  const unready = state.players.filter((p) => !isReady(p));
  if (unready.length && !confirm(`${unready.map((p) => p.name).join(', ')} has no cards selected. Lock in anyway?`)) return;
  for (const m of state.monsters) {
    if (m.hp > 0 && !waiting(m)) drawForType(m.speciesId, m.classId);
  }
  applyImmunity();
  state.phase = 'monsters';
  commit();
  window.scrollTo(0, 0);
}

function backToPlayers() {
  // Undo the draws: put cards back on top of their draw piles.
  for (const [key, d] of Object.entries(state.typeDraws)) {
    const [speciesId, classId] = key.split('|');
    getDeck(`class:${classId}`).draw.push(d.class);
    getDeck(`species:${speciesId}`).draw.push(d.species);
  }
  state.typeDraws = {};
  state.phase = 'players';
  commit();
}

function goToInitiative() {
  state.order = initiativeOrder();
  state.turn = 0;
  state.viewing = null;
  state.started = {};
  state.ended = {};
  state.attack = null;
  state.retaliations = [];
  state.phase = 'initiative';
  log(`— Round ${state.round} begins —`);
  startTurn(0);
  commit();
  window.scrollTo(0, 0);
}

function backToMonsters() {
  state.attack = null;
  state.phase = 'monsters';
  commit();
}

// Move the turn marker. Going forward ends the old turn and starts the new
// one; going back only moves the marker (effects never run twice).
function setTurn(idx) {
  if (idx > state.turn) {
    for (let i = state.turn; i < idx; i++) endTurn(i);
    startTurn(idx);
  }
  state.turn = idx;
  state.viewing = null;
  state.attack = null;
  state.retaliations = [];
}

function endRound() {
  if (state.phase === 'initiative') endTurn(state.turn);
  for (const p of state.players) {
    if (p.resting) {
      p.hand.push(...p.discard);
      p.discard = [];
      if (eventEffect().type === 'restDiscard' && p.hand.length) {
        const [lost] = p.hand.splice(Math.floor(Math.random() * p.hand.length), 1);
        p.discard.push(lost);
        log(`${EVENTS[state.event].name}: ${p.name} randomly discards ${playerCard(p, lost).name}`);
      }
    } else {
      p.hand = p.hand.filter((id) => !p.selected.includes(id));
      p.discard.push(...p.selected.filter((id) => !p.effects.some((e) => e.cardId === id)));
    }
    p.restedLast = p.resting;
    p.resting = false;
    p.selected = [];
    p.used = [];
  }
  for (const [key, d] of Object.entries(state.typeDraws)) {
    const [speciesId, classId] = key.split('|');
    getDeck(`species:${speciesId}`).discard.push(d.species);
    getDeck(`class:${classId}`).discard.push(d.class);
  }
  state.typeDraws = {};
  for (const m of state.monsters) m.used = [];
  endRoundEvent();
  state.round += 1;
  drawEvent();
  state.phase = 'players';
  state.activePlayer = 0;
  state.order = [];
  state.turn = 0;
  state.attack = null;
  state.retaliations = [];
  state.auraLinks = {};
  commit();
  window.scrollTo(0, 0);
}

// Lowest total AP acts first; a resting character's initiative is 1.
// Ties: characters before adversaries, then table order (adversaries of one
// type follow their colour order). Returns character ids.
function initiativeOrder() {
  const entries = [];
  state.players.forEach((p, i) => {
    if (p.hp > 0) entries.push({ id: p.id, player: true, i, ap: p.resting ? 1 : selectedAp(p) });
  });
  state.monsters.forEach((m, i) => {
    if (m.hp > 0 && !waiting(m)) {
      // Ties: by the colour's line on the class card, then by number in the group.
      const row = monsterCards(m).length ? classLine(m).row : m.color;
      entries.push({ id: m.id, player: false, i: row * 1000 + (m.num || i), ap: monsterAp(m) ?? Infinity });
    }
  });
  entries.sort((a, b) => a.ap - b.ap || (a.player === b.player ? a.i - b.i : a.player ? -1 : 1));
  return entries.map((e) => e.id);
}

// ---- Rendering helpers ---------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHtml(card, { attrs = '', cls = '', label = '', cost = card.ap } = {}) {
  return `<button class="card ${cls}" ${attrs}>
    <span class="cost ${cost !== card.ap ? 'raised' : ''}" ${cost !== card.ap ? 'title="Doubled by Frozen"' : ''}>${cost}</span>
    ${label ? `<span class="card-label">${esc(label)}</span>` : ''}
    <span class="card-name">${esc(card.name)}</span>
    <span class="card-text">${esc(card.text)}</span>
  </button>`;
}

function colorDot(m) {
  const col = ADVERSARY_COLORS[m.color];
  return `<span class="color-dot" style="background:${col.css}" title="${esc(col.name)} HP base"></span>`;
}

// A figure's number and colour: players are orange 1–4, adversaries are
// numbered within their group in the group's colour.
// A die's distinct results: numbers low to high, then Critical Strike and Fumble.
function dieResults(die) {
  const unique = [...new Set(die.faces)];
  return [...unique.filter((r) => !isNaN(r)).sort((a, b) => a - b), ...['crit', 'fumble'].filter((r) => unique.includes(r))];
}

function figureNumber(kind, c) {
  return kind === 'player' ? state.players.findIndex((p) => p.id === c.id) + 1 : c.num;
}

function figureToken(kind, c) {
  const css = kind === 'player' ? PLAYER_COLOR : ADVERSARY_COLORS[c.color].css;
  const title = kind === 'player' ? 'Character' : `${ADVERSARY_COLORS[c.color].name} group`;
  return `<span class="fig-token" style="--tok:${css}" title="${esc(title)}">${figureNumber(kind, c)}</span>`;
}

// Name followed by its numbered token, e.g. "Rogue ①" or "Grallok Archer ②".
function figureName(kind, c) {
  const base = kind === 'player' ? c.name : ADV[c.typeId].name;
  return `<span class="fig-name">${esc(base)} ${figureToken(kind, c)}</span>`;
}

function hpControls(kind, id, hp, max) {
  return `<span class="hp">
    <button class="small" data-action="hp" data-kind="${kind}" data-id="${id}" data-delta="-1" aria-label="Lose 1 HP">−</button>
    <span class="val ${hp <= max / 4 ? 'low' : ''}">${hp} / ${max}</span>
    <button class="small" data-action="hp" data-kind="${kind}" data-id="${id}" data-delta="1" aria-label="Gain 1 HP">+</button>
  </span>`;
}

// Which allies an adversary chose to protect when it played its card.
function protectingHtml(m) {
  const ids = (state.auraLinks || {})[m.id];
  if (!ids) return '';
  const names = ids.map((id) => charById(id)).filter(Boolean).map((e) => e.c.name);
  return `<div class="muted">${names.length ? `Protecting: ${esc(names.join(', '))}` : 'No adjacent allies when played'}</div>`;
}

// A figure's stats as a plain two-column table: HP, Guard, Attack/Range,
// abilities, round effects, Bandages and a Heal control.
// An adversary's stats for its Monsters-screen row: HP, Guard, Attack and
// Range across one line, then Critical and any round effects.
function monsterStatsHtml(m) {
  const st = monsterStats(m);
  const g = guardAgainst('monster', m);
  const active = roundEffects(m).length > 0;
  const notes = [`<tr><th scope="row">Critical</th><td>${esc(st.critical)}${st.manual ? '<div class="muted">Movement part is up to you on the board.</div>' : ''}</td></tr>`]
    .concat(monsterCards(m).filter((cd) => cd.round).map((cd) => `<tr><th scope="row">Round</th><td><b>${esc(cd.name)}</b> — ${esc(describeRound(cd.round))}${active ? '' : '<div class="muted">Inactive while Knocked Down or Stunned.</div>'}${protectingHtml(m)}</td></tr>`));
  return `<table class="stat-grid">
      <thead><tr><th>HP</th><th>Guard</th><th>Attack</th><th>Range</th></tr></thead>
      <tbody><tr>
        <td>${hpControls('monster', m.id, m.hp, monsterMaxHp(m))}</td>
        <td><b>${g.value}</b>${g.parts.length > 1 ? `<div class="muted">${esc(g.parts.slice(1).join(' '))}</div>` : ''}</td>
        <td><b>${signed(st.attack)}</b></td>
        <td><b>${st.range}</b></td>
      </tr></tbody>
    </table>
    <table class="stat-table">${notes.join('')}</table>`;
}

// readOnly: plain values with no controls (the card selection screen).
function statTableHtml(kind, c, { heal = true, readOnly = false, hp = true } = {}) {
  const rows = [];
  const row = (label, value) => rows.push(`<tr><th scope="row">${label}</th><td>${value}</td></tr>`);
  const muted = (t) => `<div class="muted">${esc(t)}</div>`;

  if (hp) row('HP', readOnly ? `${c.hp} / ${maxHp(kind, c)}` : hpControls(kind, c.id, c.hp, maxHp(kind, c)));
  const g = guardAgainst(kind, c);
  const vsRanged = kind === 'player' ? PSPECIES[c.speciesId].guardVsRanged || 0 : 0;
  row('Guard', `${g.value}${vsRanged ? ` <span class="muted">(${g.value + vsRanged} vs ranged)</span>` : ''}${g.parts.length > 1 ? muted(g.parts.join(' ')) : ''}`);

  if (kind === 'monster') {
    const st = monsterStats(c);
    row('Attack', signed(st.attack));
    row('Range', st.range);
    row('Critical', `${esc(st.critical)}${st.manual ? muted('Movement part is up to you on the board.') : ''}`);
    const active = roundEffects(c).length > 0;
    for (const card of monsterCards(c).filter((cd) => cd.round)) {
      row('Round', `<b>${esc(card.name)}</b> — ${esc(describeRound(card.round))}${active ? '' : muted('Inactive while Knocked Down or Stunned.')}${protectingHtml(c)}`);
    }
    const covers = protectorsOf({ kind, c });
    if (covers.length) row('Protected', covers.map((S) => `${esc(S.name)} (${esc(aurasFor(S, { kind, c }).map((r) => r.name).join(', '))})`).join('<br>'));
  } else {
    const species = PSPECIES[c.speciesId];
    const cls = PCLASSES[c.classId];
    if (cls.weapon) row('Weapon', `${esc(cls.weapon.name)} · Range ${cls.weapon.range}`);
    if (species.ability) row('Ability', esc(species.ability));
    if (cls.critical) row('Critical', esc(cls.critical));
    const tokens = Array.from({ length: BANDAGE_SLOTS }, (_, i) => `<span class="bandage ${i < c.bandages ? 'on' : ''}"></span>`).join('');
    row('Bandages', readOnly ? `<span class="bandages">${tokens}</span>` : `<span class="bandages" title="A Bandage is gained each time a Heal restores HP; no Heals once full">
      ${tokens}
      <button class="small ghost" data-action="bandage" data-id="${c.id}" data-delta="-1" aria-label="Remove a Bandage" ${c.bandages ? '' : 'disabled'}>−</button>
      <button class="small ghost" data-action="bandage" data-id="${c.id}" data-delta="1" aria-label="Add a Bandage" ${c.bandages < BANDAGE_SLOTS ? '' : 'disabled'}>+</button>
    </span>`);
  }
  if (heal && !readOnly) {
    row('Heal', `<span class="heal">
      <input type="number" min="1" value="2" class="heal-input" data-heal-for="${c.id}" aria-label="Heal amount">
      <button class="small" data-action="heal" data-kind="${kind}" data-id="${c.id}">Heal</button>
    </span>`);
  }
  return `<table class="stat-table">${rows.join('')}</table>`;
}

// Status checkboxes, beneficial and detrimental side by side. Ticking a box
// sets the condition directly; rules like Resilient only apply to attacks.
function statusesHtml(kind, c, { readOnly = false } = {}) {
  const group = (type, title) => `<div class="status-group ${type}">
    <span class="status-group-name">${title}</span>
    ${STATUSES.filter((s) => s.type === type).map((s) => `<label class="status-check ${has(c, s.id) ? 'on' : ''} ${readOnly ? 'readonly' : ''}" title="${esc(s.text)}">
      <input type="checkbox" ${readOnly ? 'disabled' : `data-action="status" data-kind="${kind}" data-id="${c.id}" data-status="${s.id}"`} ${has(c, s.id) ? 'checked' : ''}>
      ${esc(s.name)}
    </label>`).join('')}
  </div>`;
  const active = STATUSES.filter((s) => has(c, s.id));
  const help = `<details class="status-help" ${openAttr(`help-${c.id}`)}>
      <summary>${active.length ? `Rules for ${active.map((s) => esc(s.name)).join(', ')}` : 'Condition rules'}</summary>
      <dl>${(active.length ? active : STATUSES).map((s) => `<dt>${esc(s.name)}</dt><dd>${esc(s.text)}</dd>`).join('')}</dl>
    </details>`;
  return `<div class="statuses">${group('beneficial', 'Beneficial')}${group('detrimental', 'Detrimental')}${help}</div>`;
}

// Short read-only status tags (for compact lists).
function statusTagsHtml(c) {
  return c.statuses.map((sid) => `<span class="status-tag ${STATUS[sid].type}" title="${esc(STATUS[sid].text)}">${esc(STATUS[sid].name)}</span>`).join('');
}

// Items that can go in a slot; class starting attachments only for that class.
function gearOptions(slot, p) {
  return GEAR[slot.type].filter((g) => (slot.type !== 'equipment' || g.slot === slot.id)
    && (!g.classId || g.classId === p.classId));
}

// Editable gear slots, grouped (Equipment, Attachments, Items).
function gearHtml(p, action = 'gear') {
  const groups = [...new Set(GEAR_SLOTS.map((s) => s.group))];
  const filled = GEAR_SLOTS.filter((s) => p.gear[s.id]).length;
  return `<section class="gear" aria-label="Gear">
    <span class="section-label">Gear (${filled} / ${GEAR_SLOTS.length})</span>
    <div class="gear-groups">${groups.map((group) => `<div class="gear-group">
      <span class="gear-group-name">${esc(group)}</span>
      ${GEAR_SLOTS.filter((s) => s.group === group).map((slot) => {
        const current = p.gear[slot.id];
        const opts = gearOptions(slot, p).map((g) =>
          `<option value="${g.id}" ${g.id === current ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
        if (!action) {
          return `<div class="gear-slot readonly ${current ? 'filled' : ''}">
            <span>${esc(slot.label)}</span>
            <span class="gear-value">${current ? esc(GEAR_ITEMS[current].name) : '—'}</span>
          </div>`;
        }
        return `<label class="gear-slot ${current ? 'filled' : ''}" title="${current ? esc(GEAR_ITEMS[current].text) : ''}">
          <span>${esc(slot.label)}</span>
          <select data-action="${action}" data-id="${p.id}" data-slot="${slot.id}">
            <option value="">— Empty —</option>${opts}
          </select>
        </label>`;
      }).join('')}
    </div>`).join('')}</div>
  </section>`;
}

// Equipped items with a use, and their Use buttons (on the figure's turn,
// including rest turns).
function itemsHtml(p, acting) {
  const items = GEAR_SLOTS.map((s) => GEAR_ITEMS[p.gear[s.id]]).filter((g) => g && g.use);
  if (!items.length) return '';
  return `<div class="board-section">
    <span class="section-label">Items</span>
    <table class="stat-table">${items.map((g) => {
      const blocked = itemBlocker(p, g);
      const usable = acting && !blocked && !state.attack && !isDown(p);
      return `<tr><th scope="row">${esc(g.name)}</th><td>
        <div>${esc(g.text)}</div>
        ${blocked ? `<div class="muted">${esc(blocked[0].toUpperCase() + blocked.slice(1))}.</div>` : ''}
        ${usable ? `<button class="small" data-action="use-item" data-char="${p.id}" data-item="${g.id}">Use ${esc(g.name)}</button>` : ''}
      </td></tr>`;
    }).join('')}</table>
  </div>`;
}

// Played temporary/persistent cards whose effects are still active.
function inPlayHtml(c, { readOnly = false } = {}) {
  if (!c.effects.length) return '';
  return `<div class="in-play">
    <span class="section-label">In play</span>
    ${c.effects.map((e, i) => `<span class="effect-chip ${e.kind}">
      <b>${esc(e.name)}</b>
      ${e.text ? `<span class="effect-text">${esc(e.text)}</span>` : ''}
      <small>${e.kind === 'temporary' ? 'until the start of their next turn' : 'persistent'}${e.guard ? ` · Guard +${e.guard}` : ''}${e.brickWall ? ' · damage 0, no new detrimental conditions' : ''}</small>
      ${e.kind === 'persistent' && !readOnly ? `<button class="small ghost" data-action="end-effect" data-id="${c.id}" data-index="${i}">Discard</button>` : ''}
    </span>`).join('')}
  </div>`;
}

// ---- Phase 1: Party ------------------------------------------------------

function renderPlayersPhase() {
  const active = state.players[state.activePlayer];
  const tabs = state.players.map((p, i) => {
    const species = PSPECIES[p.speciesId];
    const status = p.hp <= 0 ? 'Down' : p.resting ? 'Resting' : `${selectedAp(p)} / ${maxAp(p)} AP`;
    const sub = `${esc(PCLASSES[p.classId].name)} · ${status}`;
    return `<button role="tab" class="tab ${i === state.activePlayer ? 'active' : ''} ${isReady(p) ? 'ready' : ''}"
        aria-selected="${i === state.activePlayer}" data-action="tab" data-index="${i}">
      <span class="tab-name">${figureName('player', p)}</span>
      <span class="tab-sub">${sub}</span>
    </button>`;
  }).join('');

  const p = active;
  const species = PSPECIES[p.speciesId];
  const spent = selectedAp(p);
  const max = maxAp(p);
  const left = max - spent;
  const hand = p.hand.map((cid) => {
    const card = playerCard(p, cid);
    const cost = cardCost(p, card);
    const isSel = p.selected.includes(cid);
    const disabled = p.resting || p.hp <= 0 || (!isSel && cost > left);
    return cardHtml(card, {
      attrs: `data-action="toggle-card" data-id="${p.id}" data-card="${cid}" ${disabled ? 'disabled' : ''} aria-pressed="${isSel}"`,
      cls: isSel ? 'selected' : '',
      cost,
    });
  }).join('') || '<p class="empty">Hand empty — rest to recover your cards.</p>';

  const discard = p.discard.map((cid) => cardHtml(playerCard(p, cid), { attrs: 'disabled', cls: 'mini' })).join('');
  const noRest = restBlocker(p);

  return `<nav class="tabs" role="tablist" aria-label="Players">${tabs}</nav>
  <section class="player-sheet ${p.hp <= 0 ? 'down' : ''}">
    <div class="sheet-head">
      <div class="sheet-title">
        <h2>${esc(p.name)}</h2>
        <span class="tag">${esc(subtitle('player', p))}</span>
      </div>
    </div>
    <div class="sheet-body">
    <div class="sheet-main">
    <div class="ap-row">
      <div class="ap-meter">
        <span class="ap-big">${p.resting ? 'Resting <small>(initiative 1)</small>' : `${spent} <small>/ ${max} AP${max !== species.ap ? ` (${esc(EVENTS[state.event].name)})` : ''}</small>`}</span>
        <div class="bar"><div class="fill" style="width:${p.resting ? 0 : Math.min(100, (spent / max) * 100)}%"></div></div>
      </div>
      <button class="rest-btn ${p.resting ? 'active' : ''}" data-action="rest" data-id="${p.id}"
        ${p.hp <= 0 || (noRest && !p.resting) ? 'disabled' : ''} aria-pressed="${p.resting}"
        title="${esc(noRest || '')}">${p.resting ? 'Cancel Rest' : 'Rest'}</button>
    </div>
    ${p.resting ? `<p class="resting-note">Resting this round — initiative 1. Detrimental conditions are removed at the start of the turn, and ${p.discard.length} card(s) return to hand.</p>` : ''}
    ${!p.resting && noRest && p.hp > 0 ? `<p class="tag">Can't rest: ${esc(noRest.toLowerCase())}.</p>` : ''}
    ${has(p, 'frozen') ? '<p class="warn">Frozen: every card costs double AP this round.</p>' : ''}
    ${p.selected.length > 1 && p.selected.some((id) => playerCard(p, id).onlyCard)
      ? `<p class="warn">${esc(p.selected.map((id) => playerCard(p, id)).filter((cd) => cd.onlyCard).map((cd) => cd.name).join(', '))} must be the only card selected, or it can only be discarded or converted to a Move or Attack.</p>` : ''}

    <div class="hand big">${hand}</div>
    ${gearHtml(p, '')}

    <details class="discard" ${openAttr(`discard-${p.id}`)}>
      <summary>Discard pile (${p.discard.length})</summary>
      <div class="hand">${discard || '<span class="empty">Empty</span>'}</div>
    </details>
    </div>
    <aside class="sheet-side">
      ${statTableHtml('player', p, { readOnly: true })}
      ${inPlayHtml(p, { readOnly: true })}
      ${statusesHtml('player', p, { readOnly: true })}
    </aside>
    </div>
  </section>`;
}

// ---- Phase 2: Monsters ---------------------------------------------------

function monsterCardLabels(m) {
  return [MSPECIES[m.speciesId].name, `${MCLASSES[m.classId].name} — ${ADVERSARY_COLORS[m.color].name}`];
}

function renderMonstersPhase() {
  const rows = state.monsters.map((m) => {
    const labels = monsterCardLabels(m);
    const cards = m.hp <= 0
      ? '<p class="empty">Defeated</p>'
      : waiting(m)
        ? '<p class="empty">Placed this round — joins next round (rulebook p.26).</p>'
        : monsterCards(m).map((c, i) => cardHtml(c, { attrs: 'disabled', label: labels[i], cost: cardCost(m, c) })).join('');
    const ap = monsterAp(m);
    return `<article class="monster-row ${m.hp <= 0 ? 'down' : ''}">
      <header class="mrow-head">
        <h3 class="monster-name">${figureName('monster', m)}</h3>
        <span class="tag">${esc(subtitle('monster', m))}</span>
        ${ap !== null && m.hp > 0 ? `<span class="mrow-ap"><b>${ap}</b> AP</span>` : ''}
        <span class="spacer"></span>
        <button class="small ghost danger" data-action="rm-monster" data-id="${m.id}">Remove</button>
      </header>
      <div class="mrow-body">
        <div class="mrow-stats">${monsterStatsHtml(m)}</div>
        <div class="monster-cards">${cards}</div>
      </div>
      <details class="monster-statuses" ${openAttr(`cond-${m.id}`)}>
        <summary><span class="section-label">Conditions</span> ${statusTagsHtml(m) || '<span class="tag">none</span>'}</summary>
        ${statusesHtml('monster', m)}
      </details>
    </article>`;
  }).join('') || '<p class="empty">No adversaries on the map.</p>';

  return `<section class="phase-head"><h2>Monsters</h2><p>Each adversary type shares one species card and one class card; each adversary uses its HP-base colour's line of the class card.</p></section>
  <div class="monster-list">${rows}</div>
  <button class="add-adv-btn" data-action="toggle-add">+ Place another adversary</button>`;
}

// ---- Phase 3: Initiative -------------------------------------------------

function charAp(kind, c) {
  if (kind === 'player') return c.resting ? 1 : selectedAp(c);
  return monsterAp(c) ?? '?';
}

// This round's cards for a figure. The acting figure can play each card, or
// convert it to Move (MP = AP) or — characters only — an Attack +0.
function roundCardsHtml(kind, c, acting) {
  if (kind === 'player' && c.resting) return '<p class="resting-note">Resting this round.</p>';
  const cards = roundCards(kind, c);
  if (!cards.length) return `<p class="empty">${kind === 'player' ? 'No cards selected.' : 'No cards drawn.'}</p>`;
  const stunnedPlayer = kind === 'player' && has(c, 'stunned');
  const labels = kind === 'monster' ? monsterCardLabels(c) : [];
  return cards.map((card, j) => {
    const used = c.used.includes(card.id);
    const canUse = acting && !used && !state.attack && !isDown(c);
    let buttons = '';
    if (used) {
      buttons = '<span class="used-tag">Played</span>';
    } else if (canUse && stunnedPlayer) {
      buttons = `<button class="use-btn" data-action="use-card" data-char="${c.id}" data-card="${card.id}">Discard to clear Stunned</button>`;
    } else if (canUse) {
      const noPlay = playBlocker(kind, c, card);
      const noMove = conversionBlocker(c, 'move', card);
      const noAtk = conversionBlocker(c, 'attack');
      // Its Attack can't be made, but the rest of the card can be played.
      const skipAttack = !noPlay && hasCardAttack(card) && cardAttackBlocker(c);
      buttons = `<button class="primary use-btn" data-action="use-card" data-char="${c.id}" data-card="${card.id}" ${noPlay ? `disabled title="${esc(noPlay)}"` : ''}>${skipAttack ? 'Play without Attack' : 'Play'}</button>
        ${noPlay ? `<span class="tag play-note">Can't play: ${esc(noPlay)}.</span>` : ''}
        ${skipAttack ? `<span class="tag play-note">Its Attack is skipped: ${esc(skipAttack)}.</span>` : ''}
        <div class="convert-row">
          <button class="small" data-action="convert" data-to="move" data-char="${c.id}" data-card="${card.id}" ${noMove ? `disabled title="${esc(noMove)}"` : ''}>→ Move ${convertMp(kind, c, card)}</button>
          ${kind === 'player' ? `<button class="small" data-action="convert" data-to="attack" data-char="${c.id}" data-card="${card.id}" ${noAtk ? `disabled title="${esc(noAtk)}"` : ''}>→ Attack +0</button>` : ''}
        </div>`;
    }
    return `<div class="card-slot ${used ? 'used' : ''}">
      ${cardHtml(card, { attrs: 'disabled', cost: cardCost(c, card), label: labels[j] || '' })}
      ${buttons}
    </div>`;
  }).join('');
}

// Rule reminders for conditions and flags that affect what a figure can do.
function warningsHtml(kind, c) {
  const w = [];
  if (has(c, 'stunned')) {
    w.push(kind === 'player'
      ? 'Stunned — cannot act until discarding a selected card or resting.'
      : 'Stunned — cannot act until the end of its next full turn.');
  }
  if (has(c, 'blinded')) w.push('Blinded — roll the Accuracy die before each Attack; only a Success proceeds.');
  if (has(c, 'weakened')) w.push('Weakened — −2 to all Attacks.');
  if (c.pierce) w.push(`Next Attack gains Pierce ${c.pierce}.`);
  if (c.fumbled) w.push('Fumbled — no further Attacks this turn.');
  if (c.convertedAttack) w.push('Converted a card to an Attack — no other card Attacks this turn.');
  let html = w.map((t) => `<p class="warn">${esc(t)}</p>`).join('');
  if (has(c, 'knocked')) {
    html += `<p class="warn">Knocked Down — cannot Attack or take non-Move/Leap actions until spending 1 MP.
      ${c.mp ? `<button class="small" data-action="stand" data-kind="${kind}" data-id="${c.id}">Stand up (spend 1 MP)</button>`
        : '<span class="muted">Play a card with Move or Leap, or convert a card to movement, to get the MP to stand.</span>'}</p>`;
  }
  return html;
}

// A short heading for one part of a card.
function partLabel(action, A) {
  switch (action.type) {
    case 'auraAllies': return `Round effect — allies adjacent to ${A.c.name}`;
    case 'support': return describeSupport(action);
    case 'inflictCheck': return `Accuracy check — inflict ${STATUS[action.status].name}`;
    case 'trample': return 'Enemies Moved through';
    default: return `Attack ${signed(action.mod || 0)} on ${action.targets > 1 ? `up to ${action.targets} enemies` : 'an enemy'}`;
  }
}

// One part of the card: its heading and the choices it needs.
function partSectionHtml(att, A, index, number, total) {
  const action = currentAction(att);
  const step = index;
  const support = action.type === 'support';
  const auraStep = action.type === 'auraAllies';
  // A figure whose Attack has Range 1 can only make Melee Attacks: no line of
  // sight, Accuracy die or Block to worry about. (0 = range unknown.)
  const meleeOnly = action.type === 'attack' && actionRange(A, action) === 1;
  const limit = support ? (action.who === 'all' ? 99 : 1) : action.type === 'trample' || auraStep ? 99 : action.targets || 1;
  const chosen = Object.keys(att.targets);
  const blocker = attackBlocker(A.kind, A.c, att);
  const blinded = action.type === 'attack' && has(A.c, 'blinded');
  const missed = blinded && att.accuracy === false;
  const data = `data-step="${step}"`;

  const custom = action.custom ? `<div class="atk-fields">
      <label>Modifier <input type="number" ${data} data-action="atk-field" data-field="mod" value="${action.mod}"></label>
      <label>Range <input type="number" min="0" ${data} data-action="atk-field" data-field="range" value="${action.range}"></label>
      <label>Pierce <input type="number" min="0" ${data} data-action="atk-field" data-field="pierce" value="${action.pierce}"></label>
      <label>Targets <input type="number" min="1" ${data} data-action="atk-field" data-field="targets" value="${action.targets}"></label>
      <label>Inflict <select ${data} data-action="atk-field" data-field="inflict">
        <option value="">None</option>
        ${STATUSES.filter((st) => st.type === 'detrimental').map((st) => `<option value="${st.id}" ${action.inflict[0] === st.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}
      </select></label>
    </div>` : '';

  const accuracy = blinded ? `<div class="atk-accuracy">
      <span>${esc(A.c.name)} is Blinded — roll the Accuracy die first:</span>
      <button class="small ${att.accuracy === true ? 'active' : ''}" ${data} data-action="atk-accuracy" data-value="hit">Success</button>
      <button class="small ${att.accuracy === false ? 'active' : ''}" ${data} data-action="atk-accuracy" data-value="miss">Miss / Block</button>
    </div>` : '';

  const seg = (action2, id, value, label, on) =>
    `<button class="small seg ${on ? 'active' : ''}" ${data} data-action="${action2}" data-char="${id}" data-value="${value}">${label}</button>`;
  const preview = (c) => `<span class="atk-preview" data-preview="${step}:${c.id}">${esc(resolveTarget(att, c.id).text)}</span>`;

  const targetRow = ({ kind, c }) => {
    const selected = !!att.targets[c.id];
    const hidden = !canTarget(A.c, c);
    const full = !selected && chosen.length >= limit;
    const t = att.targets[c.id];
    let inputs = '';
    if (selected && (support || auraStep || action.type === 'trample')) {
      inputs = `<div class="atk-inputs">${preview(c)}</div>`;
    } else if (selected && action.type === 'inflictCheck') {
      inputs = `<div class="atk-inputs">
        <div class="atk-line">
          <span class="atk-label">Accuracy die</span>
          ${seg('atk-reach', c.id, 'yes', 'Success or Block', t.reached === true)}
          ${seg('atk-reach', c.id, 'no', 'Miss', t.reached === false)}
        </div>
        ${preview(c)}
      </div>`;
    } else if (selected && !missed) {
      inputs = `<div class="atk-inputs">
        ${ATTACK_DICE.filter((die) => A.kind === 'player' || die.id === 'basic').map((die) => `<div class="atk-line">
          <span class="atk-label">${A.kind === 'player' ? die.name : 'Attack die'}</span>
          ${dieResults(die).map((r) => seg('atk-die', c.id, `${die.id}:${r}`, DIE_RESULT_LABELS[r], (t.die || 'basic') === die.id && String(t.roll) === r)).join('')}
        </div>`).join('')}
        <div class="atk-line">
          ${t.roll === 'fumble' && A.kind === 'player' && !HOUSE_RULES.fumbleIsZero ? `<label class="atk-bonus"><input type="checkbox" ${data} data-action="atk-convert" data-char="${c.id}" ${t.convert ? 'checked' : ''}> Convert to 0 by becoming Knocked Down</label>` : ''}
          ${(t.roll === 'crit' || action.critOnSuccess) && A.kind === 'player' && critOptions(A).length > 1 ? `<div class="atk-line">
            <span class="atk-label">Critical ability</span>
            ${critOptions(A).map((o, oi) => seg('atk-crit', c.id, oi, `${esc(o.label)} <small>(${esc(o.source)})</small>`, (t.critChoice || 0) === oi)).join('')}
          </div>` : ''}
          ${t.roll === 'crit' && critEffects(A).some((e) => e.type === 'blitz') ? `<label class="atk-bonus"><input type="checkbox" ${data} data-action="atk-blitz" data-char="${c.id}" ${t.blitz ? 'checked' : ''}> Blitz die also rolled a Critical Strike (+${critEffects(A).find((e) => e.type === 'blitz').damage} damage)</label>` : ''}
        </div>
        ${meleeOnly ? '' : `<div class="atk-line">
          <span class="atk-label">Target is</span>
          ${seg('atk-dist', c.id, 'melee', 'Adjacent (melee)', !t.ranged)}
          ${seg('atk-dist', c.id, 'ranged', 'Not adjacent (ranged)', t.ranged)}
          ${t.ranged && t.roll !== 'crit' && !action.noAccuracy ? `<span class="atk-label">Accuracy</span>
            ${seg('atk-reach', c.id, 'yes', 'Reached target', t.reached)}
            ${seg('atk-reach', c.id, 'no', 'Missed', !t.reached)}` : ''}
        </div>`}
        ${action.bonus ? `<label class="atk-bonus"><input type="checkbox" ${data} data-action="atk-bonus" data-char="${c.id}" ${t.bonus ? 'checked' : ''}> ${esc(action.bonus.label)} (${signed(action.bonus.mod)})</label>` : ''}
        ${action.stunInstead ? `<label class="atk-bonus"><input type="checkbox" ${data} data-action="atk-stun" data-char="${c.id}" ${t.stunInstead ? 'checked' : ''}> If it succeeds, inflict Stunned instead of dealing damage</label>` : ''}
        ${preview(c)}
      </div>`;
    }
    return `<div class="atk-target ${kind} ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}">
      <label class="atk-pick">
        <input type="checkbox" ${data} data-action="atk-target" data-char="${c.id}" ${selected ? 'checked' : ''} ${hidden || (full && !selected) || missed ? 'disabled' : ''}>
        <span class="atk-name">${figureName(kind, c)}</span>
        <span class="tag">${support
          ? `${c.id === A.c.id ? 'Self · ' : ''}${c.hp}/${maxHp(kind, c)} HP${kind === 'player' ? ` · Bandages ${c.bandages}/${BANDAGE_SLOTS}` : ''}`
          : `${c.hp} HP · Guard ${guardAgainst(kind, c).value}`}${hidden ? ' · Invisible — cannot be targeted' : ''}</span>
        <span class="atk-tags">${statusTagsHtml(c)}</span>
      </label>
      ${inputs}
    </div>`;
  };

  // Attacks and checks target enemies (rulebook p.21); support targets the
  // user's own side. Allies stay reachable for an Accuracy Block.
  const living = (kind) => (kind === 'player' ? state.players : state.monsters)
    .filter((c) => !isDown(c)).map((c) => ({ kind, c }));
  const enemyKind = A.kind === 'player' ? 'monster' : 'player';
  const sideName = (kind) => (kind === 'player' ? 'Party' : 'Adversaries');
  const list = (title, figures) => `<div class="atk-side"><span class="section-label">${title}</span>${figures.map(targetRow).join('') || '<p class="empty">No one</p>'}</div>`;
  const allies = living(A.kind).filter(({ c }) => c.id !== A.c.id);
  const blockAllies = action.type === 'attack' && !meleeOnly && allies.length ? `<details class="block-allies" ${allies.some(({ c }) => att.targets[c.id]) ? 'open' : ''}>
      <summary>Accuracy Block hit an ally instead</summary>
      ${list(`${sideName(A.kind)} (allies)`, allies)}
    </details>` : '';

  let body;
  if (support) {
    body = `<p class="tag">${action.who === 'all' ? 'Tick yourself and every adjacent ally.' : `Pick ${SUPPORT_WHO[action.who]}.`}</p>
      <div class="atk-sides">${list(`${sideName(A.kind)} (own side)`, living(A.kind))}</div>`;
  } else if (auraStep) {
    body = `<p class="tag">Tick every ally standing next to ${esc(A.c.name)} right now. They get ${esc(describeRound({ aura: action.round.aura }).replace('adjacent ', ''))} for the rest of the round${action.round.aura.notClass ? ` (other ${esc(MCLASSES[action.round.aura.notClass].name)} adversaries don't benefit)` : ''}.</p>
      <div class="atk-sides">${list(`${sideName(A.kind)} (allies)`, living(A.kind).filter(({ c }) => c.id !== A.c.id && aurasFor(A.c, { kind: A.kind, c }).length))}</div>`;
  } else if (action.type === 'trample') {
    body = `<p class="tag">Tick every enemy ${esc(A.c.name)} Moved through.</p>
      <div class="atk-sides">${list(`${sideName(enemyKind)} (enemies)`, living(enemyKind))}</div>`;
  } else if (missed) {
    body = '<p class="warn">The Attack fails — it is used up when you apply.</p>';
  } else {
    body = `<p class="tag">${meleeOnly
      ? `Pick the ${A.kind === 'monster' ? 'primary target' : 'target'}: an adjacent enemy (Range 1, Melee only).`
      : `Pick up to ${limit} target${limit === 1 ? '' : 's'} (each is rolled separately). For a ranged Attack, roll the Accuracy die for each figure or object on the line of sight; on a Block, pick the blocker as the target instead.`}</p>
      <div class="atk-sides">${list(`${sideName(enemyKind)} (enemies)`, living(enemyKind))}</div>
      ${blockAllies}`;
  }

  return `<section class="atk-part">
    <h4 class="part-head">${total > 1 ? `<span class="part-num">Part ${number}</span>` : ''}${esc(partLabel(action, A))}</h4>
    ${auraStep ? '' : `<span class="tag">${esc(describeAction(action, A))}`}${auraStep ? '' : ''}${action.type === 'attack' && A.c.pierce ? ` · +Pierce ${A.c.pierce} from a card` : ''}${action.type === 'attack' && attackBonus(A.kind, A.c) ? ` · ${signed(attackBonus(A.kind, A.c))} Attack attribute` : ''}${auraStep ? '' : '</span>'}
    ${blocker ? `<p class="warn">${esc(A.c.name)} ${esc(blocker)}.</p>` : ''}
    ${custom}
    ${accuracy}
    ${body}
  </section>`;
}

// The action panel: the card's text, then every part of it as its own
// section, applied together with one button.
function attackPanelHtml() {
  const att = state.attack;
  if (!att) return '';
  const A = charById(att.attackerId);
  if (!A) return '';
  const parts = shownParts(att);
  const anyAttack = parts.some((i) => att.actions[i].type === 'attack');
  const sections = parts.map((i, n) => withPart(att, i, () => partSectionHtml(att, A, i, n + 1, parts.length))).join('');
  const followUp = att.step > 0 && !att.retaliation;
  return `<section class="attack-panel" aria-label="Resolve card">
    <div class="atk-head">
      <span class="when">${att.retaliation ? 'Retaliation' : followUp ? 'Follow-up' : parts.length > 1 ? `${parts.length} parts — apply together` : 'Resolve'}</span>
      <h3>${esc(A.c.name)} — ${esc(att.source)}</h3>
      ${att.text ? `<p class="card-quote">${esc(att.text)}</p>` : ''}
      ${att.round && !att.round.aura ? `<p class="round-note"><b>Round effect</b> (${esc(describeRound(att.round))}) is active all round.</p>` : ''}
      ${A.kind === 'monster' && anyAttack ? `<span class="tag">Critical: ${esc(monsterStats(A.c).critical)}</span>` : ''}
    </div>
    ${sections}
    <div class="sheet-foot">
      ${parts.length > 1 ? '<span class="tag foot-hint">Leave a part empty to skip it.</span>' : ''}
      <button class="ghost danger" data-action="atk-cancel">Cancel</button>
      <button class="primary" data-action="atk-apply" ${allPartsReady(att) ? '' : 'disabled'}>${parts.length > 1 ? 'Apply all' : 'Apply'}</button>
    </div>
  </section>`;
}

// The mission log as a right-hand panel: every round, newest first.
function logPanelHtml() {
  const rounds = [...new Set(state.log.map((e) => e.round))].sort((a, b) => b - a);
  const body = rounds.map((r) => `<section class="log-round">
      <span class="section-label">Round ${r}</span>
      <ol>${state.log.filter((e) => e.round === r).map((e) => `<li>${esc(e.msg)}</li>`).join('')}</ol>
    </section>`).join('') || '<p class="empty">Nothing logged yet.</p>';
  return `<aside class="log-panel" aria-label="Mission log">
    <div class="log-head">
      <h2>Log</h2>
      <button class="small ghost" data-action="toggle-log" aria-label="Close log">Close</button>
    </div>
    <div class="log-body">${body}</div>
  </aside>`;
}

// Left: the initiative order. Right: the attack panel (when resolving one)
// and the full board of whoever is being viewed. Viewing someone never
// advances the turn; only the turn buttons do.
function renderInitiativePhase() {
  const entries = state.order.map(charById).filter(Boolean);
  if (!entries.length) {
    return '<section class="phase-head"><h2>Initiative</h2><p class="empty">No one is in the fight.</p></section>';
  }
  state.turn = Math.min(state.turn, entries.length - 1);
  let viewIdx = entries.findIndex((e) => e.c.id === state.viewing);
  if (viewIdx < 0) viewIdx = state.turn;

  const list = entries.map(({ kind, c }, i) => {
    const cls = [kind,
      i < state.turn ? 'past' : '',
      i === state.turn ? 'current' : '',
      i === viewIdx ? 'viewing' : '',
      c.hp <= 0 ? 'down' : ''].join(' ');
    const hp = c.hp <= 0 ? 'Down' : `${c.hp} HP${kind === 'player' && c.resting ? ' · Resting' : ''}`;
    const status = i < state.turn ? `✓ Done · ${hp}`
      : i === state.turn ? `▶ Acting now · ${hp}`
      : i === state.turn + 1 ? `Up next · ${hp}`
      : hp;
    return `<li><button class="order-item ${cls}" data-action="view" data-char="${c.id}"
        ${i === state.turn ? 'aria-current="step"' : ''}>
      <span class="order-ap">${charAp(kind, c)}</span>
      <span class="order-name">${figureName(kind, c)}</span>
      <span class="order-hp">${status}</span>
      ${i === viewIdx && i !== state.turn ? '<span class="view-tag">Viewing</span>' : ''}
      ${c.statuses.length ? `<span class="order-tags">${statusTagsHtml(c)}</span>` : ''}
    </button></li>`;
  }).join('');

  const isLast = state.turn === entries.length - 1;
  const sidebar = `<aside class="order-panel">
    <div class="order-head">
      <h2>Initiative</h2>
      <span class="tag">Turn ${state.turn + 1} of ${entries.length}</span>
    </div>
    <ol class="order-list" aria-label="Initiative order">${list}</ol>
    <div class="order-foot">
      <button class="ghost" data-action="turn" data-index="${state.turn - 1}" ${state.turn === 0 ? 'disabled' : ''}>← Prev</button>
      ${isLast
        ? '<button class="primary" data-action="end-round">Finish Round →</button>'
        : `<button class="primary" data-action="turn" data-index="${state.turn + 1}">Next Turn →</button>`}
    </div>
  </aside>`;

  const { kind, c } = entries[viewIdx];
  const diff = viewIdx - state.turn;
  const acting = diff === 0;
  const when = acting ? '<span class="when now">Acting now</span>'
    : diff < 0 ? '<span class="when">Already acted</span>'
    : `<span class="when">Acts in ${diff} turn${diff === 1 ? '' : 's'}</span>`;

  const board = `<section class="board ${kind} ${c.hp <= 0 ? 'down' : ''}">
    <div class="board-head">
      <div class="init-ap"><span>${charAp(kind, c)}</span>AP</div>
      <div class="init-title">
        ${when}
        <span class="init-name">${figureName(kind, c)}${c.hp <= 0 ? ' <small>(down)</small>' : ''}</span>
        <span class="tag">${esc(subtitle(kind, c))}</span>
      </div>
      <div class="board-quick">
        <span class="quick-stat"><span class="quick-label">HP</span>${hpControls(kind, c.id, c.hp, maxHp(kind, c))}</span>
        <span class="quick-stat"><span class="quick-label">Guard</span><b>${guardAgainst(kind, c).value}</b></span>
      </div>
      ${acting ? '' : '<button class="small" data-action="view-current">Back to current turn</button>'}
    </div>
    <nav class="board-tabs" role="tablist" aria-label="Board">
      <button role="tab" class="board-tab ${boardTab === 'round' ? 'active' : ''}" aria-selected="${boardTab === 'round'}" data-action="board-tab" data-tab="round">This round</button>
      <button role="tab" class="board-tab ${boardTab === 'stats' ? 'active' : ''}" aria-selected="${boardTab === 'stats'}" data-action="board-tab" data-tab="stats">Stats &amp; conditions${c.statuses.length ? ` <span class="tab-count">${c.statuses.length}</span>` : ''}</button>
    </nav>
    ${boardTab === 'round' ? `<div class="board-pane">
        ${inPlayHtml(c)}
        ${warningsHtml(kind, c)}
        <div class="board-section">
          <div class="row">
            <span class="section-label">This round</span>
            <span class="spacer"></span>
            ${acting && !state.attack && !isDown(c) ? `<button class="small" data-action="custom-attack" data-char="${c.id}">Other Attack…</button>` : ''}
          </div>
          <div class="hand big round-cards">${roundCardsHtml(kind, c, acting)}</div>
        </div>
        ${kind === 'player' ? itemsHtml(c, acting) : ''}
        ${kind === 'player' ? `<details class="discard" ${openAttr(`discard-${c.id}`)}>
          <summary>Discard pile (${c.discard.length})</summary>
          <div class="hand">${c.discard.map((cid) => cardHtml(playerCard(c, cid), { attrs: 'disabled', cls: 'mini' })).join('') || '<span class="empty">Empty</span>'}</div>
        </details>` : ''}
    </div>` : `<div class="board-pane stats-pane">
        <div class="stats-cols">
          ${statTableHtml(kind, c, { hp: false })}
          ${statusesHtml(kind, c)}
        </div>
        ${kind === 'player' ? gearHtml(c) : ''}
    </div>`}
  </section>`;

  let main = board;
  if (state.attack) {
    if (state.attack !== lastAttack) { lastAttack = state.attack; mainTab = 'attack'; }
    const A = charById(state.attack.attackerId);
    const label = `${currentAction(state.attack).type === 'attack' ? 'Attack' : 'Action'} — ${state.attack.source}`;
    main = `<nav class="board-tabs main-tabs" role="tablist" aria-label="Attack or board">
        <button role="tab" class="board-tab ${mainTab === 'attack' ? 'active' : ''}" aria-selected="${mainTab === 'attack'}" data-action="main-tab" data-tab="attack">${esc(label)}</button>
        <button role="tab" class="board-tab ${mainTab === 'board' ? 'active' : ''}" aria-selected="${mainTab === 'board'}" data-action="main-tab" data-tab="board">${esc(c.name)}'s board</button>
      </nav>
      ${mainTab === 'attack' ? attackPanelHtml() : board}`;
  }
  return `<div class="init-layout">${sidebar}<div class="init-main">${main}</div></div>`;
}

// ---- Events --------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn || btn.disabled) return;
  const { action, id, kind } = btn.dataset;
  const part = () => partData(state.attack, Number(btn.dataset.step));
  const target = () => part().targets[btn.dataset.char];

  switch (action) {
    case 'tab':
      state.activePlayer = Number(btn.dataset.index);
      commit();
      window.scrollTo(0, 0);
      return;
    case 'lock-party':
      goToMonsters();
      return;
    case 'turn':
      setTurn(Number(btn.dataset.index));
      break;
    case 'view':
      state.viewing = btn.dataset.char;
      break;
    case 'view-current':
      state.viewing = null;
      break;
    case 'board-tab':
      boardTab = btn.dataset.tab;
      break;
    case 'main-tab':
      mainTab = btn.dataset.tab;
      break;
    case 'end-round':
      requestEndRound();
      return;
    case 'round-end-confirm':
      document.getElementById('round-end-dialog').close();
      endRound();
      return;
    case 'round-end-cancel':
      document.getElementById('round-end-dialog').close();
      return;
    case 'defeat-done':
      document.getElementById('defeat-dialog').close();
      return;
    case 'toggle-card': {
      const p = findChar('player', id);
      const cid = btn.dataset.card;
      p.selected = p.selected.includes(cid) ? p.selected.filter((x) => x !== cid) : [...p.selected, cid];
      break;
    }
    case 'rest': {
      const p = findChar('player', id);
      p.resting = !p.resting;
      if (p.resting) p.selected = [];
      break;
    }
    case 'hp': {
      const c = findChar(kind, id);
      c.hp = Math.max(0, Math.min(maxHp(kind, c), c.hp + Number(btn.dataset.delta)));
      break;
    }
    case 'heal': {
      const input = document.querySelector(`[data-heal-for="${id}"]`);
      const amount = Math.max(1, Number(input && input.value) || 1);
      log(heal(kind, findChar(kind, id), amount));
      break;
    }
    case 'bandage': {
      const p = findChar('player', id);
      p.bandages = Math.max(0, Math.min(BANDAGE_SLOTS, p.bandages + Number(btn.dataset.delta)));
      break;
    }
    case 'event-roll': {
      const p = findChar('player', id);
      state.eventRolls[p.id] = true;
      if (btn.dataset.value === 'fumble') {
        p.bandages = Math.min(BANDAGE_SLOTS, p.bandages + 1);
        log(`${EVENTS[state.event].name}: ${p.name} rolls a Fumble and receives 1 bandage`);
      }
      break;
    }
    case 'end-effect': {
      const c = charById(id).c;
      endEffect(c, c.effects[Number(btn.dataset.index)]);
      break;
    }
    case 'stand': {
      const c = findChar(kind, id);
      removeStatus(c, 'knocked');
      log(`${c.name} spends 1 MP to stand up`);
      break;
    }
    case 'rm-monster': {
      const m = findChar('monster', id);
      if (!confirm(`Remove ${m.name}?`)) return;
      state.monsters = state.monsters.filter((x) => x.id !== id);
      break;
    }
    case 'use-card':
    case 'convert': {
      const e = charById(btn.dataset.char);
      const card = roundCards(e.kind, e.c).find((x) => x.id === btn.dataset.card);
      if (action === 'use-card') useCard(e.kind, e.c, card);
      else convertCard(e.kind, e.c, card, btn.dataset.to);
      break;
    }
    case 'use-item': {
      const e = charById(btn.dataset.char);
      useItem(e.kind, e.c, GEAR_ITEMS[btn.dataset.item]);
      break;
    }
    case 'custom-attack':
      state.attack = customAttack(btn.dataset.char);
      break;
    case 'atk-accuracy': {
      const d = part();
      d.accuracy = btn.dataset.value === 'hit';
      if (!d.accuracy) d.targets = {};
      break;
    }
    case 'atk-die': {
      const t = target();
      const [die, roll] = btn.dataset.value.split(':');
      const same = (t.die || 'basic') === die && t.roll === roll;
      t.die = die;
      t.roll = same ? '' : roll;
      t.convert = false;
      break;
    }
    case 'atk-crit':
      target().critChoice = Number(btn.dataset.value);
      break;
    case 'atk-dist':
      target().ranged = btn.dataset.value === 'ranged';
      break;
    case 'atk-reach':
      target().reached = btn.dataset.value === 'yes';
      break;
    case 'atk-apply':
      applyAll();
      break;
    case 'atk-skip':
      skipAttack();
      break;
    case 'atk-cancel':
      cancelAttack();
      break;
    default:
      return;
  }
  commit();
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const { action, id, kind } = el.dataset;
  switch (action) {
    case 'rename':
      findChar(kind, id).name = el.value.trim() || findChar(kind, id).name;
      break;
    case 'gear':
      findChar('player', id).gear[el.dataset.slot] = el.value || null;
      break;
    case 'status': {
      const c = findChar(kind, id);
      if (el.checked) {
        if (!has(c, el.dataset.status)) c.statuses.push(el.dataset.status);
      } else {
        removeStatus(c, el.dataset.status);
      }
      break;
    }
    case 'atk-target': {
      const step = Number(el.dataset.step);
      const targets = partData(state.attack, step).targets;
      if (el.checked) targets[el.dataset.char] = targetDefaults(state.attack.actions[step], charById(state.attack.attackerId));
      else delete targets[el.dataset.char];
      break;
    }
    case 'atk-bonus':
      partData(state.attack, Number(el.dataset.step)).targets[el.dataset.char].bonus = el.checked;
      break;
    case 'atk-convert':
      partData(state.attack, Number(el.dataset.step)).targets[el.dataset.char].convert = el.checked;
      break;
    case 'atk-blitz':
      partData(state.attack, Number(el.dataset.step)).targets[el.dataset.char].blitz = el.checked;
      break;
    case 'atk-stun':
      partData(state.attack, Number(el.dataset.step)).targets[el.dataset.char].stunInstead = el.checked;
      break;
    case 'atk-field': {
      const step = Number(el.dataset.step);
      const a = state.attack.actions[step];
      const targets = partData(state.attack, step).targets;
      const f = el.dataset.field;
      if (f === 'inflict') a.inflict = el.value ? [el.value] : [];
      else a[f] = Math.max(f === 'mod' ? -99 : f === 'targets' ? 1 : 0, Number(el.value) || 0);
      if (f === 'targets') Object.keys(targets).slice(a.targets).forEach((x) => delete targets[x]);
      break;
    }
    default:
      return;
  }
  commit();
});


// <details> toggles don't bubble; listen in the capture phase.
document.addEventListener('toggle', (ev) => {
  const key = ev.target.dataset && ev.target.dataset.ui;
  if (!key) return;
  if (ev.target.open) uiOpen.add(key);
  else uiOpen.delete(key);
}, true);
