# PokerMaster

A **no-limit Texas Hold'em practice table** for friends on the same Wi-Fi, played in the browser.
Up to 10 seats, AI bots fill the empty ones, and there's nothing to install on the players' side:
no app, no account, no login.

The interface is in **English** by default, with a one-click switch to **Korean (한국어)**.

## Quick start

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

The terminal prints something like:

```
  PokerMaster is running

  This computer  http://localhost:3000
  Same Wi-Fi     http://192.168.0.12:3000  ← share this with your friends
```

Open the address, pick a nickname, and you're in the **lobby**. Friends who open the same-Wi-Fi
address show up in the lobby as they arrive, and everyone can **chat** while waiting.
**Invite** shows the address and a **QR code**, so a friend can join by pointing a phone camera at the screen.

The first person in is the **host**. Only the host picks the game mode, bots, blinds and starting
stack, then presses **Start game**. Everyone in the lobby sits down at once: the host in seat 0,
friends in the order they arrived, bots in the remaining seats. Until then, friends see
*Waiting for the host to start*.

The table has ten chairs, so **the bot limit shrinks as friends join**: with 3 friends in the lobby,
at most 6 bots fit. If the host had picked more, the count drops automatically.

People who arrive after the game starts can take an empty seat in a cash or timed game. In a
tournament they can only watch.

To use a different port: `PORT=4000 npm start`.

### Language

Use the **한국어 / English** button in the top-right corner of the main menu or the top bar
(on a phone it lives under **Settings**). The choice is saved per browser and switches the
whole screen live, mid-hand included. Each player picks their own language: the server sends
message codes rather than sentences, so table notices and errors show up in each player's chosen language.

### Playing with friends elsewhere (link invite)

Friends don't have to be on your Wi-Fi. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) once:

```bash
brew install cloudflared
```

Then start with:

```bash
npm run share
```

The terminal prints an `https://…trycloudflare.com/?k=…` address. Send it to anyone, on mobile
data or in another city, and they can join. The in-game invite QR code switches to this address too.
No Cloudflare account is needed.

- The `?k=…` at the end is the invite key. Someone who finds the address without the key can't
  get in. Only screens opened on the host computer itself skip the key.
- The address and key **change every time the server starts**, so send a fresh link after a restart.
- Your computer is the server. If it sleeps or you close the terminal, the game ends.
- If cloudflared is missing or the tunnel fails, the server prints a one-line warning and starts in
  same-Wi-Fi mode as usual.

### Desktop launcher (macOS)

To start the game from an icon instead of a terminal, run this once:

```bash
npm run launcher
```

A **PokerMaster** icon appears on the Desktop. Double-clicking it opens a terminal, starts the server
in **link invite mode** (`npm run share`), and opens the game in your browser. Share the *Anywhere*
address from the terminal (or the in-game Invite). If cloudflared is missing, the launcher offers to
install it; if you decline, it starts in same-Wi-Fi mode. **Closing the window or pressing Ctrl+C ends the game.**

If the server is already running, the launcher just opens the browser. To install it elsewhere:
`npm run launcher -- ~/some/folder`.

The icon is drawn as vectors by `tools/make-icon.mjs` and baked into an `.icns`, so there are no image
files to download. To change the launcher, edit `tools/launcher.template.command` and run
`npm run launcher` again: the Desktop copy has the repository path baked in and gets overwritten on reinstall.

### When a friend can't connect

- Check that you are **on the same router**. A phone on mobile data won't reach a LAN address
  (use `npm run share` instead).
- **macOS firewall**: System Settings → Network → Firewall, allow incoming connections for `node`.
  The first `npm start` usually shows a prompt; choose *Allow*.
- **Windows firewall**: in the dialog on first run, tick *Private networks* and allow.
- If several addresses are printed, use the one starting with `192.168.` or `10.`.

## Game modes

Pick one on the main menu:

| Mode | How it ends | Blinds |
|---|---|---|
| **Tournament** | Last player standing wins | Rise on a clock |
| **Timed** | When time runs out, the chip leader wins | Rise on a clock |
| **Cash game** | Never, with unlimited rebuys | Fixed |

You also pick the **number of rebuys**: `None`, `1x`, `2x`, `3x` or `Unlimited`. The rule is the
same in every mode:

> When your stack hits 0, you buy back in if you have rebuys left, and you're out if you don't.
>
> A rebuy grows with the blinds: **starting stack × current BB ÷ starting BB**. Start at 100 BB and
> every rebuy brings you back to 100 BB. In a cash game the blinds are fixed, so a rebuy is always
> the starting stack. Players and bots who sit down mid-game get the same amount.

**Bots get no exemption.** A bot that runs out of rebuys leaves the table and is recorded in the
standings. With unlimited rebuys nobody is ever knocked out, so a cash game never ends; set a limit
and a cash game also ends with the last player standing. Each mode brings its own default
(`None` for tournament and timed, `Unlimited` for cash) until you pick one yourself; after that,
your choice sticks when you switch modes.

**Blind structure** (tournament and timed):

- **Standard 1.5x**: what a live casino clock does, about 1.5x per level.
  `50/100 → 100/200 → 150/300 → 200/400 → 300/600 → 400/800 → 600/1200 …`
- **Turbo 2x**: every level doubles, reaching the short-stack phase in about five levels.
  `50/100 → 100/200 → 200/400 → 400/800 → 800/1600 …`

Levels last 5, 10 or 15 minutes; a timed game runs 30, 60 or 90 minutes in total.

**Blinds never change mid-hand.** When a level is due, the current hand finishes and the new blinds
apply from the next one. Changing them mid-hand would shift the minimum raise under players who have
already acted.

The top bar shows **elapsed time, the current level and blinds, and the time to the next level**.
The server sends only reference timestamps and the screen draws the countdown every second; counting
on the client would drift whenever a browser tab goes to sleep.

When a game ends, the standings appear. The host presses **New game** to send everyone back to the
main menu. To stop a game early, the host uses **Settings → End game and return to menu** (it asks for
a second press).

When the server restarts, open pages **reload themselves**. Otherwise a stale page could start a game
with settings it never sent, and the server would fill them in with defaults. Seats are held by a
token, so reloading costs nothing.

## How to play

- The host can **click any empty seat to put a bot there**, and can change blinds, starting stack and
  turn time under **Settings**. If the host leaves, the next player becomes host.
- With 2 or more players seated, a hand starts after 3 seconds; the next one starts 5 seconds after
  a hand ends.
- Two players with the same nickname are told apart: the second becomes `Alex 2`.
- A disconnected player is marked with `⚠`. If they don't come back within 2 minutes, the seat is cleared.
- You get 30 seconds per turn (adjustable). Time out and you check if you can, otherwise fold.
  **Time out twice in a row and you're sitting out**, skipped from the next hand until you act again.
  This keeps one absent player from stalling the whole table.
- The host can **clear any seat with `×`**, bot or vanished friend.
- The host can **pause** from the top bar. The turn clock, the blind level and the timed game's total
  clock **all stop together**; if any one kept running, somebody would pay for the break. Resume
  carries on exactly where it stopped. Chat still works while paused.
- **Refreshing or dropping off the Wi-Fi keeps your seat and chips** for 2 minutes.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `F` | Fold |
| `C` | Check / call |
| `R` | Raise to the amount on the slider |

### Top bar buttons

- `◆`: four-color deck (♠ black, ♥ red, ♦ blue, ♣ green), for when suits are hard to tell apart.
- `♪`: sound on/off.
- `한국어` / `English`: switch language.

## Pacing the reveal

The screen deliberately **lags behind the server**. The server sends the finished result in one go:
in an all-in runout, the turn, the river, both hands and the pot all arrive in a single snapshot.
Drawn as-is, nobody would see what happened. So the table replays it at a dealer's pace:

```
flop (one motion) → 0.9s → turn → 0.9s → river → hands turned over (0.6s each) → pot slides → 3.5s → standings
```

The turn and river land separately and showdown hands flip one at a time. The standings wait until
everyone has had time to see who won with what. Someone who joins mid-hand has no story to replay,
so they see the current state immediately.

The pot stays on the felt until it actually slides to the winner, and the winner's stack doesn't
grow before that. A busted player shows their hand and leaves the seat when the next hand starts.
The action buttons lock the moment you press one; otherwise a second press while waiting for the
reply would send an action out of turn.

## AI bots

Choose a **bot mode** on the main menu:

- **Casual**: a mix of casual bots with distinct personalities and pro bots at random difficulty.
  The screen never says which is which; reading opponents is the point of practicing.
- **Practice**: every bot is a pro, at the difficulty you choose (`Easy`, `Normal`, `Hard`).

### Casual bots

Each casual bot gets a personality. Bots at one table get different ones, so five bots means
five different types:

| Type | VPIP | PFR | Style |
|---|---|---|---|
| Nit | 6% | 5% | Premium hands only, folds under pressure |
| Rock | 19% | 6% | Plays more hands, but mostly just calls |
| TAG | 24% | 15% | Selective, and aggressive once in |
| LAG | 45% | 34% | Plays wide and keeps up the pressure |
| Calling station | 49% | 3% | Calls almost anything, rarely raises or folds |
| Maniac | 67% | 57% | Raises constantly, and big |
| Tricky | 27% | 14% | Slow-plays monsters, mixes it up |

They respect position (wider on the button, tighter in the blinds) and they **bluff**, at a rate
set by personality (maniac 60%, nit 3%) and by the situation:

- **Number of opponents**: heads-up, a bluff raise comes 17% of the time; against 3 or more, never.
  Bluffing a crowd is a donation.
- **Board texture**: an ace or a paired board makes the story believable, so more bluffs; three of
  a suit means someone will call with a draw, so fewer.
- **Position**: more often when acting last.
- **Multiple streets**: a bot that bet the flop barrels the turn 53% of the time. One-street bluffs
  are easy to read.

They also check-raise and 3-bet bluff, semi-bluff with draws, and size bluffs smaller than value bets.

### Pro bots

Pro bots play like a real grinder: they **put opponents on ranges**, narrow those ranges as the hand
goes on, compute **equity against the ranges by Monte Carlo**, and pick the action with the best
expected value. They also track each opponent's tendencies over the session. Pro bots never peek:
they read only their own hole cards, and a test pins that down.

Four styles change the taste, not the skill: **solid**, **tight**, **loose** and **tricky**.
Difficulty is the same engine run more or less carefully:

| Difficulty | Simulation budget | Range narrowing | Mistakes |
|---|---|---|---|
| Easy | 400 samples / 30 ms | No | 20% second-best |
| Normal | 1,500 samples / 60 ms | Yes | 12% second-best |
| Hard | 4,000 samples / 100 ms | Yes | None |

Measured with `npm run arena` (seed 1, 36,000 duplicate hands per lineup): Hard pros win
**+383 bb/100** against a field of casual bots, each difficulty step is a statistically significant
improvement, and the 95th-percentile decision time is under 7 ms.

## Under the hood

Cards are drawn as SVG rather than image files, so they stay sharp at any resolution. Sounds are
synthesized with Web Audio. There are no assets to download.

**The server never sends other players' hole cards.** They aren't hidden on the client, they are
never transmitted, so a friend opening the browser dev tools finds nothing. Only cards actually
shown at showdown are sent.

## Project layout

```
engine/   Pure poker logic: hand ranking, side pots, the hand state machine, equity. No sockets, no DOM.
server/   Socket.IO layer: seating, turn clock, bots, per-player state masking.
public/   Static client with no build step. Draws from snapshots, animates from events.
test/     vitest: engine unit tests plus integration tests that play a full hand over sockets.
tools/    Bot arena and the macOS desktop launcher.
```

## Tests

```bash
npm test
```

Covers hand evaluation (wheel straights, kicker comparisons, playing the board), side pots (multiple
all-ins, odd-chip splits), action validation (minimum raise, raise rights after an all-in under-raise),
heads-up blind order, tournaments and rebuys, pause, the lobby and chat, and the bots.

```bash
npm run arena
```

Runs the headless bot arena and prints the results table.

## Not there yet

Hand history replay, a live odds display, player statistics, multiple tables. Game state lives only
in memory, so stopping the server ends the session.
