# Phantom Epoch Solo Helper

A browser app for running campaigns of the board game **Phantom Epoch** solo, built to be used on an iPad next to the table. It tracks the bookkeeping (cards, initiative, HP, conditions, adversary decks) while you move figures and roll dice on the real board.

It is plain HTML, CSS and JavaScript: no build step, no dependencies, no server-side code.

## Running it

Serve the folder with any static web server. With Python:

```bash
python -m http.server 8420 --bind 0.0.0.0
```

Then open `http://localhost:8420` on the same computer.

### On an iPad

1. Run the command above (`--bind 0.0.0.0` makes it reachable from other devices).
2. Find the computer's local IP address (Windows: `ipconfig`; macOS: `ipconfig getifaddr en0`).
3. On the iPad, open `http://<that-ip>:8420` in Safari. Both devices must be on the same network.

On Windows, the firewall blocks incoming connections on networks marked **Public**. Either set your home network to **Private**, or allow the port:

```powershell
New-NetFirewallRule -DisplayName "Phantom Epoch 8420" -Direction Inbound -Protocol TCP -LocalPort 8420 -Action Allow -Profile Any
```

## How it works

### Campaigns

The home screen lists your campaigns; several can run side by side. A campaign has:

- **Characters** (up to 4): each picks a **species** (HP, AP, special ability) and a **class** (critical ability, weapon and base range, Action cards). One character per class.
- **Gear** carried between missions, including each class's starting attachment/item.
- **Mission history**, and at most one mission in progress.

### A mission

Set up the mission by naming it and placing its starting adversaries, choosing each one's HP-base colour (colours stay evenly spread within an adversary type). More adversaries can be placed at any time with **+ Adversary**.

Each round has three phases:

1. **Party** — each character selects Action cards (up to their AP) or rests.
2. **Monsters** — each adversary type draws one species card and one class card; each adversary uses its colour's line of the class card.
3. **Initiative** — everyone acts from lowest AP to highest. The acting figure plays or converts its cards; each card's parts (attacks, round effects, support actions, checks) are resolved together in one panel and applied at once.

**End mission** records a Success or Failure and carries gear back to the campaign.

### Rules handled

Following the rulebook: the Attack flow (Critical Strike, Fumble, Accuracy, Guard, Pierce), all conditions, resting, temporary/persistent card effects, adversary round effects, critical abilities (with a choice when several are available), starting attachments and items, Bandages, and start/end-of-turn effects. Movement, line of sight and positioning stay on the physical board; the app asks when it needs to know (e.g. whether a target is adjacent).

### Saving

Everything is saved automatically in the browser's local storage. Saves are per device and per browser, so a campaign played on the iPad won't appear on the computer.

## Files

| File | Contents |
|---|---|
| `index.html` | Page shell; loads the scripts and styles. |
| `data.js` | Game data: species, classes and their cards, adversary types/stats, adversary decks, conditions, gear. |
| `combat.js` | Rules engine: attacks, Guard, conditions, card effects, round effects, turn start/end. |
| `app.js` | The mission screens (Party, Monsters, Initiative) and their events. |
| `campaign.js` | Campaign storage, home/campaign/setup screens, top bar and routing. |
| `styles.css` | Styling, tablet layout and touch sizing. |

## Adding game content

All content lives in `data.js`, with comments describing each format:

- **Player species** — `PLAYER_SPECIES`
- **Player classes and their cards** — `PLAYER_CLASSES` (cards can carry structured `actions` the app resolves)
- **Adversary types and stats per level** — `ADVERSARY_TYPES`
- **Adversary species/class decks** — `MONSTER_SPECIES` / `MONSTER_CLASSES` (class cards have one line per HP-base colour)
- **Conditions** — `STATUSES`
- **Gear** — `GEAR_SLOTS` and `GEAR`

Still to be entered: the Berserker, Scout, Trained Beast and Wild Beast class decks, and the adversary species decks other than Grallok (these use placeholder cards for now).
