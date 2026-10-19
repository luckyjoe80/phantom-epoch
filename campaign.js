// Phantom Epoch — campaigns.
// A campaign has fixed characters (name, species, class), their gear, a
// history of missions, and at most one mission in progress. Several
// campaigns can run side by side. Screens:
//   home → campaign → mission setup (starting adversaries) → mission (app.js)
// Everything is saved to localStorage under one key.

const STORE_KEY = 'phantom-epoch-v5';
const OLD_KEY = 'phantom-epoch-state-v4'; // single-game saves from before campaigns

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Screen-only state, not saved.
const ui = {
  draft: null, // new-campaign form
  adding: false, // "+ Adversary" panel open
  add: { typeId: ADVERSARY_TYPES[0].id, level: 1, count: 1 },
  pending: [], // adversaries waiting to be placed mid-mission: { typeId, level, color }
  ending: false, // "End mission" panel open
  showLog: false, // mission log panel open
};

let root = loadRoot();

// ---- Storage -------------------------------------------------------------

function saveRoot() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(root)); } catch (e) { /* storage unavailable */ }
}

function loadRoot() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const c of saved.campaigns) {
        if (c.active) c.active = normalizeMission(c.active);
        if (c.setup) {
          const rows = c.setup.adversaries.filter((a) => ADV[a.typeId] && ADV[a.typeId].levels[a.level]);
          c.setup.adversaries = [];
          for (const a of rows) addGroup(c.setup.adversaries, [], a.typeId, a.level, a.count || 1, a.color);
        }
        repairCharacters(c);
      }
      return saved;
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) return importOldGame(JSON.parse(old));
  } catch (e) { /* fall through to a fresh store */ }
  return { campaigns: [], currentId: null, view: 'home' };
}

// Characters whose species or class has since been replaced (e.g. a
// placeholder class that became the Healer) get a current one, and their
// copy in a mission in progress is rebuilt to match.
function repairCharacters(campaign) {
  campaign.characters.forEach((ch, i) => {
    if (!PSPECIES[ch.speciesId]) ch.speciesId = PLAYER_SPECIES[i % PLAYER_SPECIES.length].id;
    if (!PCLASSES[ch.classId]) {
      const used = new Set(campaign.characters.map((o) => o.classId));
      ch.classId = (PLAYER_CLASSES.find((cl) => !used.has(cl.id)) || PLAYER_CLASSES[0]).id;
    }
  });
  for (const ch of campaign.characters) {
    ch.gear = { ...emptyGear(), ...ch.gear };
    for (const [slot, id] of giveStartingGear(ch)) {
      const p = campaign.active && campaign.active.players.find((x) => x.id === ch.id);
      if (p) p.gear = { ...p.gear, [slot]: id };
    }
  }
  const mission = campaign.active;
  if (!mission) return;
  mission.players = mission.players.map((p) => {
    const ch = campaign.characters.find((x) => x.id === p.id);
    if (!ch || (p.speciesId === ch.speciesId && p.classId === ch.classId)) return p;
    // New class means a new deck: start them with a fresh hand.
    const fresh = { ...makePlayer(ch), gear: p.gear, statuses: p.statuses, bandages: p.bandages };
    fresh.hp = Math.min(p.hp, fresh.hp);
    mission.log.unshift({ round: mission.round, msg: `${ch.name} is now ${PSPECIES[ch.speciesId].name} ${PCLASSES[ch.classId].name} (their old class was replaced)` });
    return fresh;
  });
}

// Wrap a pre-campaign save into a campaign so it isn't lost.
function importOldGame(game) {
  const characters = game.players.filter((p) => PSPECIES[p.speciesId] && PCLASSES[p.classId])
    .map((p) => ({ id: p.id, name: p.name, speciesId: p.speciesId, classId: p.classId, gear: p.gear || {} }));
  const campaign = {
    id: uid(),
    name: 'Imported campaign',
    createdAt: Date.now(),
    characters,
    missions: [],
    setup: null,
    active: characters.length ? normalizeMission({ ...game, name: 'Mission 1', id: uid() }) : null,
  };
  return { campaigns: [campaign], currentId: null, view: 'home' };
}

// The character as they are in the campaign's mission in progress, if any.
function missionCopy(campaign, ch) {
  return campaign.active ? campaign.active.players.find((p) => p.id === ch.id) : null;
}

function currentCampaign() {
  return root.campaigns.find((c) => c.id === root.currentId) || null;
}

function go(view, campaignId = root.currentId) {
  root.view = view;
  root.currentId = campaignId;
  const campaign = currentCampaign();
  state = view === 'mission' && campaign ? campaign.active : null;
  ui.adding = false;
  ui.ending = false;
  commit();
  window.scrollTo(0, 0);
}

// ---- Campaign actions ----------------------------------------------------

function newDraft() {
  return {
    name: `Campaign ${root.campaigns.length + 1}`,
    characters: PLAYER_CLASSES.slice(0, MAX_CHARACTERS).map((cls, i) => ({
      name: cls.name,
      speciesId: PLAYER_SPECIES[i % PLAYER_SPECIES.length].id,
      classId: cls.id,
    })),
  };
}

// A class's starting attachments and items (from its tuck box).
function startingItems(classId) {
  return [...GEAR.attachment, ...GEAR.item].filter((g) => g.starting && g.classId === classId);
}

// Equip any starting gear this character hasn't been given yet, each into a
// free slot of its kind. Returns the [slot, itemId] pairs equipped.
function giveStartingGear(ch) {
  ch.startingGiven = Array.isArray(ch.startingGiven) ? ch.startingGiven : [];
  const equipped = [];
  for (const item of startingItems(ch.classId)) {
    if (ch.startingGiven.includes(item.id)) continue;
    ch.startingGiven.push(item.id);
    if (Object.values(ch.gear).includes(item.id)) continue;
    const type = GEAR.attachment.includes(item) ? 'attachment' : 'item';
    const free = GEAR_SLOTS.find((s) => s.type === type && !ch.gear[s.id]);
    if (!free) continue;
    ch.gear[free.id] = item.id;
    equipped.push([free.id, item.id]);
  }
  return equipped;
}

function createCampaign() {
  const d = ui.draft;
  const classes = d.characters.map((c) => c.classId);
  if (new Set(classes).size !== classes.length) {
    alert('Each class can only be taken by one character.');
    return;
  }
  const campaign = {
    id: uid(),
    name: d.name.trim() || 'Campaign',
    createdAt: Date.now(),
    characters: d.characters.map((c, i) => ({
      id: `c${i + 1}`,
      name: c.name.trim() || PCLASSES[c.classId].name,
      speciesId: c.speciesId,
      classId: c.classId,
      gear: emptyGear(),
    })),
    missions: [],
    setup: null,
    active: null,
  };
  campaign.characters.forEach(giveStartingGear);
  root.campaigns.push(campaign);
  ui.draft = null;
  go('campaign', campaign.id);
}

function startSetup(campaign) {
  campaign.setup = campaign.setup || { name: `Mission ${campaign.missions.length + 1}`, adversaries: [] };
  go('setup');
}

// ---- Adversary groups and their HP-base colours ----------------------------
// Adversaries to place are listed by group: { typeId, level, count, color }.
// A group (same species and class) shares one colour; joining a group that is
// already on the map keeps its colour. `onMap` is the adversaries placed.

// A colour that no other group uses (or the first, if all four are taken).
function unusedColor(list, onMap, skip = -1) {
  const taken = [...onMap.map((m) => m.color), ...list.filter((_, i) => i !== skip).map((g) => g.color)];
  const i = ADVERSARY_COLORS.findIndex((_, ci) => !taken.includes(ci));
  return i < 0 ? 0 : i;
}

function addGroup(list, onMap, typeId, level, count, color = null) {
  const existing = list.find((g) => g.typeId === typeId);
  if (existing) {
    existing.count += count;
    return;
  }
  const onMapColor = (onMap.find((m) => m.typeId === typeId) || {}).color;
  list.push({ typeId, level, count, color: onMapColor ?? color ?? unusedColor(list, onMap) });
}

function groupListHtml(list, onMap, scope) {
  if (!list.length) return '<p class="empty">None yet.</p>';
  return `<ul class="setup-list">${list.map((g, i) => {
    const onMapGroup = onMap.filter((m) => m.typeId === g.typeId);
    const firstNum = onMapGroup.length ? Math.max(...onMapGroup.map((m) => m.num || 0)) + 1 : 1;
    const nums = Array.from({ length: g.count }, (_, k) => firstNum + k);
    const others = [...onMap.filter((m) => m.typeId !== g.typeId).map((m) => ({ color: m.color, name: ADV[m.typeId].name })),
      ...list.filter((_, k) => k !== i).map((o) => ({ color: o.color, name: ADV[o.typeId].name }))];
    const picks = onMapGroup.length
      ? `<span class="tag">${colorDot(g)} ${esc(ADVERSARY_COLORS[g.color].name)} — joins the group already on the map</span>`
      : ADVERSARY_COLORS.map((col, ci) => {
        const sharedWith = [...new Set(others.filter((o) => o.color === ci).map((o) => o.name))];
        return `<button class="color-pick ${g.color === ci ? 'active' : ''}" data-action="pick-color" data-scope="${scope}" data-index="${i}" data-color="${ci}"
            aria-pressed="${g.color === ci}" title="${esc(col.name)}${sharedWith.length ? ` — also used by ${esc(sharedWith.join(', '))}` : ''}">
          <span class="color-dot" style="background:${col.css}"></span>${esc(col.name)}${sharedWith.length ? ' <small>(in use)</small>' : ''}</button>`;
      }).join('');
    return `<li class="setup-row group-row">
      <b>${esc(ADV[g.typeId].name)}${Object.keys(ADV[g.typeId].levels).length > 1 ? ` <span class="tag">Level ${g.level}</span>` : ''}</b>
      <span class="group-count">
        <button class="small" data-action="group-count" data-scope="${scope}" data-index="${i}" data-delta="-1" aria-label="One fewer">−</button>
        <b>${g.count}</b>
        <button class="small" data-action="group-count" data-scope="${scope}" data-index="${i}" data-delta="1" aria-label="One more">+</button>
      </span>
      <span class="group-nums">${nums.map((n) => `<span class="fig-token" style="--tok:${ADVERSARY_COLORS[g.color].css}">${n}</span>`).join('')}</span>
      <span class="color-picks">${picks}</span>
      <button class="ghost danger small" data-action="remove-pending" data-scope="${scope}" data-index="${i}">Remove</button>
    </li>`;
  }).join('')}</ul>`;
}

function startMission(campaign) {
  const setup = campaign.setup;
  state = newMissionState(campaign.characters, setup.name.trim() || `Mission ${campaign.missions.length + 1}`);
  state.id = uid();
  for (const g of setup.adversaries) {
    for (let k = 0; k < g.count; k++) state.monsters.push(makeMonster(g.typeId, g.level, 1, g.color));
  }
  log(`— ${state.name} begins with ${state.monsters.length} adversar${state.monsters.length === 1 ? 'y' : 'ies'} —`);
  campaign.active = state;
  campaign.setup = null;
  go('mission');
}

// Place adversaries mid-mission. Before the round's cards are drawn they act
// this round; afterwards they wait until the next round (rulebook p.26).
function placeAdversaries() {
  const joins = state.phase === 'players' ? state.round : state.round + 1;
  const placed = [];
  for (const g of ui.pending) {
    for (let k = 0; k < g.count; k++) {
      const m = makeMonster(g.typeId, g.level, joins, g.color);
      state.monsters.push(m);
      placed.push(`${m.name} (${ADVERSARY_COLORS[m.color].name})`);
    }
  }
  if (!placed.length) return;
  ui.pending = [];
  log(`Placed ${placed.join(', ')}${joins > state.round ? ' (they act from next round)' : ''}`);
  ui.adding = false;
}

// Finish the active mission: record it, carry gear back to the campaign.
// Characters return to full HP with no conditions next mission (rulebook p.14).
function endMission(campaign, result) {
  const mission = campaign.active;
  for (const p of mission.players) {
    const ch = campaign.characters.find((c) => c.id === p.id);
    if (ch) ch.gear = { ...p.gear };
  }
  if (result !== 'abandoned') {
    campaign.missions.push({ id: mission.id || uid(), name: mission.name, result, rounds: mission.round, endedAt: Date.now() });
  }
  campaign.active = null;
  go('campaign');
}

// ---- Screens -------------------------------------------------------------

// Species and class as two separate labels.
const charTags = (ch) => `<span class="pill species" title="Species">${esc(PSPECIES[ch.speciesId].name)}</span><span class="pill class" title="Class">${esc(PCLASSES[ch.classId].name)}</span>`;
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function renderHome() {
  const cards = root.campaigns.map((c) => {
    const wins = c.missions.filter((m) => m.result === 'success').length;
    return `<article class="campaign-card">
      <div class="campaign-card-main">
        <h2>${esc(c.name)}</h2>
        <div class="party-line">${c.characters.map((ch) => `<span class="party-member"><b>${esc(ch.name)}</b> ${charTags(ch)}</span>`).join('')}</div>
        <p class="tag">${c.missions.length} mission${c.missions.length === 1 ? '' : 's'} played · ${wins} succeeded · started ${fmtDate(c.createdAt)}</p>
        ${c.active ? `<p class="in-progress">In progress: ${esc(c.active.name)} — Round ${c.active.round}</p>` : ''}
      </div>
      <div class="campaign-card-actions">
        <button class="primary" data-action="open-campaign" data-id="${c.id}">Open</button>
        <button class="ghost danger" data-action="delete-campaign" data-id="${c.id}">Delete</button>
      </div>
    </article>`;
  }).join('');
  return `<section class="phase-head"><h2>Campaigns</h2><p>Each campaign keeps its own characters, gear and mission history.</p></section>
  <div class="campaign-list">${cards || '<p class="empty">No campaigns yet.</p>'}</div>
  <button class="primary big-btn" data-action="new-campaign">+ New campaign</button>`;
}

// Each character picks a species (what they are: HP, AP, special ability)
// and, separately, a class (what they do: critical ability and Action cards).
function renderNewCampaign() {
  const d = ui.draft;
  const rows = d.characters.map((c, i) => {
    const takenBy = {};
    d.characters.forEach((o, j) => { if (j !== i) takenBy[o.classId] = o.name; });
    const speciesTiles = PLAYER_SPECIES.map((sp) => `<button class="pick-tile ${sp.id === c.speciesId ? 'selected' : ''}"
        data-action="draft-pick" data-field="speciesId" data-index="${i}" data-value="${sp.id}" aria-pressed="${sp.id === c.speciesId}">
      <span class="pick-name">${esc(sp.name)}</span>
      <span class="pick-stats">HP ${sp.hp} · AP ${sp.ap}</span>
      <span class="pick-text">${esc(sp.ability)}</span>
    </button>`).join('');
    const classTiles = PLAYER_CLASSES.map((cl) => {
      const taken = takenBy[cl.id];
      return `<button class="pick-tile ${cl.id === c.classId ? 'selected' : ''}" ${taken ? 'disabled' : ''}
          data-action="draft-pick" data-field="classId" data-index="${i}" data-value="${cl.id}" aria-pressed="${cl.id === c.classId}">
        <span class="pick-name">${esc(cl.name)}</span>
        <span class="pick-stats">${taken ? `Taken by ${esc(taken)}` : `${cl.deck.length} Action cards`}</span>
        <span class="pick-text">Critical: ${esc(cl.critical)}</span>
      </button>`;
    }).join('');
    return `<div class="draft-char">
      <div class="draft-char-head">
        <label class="field">Character ${i + 1} name <input type="text" data-draft="name" data-index="${i}" value="${esc(c.name)}"></label>
        <span class="spacer"></span>
        <button class="ghost danger" data-action="draft-remove" data-index="${i}" ${d.characters.length <= 1 ? 'disabled' : ''}>Remove</button>
      </div>
      <div class="pick-group">
        <span class="section-label">Species — HP, AP and special ability</span>
        <div class="pick-tiles">${speciesTiles}</div>
      </div>
      <div class="pick-group">
        <span class="section-label">Class — critical ability and Action cards (one character per class)</span>
        <div class="pick-tiles">${classTiles}</div>
      </div>
    </div>`;
  }).join('');
  return `<section class="phase-head"><h2>New campaign</h2><p>Characters keep their species and class for the whole campaign. Up to ${MAX_CHARACTERS} characters, one per class; any species can be shared. Solo players control at least two.</p></section>
  <section class="panel-card">
    <label class="field">Campaign name <input type="text" data-draft="campaign-name" value="${esc(d.name)}"></label>
    <div class="draft-chars">${rows}</div>
    <div class="row">
      <button data-action="draft-add" ${d.characters.length >= MAX_CHARACTERS ? 'disabled' : ''}>+ Add character</button>
      <span class="spacer"></span>
      <button class="ghost" data-action="go-home">Cancel</button>
      <button class="primary" data-action="create-campaign">Create campaign</button>
    </div>
  </section>`;
}

// Species and class dropdowns for a character between missions.
function identityPickers(c, ch) {
  const taken = new Set(c.characters.filter((o) => o !== ch).map((o) => o.classId));
  return `<label class="inline-pick"><span class="pick-label">Species</span>
      <select data-action="char-species" data-id="${ch.id}" aria-label="Species">
        ${PLAYER_SPECIES.map((sp) => `<option value="${sp.id}" ${sp.id === ch.speciesId ? 'selected' : ''}>${esc(sp.name)}</option>`).join('')}
      </select></label>
    <label class="inline-pick"><span class="pick-label">Class</span>
      <select data-action="char-class" data-id="${ch.id}" aria-label="Class">
        ${PLAYER_CLASSES.map((cl) => `<option value="${cl.id}" ${cl.id === ch.classId ? 'selected' : ''} ${taken.has(cl.id) ? 'disabled' : ''}>${esc(cl.name)}${taken.has(cl.id) ? ' (taken)' : ''}</option>`).join('')}
      </select></label>`;
}

function renderCampaign() {
  const c = currentCampaign();
  const chars = c.characters.map((ch) => `<article class="char-card">
    <div class="char-card-head">
      <input type="text" class="name-input" data-action="char-rename" data-id="${ch.id}" value="${esc(ch.name)}" aria-label="Character name">
      ${c.active ? charTags(ch) : identityPickers(c, ch)}
      <span class="tag">HP ${PSPECIES[ch.speciesId].hp} · AP ${PSPECIES[ch.speciesId].ap}</span>
    </div>
    ${gearHtml(missionCopy(c, ch) || ch, 'char-gear')}
  </article>`).join('');
  const history = [...c.missions].reverse().map((m) => `<li>
    <span class="result ${m.result}">${m.result === 'success' ? 'Success' : 'Failure'}</span>
    <b>${esc(m.name)}</b> <span class="tag">${m.rounds} round${m.rounds === 1 ? '' : 's'} · ${fmtDate(m.endedAt)}</span>
  </li>`).join('');
  return `<section class="phase-head campaign-head">
    <input type="text" class="name-input campaign-name" data-action="campaign-rename" value="${esc(c.name)}" aria-label="Campaign name">
    <span class="spacer"></span>
    ${c.active
      ? `<button class="primary big-btn" data-action="continue-mission">Continue ${esc(c.active.name)} (Round ${c.active.round}) →</button>`
      : '<button class="primary big-btn" data-action="start-setup">Start new mission →</button>'}
  </section>
  <div class="campaign-body">
    <section class="panel-card">
      <span class="section-label">Characters</span>
      <p class="tag">${c.active
        ? `${esc(c.active.name)} is in progress, so species and class are locked until it ends. Gear changes here apply to the mission too (by the rules, only on a rest turn).`
        : 'Change species, class and gear between missions. Each class can only belong to one character.'}</p>
      <div class="char-cards">${chars}</div>
    </section>
    <section class="panel-card">
      <span class="section-label">Missions</span>
      <ol class="mission-history">${history || '<p class="empty">No missions played yet.</p>'}</ol>
    </section>
  </div>`;
}

// Adversary type (grouped by species), level and count.
function adversaryPickers(prefix, sel) {
  const groups = MONSTER_SPECIES.map((sp) => {
    const types = ADVERSARY_TYPES.filter((t) => t.speciesId === sp.id);
    return types.length ? `<optgroup label="${esc(sp.name)}">
      ${types.map((t) => `<option value="${t.id}" ${t.id === sel.typeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    </optgroup>` : '';
  }).join('');
  // Level only needs choosing once a type has more than one entered.
  const levels = Object.keys(ADV[sel.typeId].levels);
  return `<label>Adversary <select data-${prefix}="typeId">${groups}</select></label>
    ${levels.length > 1 ? `<label>Level <select data-${prefix}="level">
      ${levels.map((lv) => `<option value="${lv}" ${Number(lv) === sel.level ? 'selected' : ''}>Level ${lv}</option>`).join('')}
    </select></label>` : ''}
    <label>How many <input type="number" min="1" max="12" data-${prefix}="count" value="${sel.count}"></label>`;
}

function renderSetup() {
  const c = currentCampaign();
  const s = c.setup;

  return `<section class="phase-head"><h2>New mission</h2><p>Name the mission and place the adversaries that start on the map. More can be placed during the mission.</p></section>
  <section class="panel-card">
    <label class="field">Mission name <input type="text" data-setup="name" value="${esc(s.name)}"></label>
    <span class="section-label">Starting adversaries (${s.adversaries.length})</span>
    <div class="add-row">${adversaryPickers('setup-add', ui.add)}
      <button data-action="setup-add">Add</button>
    </div>
    <p class="tag">Each group shares one HP-base colour; its members are numbered 1, 2, 3…</p>
    ${groupListHtml(s.adversaries, [], 'setup')}
    <div class="sheet-foot">
      <button class="ghost" data-action="go-campaign">Cancel</button>
      <button class="primary" data-action="start-mission">Start mission →</button>
    </div>
  </section>`;
}

// Panels shown above a mission screen.
function missionPanelsHtml() {
  const c = currentCampaign();
  let html = '';
  if (ui.adding) {
    const later = state.phase !== 'players';
    html += `<section class="panel-card overlay-panel">
      <span class="section-label">Place adversaries</span>
      <div class="add-row">${adversaryPickers('add', ui.add)}
        <button data-action="add-pending">Add</button>
      </div>
      <p class="tag">Adversaries joining a group on the map keep its colour and continue its numbering.</p>
      ${groupListHtml(ui.pending, state.monsters, 'add')}
      <p class="tag">${later
        ? "This round's cards are already drawn, so they act from next round."
        : 'Placed before cards are drawn, so they act this round.'}</p>
      <div class="sheet-foot">
        <button class="ghost" data-action="toggle-add">Cancel</button>
        <button class="primary" data-action="place-adversaries" ${ui.pending.length ? '' : 'disabled'}>Place ${ui.pending.reduce((n, g) => n + g.count, 0) || ''}</button>
      </div>
    </section>`;
  }
  if (ui.ending) {
    html += `<section class="panel-card overlay-panel">
      <span class="section-label">End ${esc(state.name)}</span>
      <p>Record the result. Characters keep their gear; HP, cards and conditions reset for the next mission.</p>
      <div class="sheet-foot">
        <button class="ghost" data-action="toggle-end">Cancel</button>
        <button class="ghost danger" data-action="end-mission" data-result="abandoned">Abandon (don't record)</button>
        <button class="danger-btn" data-action="end-mission" data-result="failure">Failure</button>
        <button class="primary" data-action="end-mission" data-result="success">Success</button>
      </div>
    </section>`;
  }
  return html;
}

function renderTopbar() {
  const c = currentCampaign();
  const inMission = root.view === 'mission' && state;
  const crumbs = [];
  if (c && root.view !== 'home') {
    crumbs.push(root.view === 'campaign'
      ? `<span class="crumb">${esc(c.name)}</span>`
      : `<button class="crumb link" data-action="go-campaign">${esc(c.name)}</button>`);
  }
  if (inMission) crumbs.push(`<span class="crumb">${esc(state.name)} · <b class="round">Round ${state.round}</b></span>`);
  if (root.view === 'setup') crumbs.push('<span class="crumb">New mission</span>');

  let middle = '';
  let actions = '';
  if (inMission) {
    const idx = PHASES.indexOf(state.phase);
    middle = `<ol class="stepper" aria-label="Round phases">
      ${['Party', 'Monsters', 'Initiative'].map((label, i) => `<li class="${i === idx ? 'current' : i < idx ? 'past' : ''}"><span>${i + 1}</span> ${label}</li>`).join('')}
    </ol>`;
    const labels = {
      players: [null, 'Lock In Party →'],
      monsters: ['← Party', 'Initiative →'],
      initiative: ['← Monsters', 'End Round →'],
    }[state.phase];
    actions = `${labels[0] ? `<button class="ghost" data-action="phase-back">${labels[0]}</button>` : ''}
      <button class="primary" data-action="phase-next">${labels[1]}</button>
      <button class="${ui.adding ? 'active' : ''}" data-action="toggle-add">+ Adversary</button>
      <button class="ghost ${ui.showLog ? 'active' : ''}" data-action="toggle-log" aria-pressed="${ui.showLog}">Log</button>
      <button class="ghost danger ${ui.ending ? 'active' : ''}" data-action="toggle-end">End mission</button>`;
  }
  document.getElementById('topbar').innerHTML = `
    <div class="brand">
      <button class="brand-btn" data-action="go-home"><h1>Phantom Epoch</h1></button>
      ${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb">› ${crumbs.join(' › ')}</nav>` : ''}
    </div>
    ${middle}
    <div class="round-actions">${actions}</div>`;
}

function render() {
  if (root.view !== 'home' && root.view !== 'new' && !currentCampaign()) root.view = 'home';
  if (root.view === 'mission' && !(currentCampaign() || {}).active) root.view = 'campaign';
  if (root.view === 'new' && !ui.draft) ui.draft = newDraft();
  state = root.view === 'mission' ? currentCampaign().active : null;

  renderTopbar();
  // Panels that sit under the sticky top bar need its current height.
  document.documentElement.style.setProperty('--topbar-h', `${document.getElementById('topbar').offsetHeight}px`);
  const view = document.getElementById('view');
  view.dataset.phase = root.view === 'mission' ? state.phase : root.view;
  const screens = {
    home: renderHome,
    new: renderNewCampaign,
    campaign: renderCampaign,
    setup: renderSetup,
    mission: () => (ui.showLog ? logPanelHtml() : '') + missionPanelsHtml() + {
      players: renderPlayersPhase,
      monsters: renderMonstersPhase,
      initiative: renderInitiativePhase,
    }[state.phase](),
  };
  view.innerHTML = screens[root.view]();
}

// ---- Events --------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn || btn.disabled) return;
  const c = currentCampaign();
  const { action } = btn.dataset;

  switch (action) {
    case 'go-home': go('home', null); return;
    case 'go-campaign': go('campaign'); return;
    case 'new-campaign': ui.draft = newDraft(); go('new', null); return;
    case 'open-campaign': go('campaign', btn.dataset.id); return;
    case 'delete-campaign': {
      const target = root.campaigns.find((x) => x.id === btn.dataset.id);
      if (!confirm(`Delete "${target.name}" and all of its history? This can't be undone.`)) return;
      root.campaigns = root.campaigns.filter((x) => x !== target);
      break;
    }
    case 'draft-add': {
      const used = new Set(ui.draft.characters.map((x) => x.classId));
      const cls = PLAYER_CLASSES.find((x) => !used.has(x.id));
      if (!cls) return;
      const n = ui.draft.characters.length;
      ui.draft.characters.push({ name: cls.name, speciesId: PLAYER_SPECIES[n % PLAYER_SPECIES.length].id, classId: cls.id });
      break;
    }
    case 'draft-remove': ui.draft.characters.splice(Number(btn.dataset.index), 1); break;
    case 'draft-pick': {
      const ch = ui.draft.characters[Number(btn.dataset.index)];
      // A name still matching its old class follows the new class.
      if (btn.dataset.field === 'classId' && ch.name === PCLASSES[ch.classId].name) ch.name = PCLASSES[btn.dataset.value].name;
      ch[btn.dataset.field] = btn.dataset.value;
      break;
    }
    case 'create-campaign': createCampaign(); return;
    case 'start-setup': startSetup(c); return;
    case 'continue-mission': go('mission'); return;
    case 'setup-add': addGroup(c.setup.adversaries, [], ui.add.typeId, ui.add.level, ui.add.count); break;
    case 'add-pending': addGroup(ui.pending, state.monsters, ui.add.typeId, ui.add.level, ui.add.count); break;
    case 'pick-color': {
      const list = btn.dataset.scope === 'setup' ? c.setup.adversaries : ui.pending;
      list[Number(btn.dataset.index)].color = Number(btn.dataset.color);
      break;
    }
    case 'group-count': {
      const list = btn.dataset.scope === 'setup' ? c.setup.adversaries : ui.pending;
      const g = list[Number(btn.dataset.index)];
      g.count = Math.max(1, Math.min(12, g.count + Number(btn.dataset.delta)));
      break;
    }
    case 'remove-pending': {
      const list = btn.dataset.scope === 'setup' ? c.setup.adversaries : ui.pending;
      list.splice(Number(btn.dataset.index), 1);
      break;
    }
    case 'start-mission': startMission(c); return;
    case 'phase-next':
      ui.adding = false;
      ui.ending = false;
      if (state.phase === 'players') goToMonsters();
      else if (state.phase === 'monsters') goToInitiative();
      else endRound();
      return;
    case 'phase-back':
      if (state.phase === 'monsters') backToPlayers();
      else if (state.phase === 'initiative') backToMonsters();
      return;
    case 'toggle-add': ui.adding = !ui.adding; ui.pending = []; ui.ending = false; window.scrollTo(0, 0); break;
    case 'place-adversaries': placeAdversaries(); break;
    case 'toggle-end': ui.ending = !ui.ending; ui.adding = false; window.scrollTo(0, 0); break;
    case 'toggle-log': ui.showLog = !ui.showLog; break;
    case 'end-mission': endMission(c, btn.dataset.result); return;
    default: return;
  }
  commit();
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const c = currentCampaign();
  const d = el.dataset;
  if (d.draft) {
    if (d.draft === 'campaign-name') ui.draft.name = el.value;
    else ui.draft.characters[Number(d.index)][d.draft] = el.value;
  } else if (d.setup) {
    c.setup[d.setup] = el.value;
  } else if (d.add || d.setupAdd) {
    const field = d.add || d.setupAdd;
    if (field === 'count') ui.add.count = Math.max(1, Math.min(12, Number(el.value) || 1));
    else if (field === 'level') ui.add.level = Number(el.value);
    else {
      ui.add.typeId = el.value;
      // Keep the level if this type has it, otherwise use its lowest.
      if (!ADV[el.value].levels[ui.add.level]) ui.add.level = Number(Object.keys(ADV[el.value].levels)[0]);
    }
  } else if (d.action === 'char-rename') {
    const ch = c.characters.find((x) => x.id === d.id);
    ch.name = el.value.trim() || 'Character';
    const p = missionCopy(c, ch);
    if (p) p.name = ch.name;
  } else if (d.action === 'char-gear') {
    const ch = c.characters.find((x) => x.id === d.id);
    ch.gear[d.slot] = el.value || null;
    const p = missionCopy(c, ch);
    if (p) p.gear[d.slot] = ch.gear[d.slot];
  } else if (d.action === 'char-species' || d.action === 'char-class') {
    if (c.active) return;
    const ch = c.characters.find((x) => x.id === d.id);
    if (d.action === 'char-class' && c.characters.some((o) => o !== ch && o.classId === el.value)) { render(); return; }
    ch[d.action === 'char-species' ? 'speciesId' : 'classId'] = el.value;
    if (d.action === 'char-class') {
      // Swap class starting gear: other classes' comes off, this class's goes on.
      for (const slot of Object.keys(ch.gear)) {
        const item = GEAR_ITEMS[ch.gear[slot]];
        if (item && item.classId && item.classId !== ch.classId) ch.gear[slot] = null;
      }
      ch.startingGiven = [];
      giveStartingGear(ch);
    }
  } else if (d.action === 'campaign-rename') {
    c.name = el.value.trim() || c.name;
  } else {
    return;
  }
  commit();
});

render();
