# Live Cricket Scoring — Site Scan + AI Project Documentation

Source scanned: **https://livecricketscoring.com/**
Scan date: July 28, 2026

---

## 1. Site-এ পাওয়া সব লিংক (Full Sitemap / Link List)

| # | Page | URL |
|---|------|-----|
| 1 | Home | https://livecricketscoring.com/ |
| 2 | About Us | https://livecricketscoring.com/about-us |
| 3 | Score Feature (ball-by-ball scoring) | https://livecricketscoring.com/features/score |
| 4 | Tournament Management | https://livecricketscoring.com/features/tournament |
| 5 | Coin Flip Tool | https://livecricketscoring.com/features/coin-flip |
| 6 | Spin the Wheel Tool | https://livecricketscoring.com/features/spin-wheel |
| 7 | YouTube Live Broadcast | https://livecricketscoring.com/broadcast/youtube |
| 8 | Facebook Live Broadcast | https://livecricketscoring.com/broadcast/facebook |
| 9 | Guide: Get YouTube Stream Key | https://livecricketscoring.com/guides/youtube-stream-key |
| 10 | Guide: Get Facebook Stream Key | https://livecricketscoring.com/guides/facebook-stream-key |
| 11 | Blog: Best Cricket Scoring App | https://livecricketscoring.com/blog/best-cricket-scoring-app |
| 12 | Change Logs | https://livecricketscoring.com/changelog |
| 13 | Register / Sign Up | https://livecricketscoring.com/register |
| 14 | Log In | https://livecricketscoring.com/login |
| 15 | Download App | https://livecricketscoring.com/download |
| 16 | Privacy Policy | https://livecricketscoring.com/privacy |
| 17 | Terms of Service | https://livecricketscoring.com/terms |
| 18 | Example live scorecard (dynamic, per-match) | https://livecricketscoring.com/s/{match-slug} — e.g. `/s/mumbai-strikers-07` |

> Note: `/s/mumbai-strikers-07` এবং `/s/local-match-07` হলো demo/example scorecard link — এগুলো প্রতিটা match তৈরি হলে dynamically generate হয় (pattern: `/s/{team-slug}-{match-number}`)।

---

## 2. সাইট কী করে — সংক্ষিপ্ত বিশ্লেষণ (Product Summary)

**Live Cricket Scoring** একটা free ওয়েব + মোবাইল অ্যাপ, যেটা local/gully/box/turf/tape-ball/tennis-ball cricket match ball-by-ball score করতে দেয়। মূল ভ্যালু প্রপোজিশন:

- একজন scorer মোবাইল থেকে প্রতিটা ball এন্টার করে।
- অ্যাপ automatically calculate করে: runs, wickets, overs, extras, run rate (CRR), required run rate (RRR), partnerships, batting/bowling figures, NRR।
- প্রতিটা match-এর জন্য একটা **unique live scorecard link** তৈরি হয় (`/s/xxxx`), যেটা যে কেউ browser-এ খুলে দেখতে পারে — app install বা login লাগে না।
- Tournament management (fixtures, points table, NRR standings, public results page)।
- YouTube/Facebook broadcast workflow (stream key setup, scoreboard overlay)।
- Extra utility tools: Coin Flip, Spin the Wheel (toss করার জন্য)।
- Offline scoring + auto-sync।
- Free forever, ads-free scoring interface।

---

## 3. Core Feature List (Functional Requirements)

### 3.1 Match Setup
- Team creation (name, logo optional)
- Saved team / roster reuse
- Match format selection: T20, T10, ODI, Test, Box, Turf, Gully, Tape-ball, Tennis-ball, Custom
- Overs limit (fixed or custom), no-boundary rule toggle (box cricket)
- Toss (manual or via Coin Flip tool)
- DLS/target support for rain-affected limited-overs matches

### 3.2 Ball-by-Ball Scoring Engine
- Select striker, non-striker, bowler before every over
- Score each delivery: dot, 1/2/3/4/6 runs, wide, no-ball, bye, leg-bye, wicket (with dismissal type)
- Auto strike rotation on odd runs / end of over
- Auto over/ball counter, auto bowler change prompt
- **Correction/edit log**: edit any past delivery → auto recalculation of all downstream stats
- Auto stats calculated live:
  - Batting: runs, balls faced, 4s, 6s, strike rate
  - Bowling: overs, maidens, runs conceded, wickets, economy
  - Partnerships (runs + balls, resets on wicket)
  - Fall of wickets log (score/over/batter)
  - Extras breakdown (wide/no-ball/bye/leg-bye)
  - Current Run Rate (CRR) & Required Run Rate (RRR)

### 3.3 Live Scorecard Sharing
- Auto-generated public URL per match: `/s/{slug}`
- No login required to view
- Real-time (or near-real-time) score updates for viewers
- Shareable via WhatsApp/SMS/social

### 3.4 Tournament Management
- Multiple teams, fixtures/schedule
- **Group stage support** (teams split into groups, round-robin within group)
- **Knockout bracket support** (single-elimination stage after group stage)
- Points table with auto NRR (Net Run Rate) calculation
  - Formula: `NRR = (runs scored / overs faced) − (runs conceded / overs bowled)`
- Live standings that update the moment a match result is entered
- Public tournament results page (shareable, no login)

### 3.5 Broadcast Support
- YouTube Live guide + stream key instructions
- Facebook Live guide + stream key instructions
- **Scoreboard overlay directly from the phone camera** — the marketing copy specifically
  emphasizes **"no OBS, no laptop needed"**: the phone that is running the scoring app is also
  the thing streaming, with the live score/wickets/overs/batsman/bowler/run-rate overlay
  burned into the same video feed. (OBS is mentioned only as the *traditional/harder*
  alternative that this product is positioned against — not a requirement.)
- Overlay shows: score, wickets, overs, current batsmen, current bowler, run rate, match details

### 3.6 Utility Tools
- **Coin Flip** — tap-to-flip virtual coin for the toss (heads/tails, called before the flip),
  used standalone or wired into "who won the toss / what did they choose" at match creation
- **Spin the Wheel** — general-purpose random picker (e.g. batting order, playing XI selection,
  or any random-choice need around the match)

### 3.7 Accounts & Auth
- Register/Login
- Offline-first scoring with sync-on-reconnect

### 3.8 Content/Marketing Pages
- Blog (SEO content e.g. "Best Cricket Scoring App" comparison)
- Changelog
- Privacy Policy / Terms
- FAQ (rich, SEO-targeted)

---

## 4. Suggested Tech Stack (এই ধরনের app বানানোর জন্য)

| Layer | Recommendation |
|---|---|
| Frontend (web) | Next.js (React) + Tailwind CSS — SSR for SEO-heavy marketing pages + client-side app for scoring |
| Mobile | React Native / Flutter (single codebase, offline-first with local SQLite/Realm) |
| Backend API | Node.js (NestJS/Express) or Laravel (PHP — site headers hint Laravel-ish routing) |
| Database | PostgreSQL (relational: matches, balls, players, teams, tournaments) |
| Realtime updates | WebSocket (Socket.IO) or Firebase Realtime DB / Supabase Realtime for live scorecard push |
| Offline sync | Local-first storage (SQLite) + background sync queue, conflict resolution by timestamp |
| Auth | JWT / OAuth (email + Google login) |
| Hosting | Vercel/Netlify (frontend) + a VPS or Render/Railway (backend) |
| Broadcast overlay | HTML/CSS overlay rendered as a browser source in OBS Studio, fed by the same realtime score API |

---

## 5. Data Model (Core Entities)

```
User
 ├─ id, name, email, password_hash

Team
 ├─ id, name, logo_url, owner_user_id

Player
 ├─ id, team_id, name, role (batter/bowler/allrounder/wk)

Match
 ├─ id, team_a_id, team_b_id, format (T20/T10/ODI/Test/Custom),
 │   overs_limit, toss_winner_id, toss_decision, status (upcoming/live/completed),
 │   slug (public share URL), tournament_id (nullable)

Innings
 ├─ id, match_id, batting_team_id, bowling_team_id, total_runs,
 │   total_wickets, overs_completed, extras_wide, extras_noball,
 │   extras_bye, extras_legbye

Ball (delivery-level — the core event log)
 ├─ id, innings_id, over_number, ball_number, striker_id, non_striker_id,
 │   bowler_id, runs_scored, extra_type (null/wide/noball/bye/legbye),
 │   is_wicket, wicket_type, dismissed_player_id, fielder_id, timestamp

PlayerMatchStats (derived/aggregated — can be computed on the fly or cached)
 ├─ player_id, match_id, runs, balls_faced, fours, sixes, strike_rate,
 │   overs_bowled, maidens, runs_conceded, wickets, economy

Tournament
 ├─ id, name, format (league / group+knockout), teams[],
 │   points_table (auto-derived from matches), nrr

TournamentGroup (optional — only when format = group+knockout)
 ├─ id, tournament_id, name, teams[]

BracketMatch (optional — knockout stage)
 ├─ id, tournament_id, round (quarterfinal/semifinal/final),
 │   team_a_id, team_b_id, winner_id, next_bracket_match_id

Partnership (derived per innings)
 ├─ wicket_number, batter1_id, batter2_id, runs, balls
```

Key design principle: **the `Ball` table is the single source of truth**. Every other stat (batting figures, bowling figures, run rate, NRR, partnerships, fall of wickets) is a **derived aggregation** over the ball log — this is exactly why editing one ball can recalculate everything downstream correctly.

---

## 6. এখন — AI দিয়ে বানানোর জন্য পূর্ণাঙ্গ Prompt

নিচের prompt-টা copy করে সরাসরি Claude (বা যেকোনো coding-capable AI / Claude Code) কে দিতে পারো। এটা একটা single, in-depth build-prompt — MVP স্কোপ থেকে শুরু করে data model, API, ও UI সব কভার করে।

```
ROLE: You are a senior full-stack engineer building a production-grade cricket
scoring web application from scratch, similar in concept to "Live Cricket
Scoring" (livecricketscoring.com) — a free ball-by-ball cricket scorer for
local/club/school/gully/box/turf/tape-ball cricket matches.

GOAL:
Build an MVP web app with the following capabilities:

1. MATCH SETUP
   - Create a match: team A name, team B name, format (T20 / T10 / ODI / Test
     / Box / Turf / Gully / Tape-ball / Tennis-ball / Custom), overs limit,
     toss winner + decision (bat/bowl), optional DLS toggle.
   - Add/select players for both teams (11 or fewer), or reuse a saved roster.

2. BALL-BY-BALL SCORING ENGINE
   - A scoring screen where the scorer selects striker, non-striker, and
     bowler, then taps a result for each delivery: 0,1,2,3,4,6, wide,
     no-ball, bye, leg-bye, or wicket (with dismissal type: bowled, caught,
     lbw, run-out, stumped, hit-wicket, etc., plus fielder/catcher if
     relevant).
   - Automatically: rotate strike on odd runs and end-of-over, increment
     over/ball counters correctly (extras don't count as a legal ball except
     byes/leg-byes which do), track maidens, and prompt for new bowler at
     the end of an over (no bowler may bowl consecutive overs).
   - Maintain a full delivery log (immutable event log) as the source of
     truth. Every derived stat (batting figures, bowling figures,
     partnerships, fall of wickets, extras breakdown, current run rate,
     required run rate) must be computed FROM this log, not stored
     independently — so that editing any one past delivery and recomputing
     forward fixes all downstream numbers automatically.
   - Include an "edit delivery" / correction log feature: the scorer can open
     any past ball, change its outcome, and the app recalculates everything
     after that point.

3. LIVE SHAREABLE SCORECARD
   - Every match gets a unique public URL (e.g. /s/{team-slug}-{random-id})
     viewable by anyone without login or app install, on any device.
   - The public scorecard view shows: live score, overs, current run rate,
     required run rate (if chasing), partnership, full batting card, full
     bowling card, fall of wickets, extras breakdown — and updates live
     (poll every few seconds or use WebSocket/real-time subscription).

4. TOURNAMENT MODE (secondary priority after core scoring works)
   - Create a tournament with multiple teams and fixtures.
   - Support two tournament formats: (a) simple league/round-robin, and
     (b) group stage followed by a knockout bracket (quarterfinal ->
     semifinal -> final), where the top N teams from each group advance.
   - Auto-generate a points table with Net Run Rate calculated as:
     NRR = (total runs scored / total overs faced) − (total runs conceded /
     total overs bowled), aggregated across all of a team's matches in the
     tournament. Standings must recompute the moment a match result is saved.
   - A simple bracket view for the knockout stage (team A vs team B per
     round, winner auto-advances to the next slot).
   - Public tournament results/standings/bracket page — no login required.

5. OFFLINE-FIRST BEHAVIOR (mobile/web)
   - Scoring should work without an internet connection (store deliveries
     locally) and sync to the server once connectivity returns, with
     last-write-wins or timestamp-based conflict resolution.

6. BROADCAST / SCOREBOARD OVERLAY (secondary priority)
   - A "broadcast mode" that overlays live score data (score, wickets,
     overs, current batsmen, current bowler, run rate) on top of a live
     video feed streamed straight from the same phone that is scoring the
     match — i.e. no separate laptop or OBS Studio setup required, unlike
     traditional streaming workflows. Target platforms: YouTube Live and
     Facebook Live (guide the user to paste in their stream key).
   - Treat this as a stretch goal after scoring + live scorecard + basic
     tournaments are solid; note in comments where a simpler OBS-browser-
     source overlay could be substituted as a fallback if true in-app
     camera+overlay streaming is out of scope for the MVP.

7. UTILITY TOOLS
   - A simple animated Coin Flip tool for the toss — one tap flips a virtual
     coin to heads/tails; optionally wire the result into "who won the toss"
     at match creation.
   - A "Spin the Wheel" random-picker tool (e.g., for choosing batting
     order, playing XI, or any other random selection around the match).

TECH REQUIREMENTS:
- Frontend: React (Next.js) + Tailwind CSS. Mobile-first responsive design —
  scoring is done primarily on a phone in a cricket ground with poor network.
- Backend: Node.js REST API (or GraphQL) with clearly documented endpoints
  for: create match, add delivery, edit delivery, get live scorecard by
  slug, create tournament, get tournament standings.
- Database: PostgreSQL. Design the schema so `deliveries` is the
  append-only event log table, and all stats are derived via SQL
  aggregation or a computed service layer — do NOT duplicate stat storage
  in a way that can drift out of sync with the delivery log.
- Real-time updates: use WebSockets (Socket.IO) or Server-Sent Events so the
  public scorecard page updates without manual refresh.
- Authentication: simple email/password + JWT for the scorer's account
  (viewers of the public scorecard link need NO authentication at all).

DELIVERABLES, IN THIS ORDER:
1. Database schema (SQL DDL) for: users, teams, players, matches, innings,
   deliveries, tournaments, tournament_teams.
2. Backend API route list + request/response shape for each core endpoint.
3. Core scoring-state logic (a pure function or service class) that takes
   the full delivery log for an innings and returns: total runs, wickets,
   overs, extras breakdown, batting card, bowling card, partnerships, fall
   of wickets, CRR, RRR (if 2nd innings and chasing). Write this as
   thoroughly unit-testable logic, separate from the API/UI layer.
4. A minimal working scoring UI (React component) that lets a user step
   through creating a match and entering deliveries, wired to the backend.
5. A minimal public live-scorecard page component that fetches/subscribes
   to a match by slug and renders the scoreboard.

Ask me clarifying questions ONLY if something is truly ambiguous and
blocking; otherwise make sensible assumptions (documented in comments) and
proceed to build. Prioritize correctness of the ball-by-ball stat
calculation logic above all else — that is the hardest and most
important part of this product.
```

---

## 6.1 Coverage Check — সাইটের কোন ফিচার prompt-এ কোথায় কভার হয়েছে

| সাইটের ফিচার (frontend-এ যা দেখা যায়) | Prompt-এর কোন অংশে আছে |
|---|---|
| Match/Team/Toss setup, formats (T20/T10/ODI/Test/Box/Turf/Gully/Tape-ball/Tennis-ball/Custom), overs, DLS | Point 1 |
| Ball-by-ball scoring, strike rotation, over/bowler logic, correction log, all auto-stats (batting/bowling/partnership/FOW/extras/CRR/RRR) | Point 2 |
| Live scorecard link `/s/{slug}`, no-login public view, WhatsApp-shareable | Point 3 |
| Tournament: fixtures, group stage, knockout bracket, points table + NRR, public standings page | Point 4 |
| Offline scoring + auto-sync | Point 5 |
| YouTube/Facebook broadcast, phone-only scoreboard overlay (no OBS) | Point 6 |
| Coin Flip + Spin the Wheel | Point 7 |
| Register/Login (scorer accounts only — viewers never need an account) | TECH REQUIREMENTS → Authentication |
| Player/team stats history across matches | Data model (`PlayerMatchStats`) + implied in Point 3/4 |

**যা prompt-এ ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছে** (কারণ এগুলো product/business অংশ, "app বানানো"-র core নয়):
- Blog/SEO content pages, Changelog, About Us, Privacy/Terms — এগুলো marketing/legal পেজ, চাইলে Next.js-এ সাধারণ static/MD পেজ হিসেবে যোগ করা যায় কিন্তু AI-কে আলাদা করে বলার দরকার নেই, ও নিজে থেকেই বানিয়ে দিতে পারবে অল্প নির্দেশে।
- "Buy me a coffee" donation link — ছোট UI ডিটেইল, ইচ্ছা করলে পরে add করা যায়।

সারকথা: হ্যাঁ, এই prompt দিয়ে সাইটে যা যা **করা যায়** (scoring, sharing, tournaments+brackets, broadcast overlay, coin flip/wheel, offline sync, accounts) — সবগুলোর জন্যই AI-কে instruction দেওয়া আছে। marketing/content পেজগুলো বাদে, কারণ সেগুলো "product feature" না।

---

## 7. Prompt ব্যবহার করার সময় কিছু Tips

1. **ধাপে ধাপে দাও** — পুরো prompt একসাথে দিলে বড় codebase-এ AI হয়তো shortcut নেবে। প্রথমে শুধু ধাপ ৩ (data model + schema) আর ৪ (scoring logic) চাও, সেগুলো ঠিকমতো কাজ করলে তারপর UI আর tournament অংশে যাও।
2. **Scoring logic-টাই সবচেয়ে critical অংশ** — cricket-এর rule অনেক edge-case ভর্তি (wide + wicket একসাথে, no-ball পরে free-hit, over-এ maiden নির্ণয়, ইত্যাদি)। এই অংশ আলাদাভাবে unit test সহ বানানো ভালো।
3. **Claude Code / Cursor / GitHub Copilot Workspace** দিয়ে বানালে ভালো — কারণ multi-file backend+frontend প্রজেক্ট, এবং iterative debugging দরকার হবে।
4. **livecricketscoring.com-এর কোনো কোড, ডিজাইন asset, বা কনটেন্ট copy করা যাবে না** — উপরের ডকুমেন্টেশন শুধু তাদের *public-facing feature list* বিশ্লেষণ করে বানানো একটা independent স্পেসিফিকেশন, hobby/learning/অনুরূপ প্রোডাক্ট বানানোর জন্য। তাদের ব্র্যান্ডিং, নাম, লোগো, বা কপি ব্যবহার না করাই ভালো।

---

## 8. UI / Visual Design Direction — মূল সাইট থেকে ইচ্ছাকৃতভাবে আলাদা

livecricketscoring.com-এর লুক ছিল typical modern SaaS style: dark glossy score-card, gradient "LIVE" badge, emoji icons, rounded cards। কপিরাইট এড়ানোর জন্য নিচে সম্পূর্ণ **আলাদা একটা visual direction** ঠিক করে দিলাম — একই বিষয় (cricket scoring) কিন্তু ভিন্ন metaphor থেকে design inspiration নেওয়া হয়েছে: গ্লসি SaaS কার্ডের বদলে **stadium-এর পুরনো mechanical "flip/split-flap" scoreboard** আর **হাতে লেখা স্কোরবুকের ledger পাতা** থেকে অনুপ্রাণিত।

### Design Token System

| Token | Value / Choice |
|---|---|
| **Pitch** (primary bg) | `#12261E` — deep pitch-green, ঘাসের রাতের ছায়ার মতো, gradient বা glass card নয় |
| **Chalk** (surface/card bg) | `#EDEAE0` — greyish chalk-white (cream+terracotta AI-default থেকে সরানোর জন্য warm-cream এড়ানো হয়েছে) |
| **Ink** (text) | `#1B1B18` — প্রায়-কালো ইঙ্ক, pure black না |
| **Flip-amber** (live/accent) | `#E2A73B` — পুরনো stadium scoreboard bulb-এর মতো amber, লাল/সবুজ গ্র্যাডিয়েন্ট না |
| **Boundary-red** (wicket/alert) | `#8C2F1B` — বল-সেলাইয়ের লাল, brick-red ঘেঁষা |
| **Willow** (secondary/muted) | `#6E7B6A` — bat-এর কাঠের মতো sage-green muted tone |

### Typography

- **Score digits (display)**: একটা tabular/monospace numeral face — যেমন *IBM Plex Mono* বা *Space Mono* — split-flap board-এর ডিজিটের মতো fixed-width, বড় সাইজে বসবে। এটাই page-এর সবচেয়ে characterful অংশ।
- **Headings/body**: একটা humanist sans — যেমন *General Sans*, *Inter*, বা *Fraunces-এর sans variant* না নিয়ে বরং **Newsreader বা Source Serif-এর মতো একটা low-key serif** body copy-তে (scorebook ledger-এর printed-page feel দেওয়ার জন্য), headline sans-এ।
- Emoji icon ব্যবহার না করে — সাধারণ line-icon set (Lucide) বা custom SVG (bat, ball-seam, stump silhouette) ব্যবহার করা, যাতে original সাইটের emoji-heavy style থেকে আলাদা থাকে।

### Layout Concept

- Hero: গ্লসি "LIVE" score card-এর বদলে, top-এ একটা **horizontal split-flap scoreboard strip** — টিমের নাম, রান, উইকেট, ওভার প্রতিটা আলাদা "flip tile"-এ, পেজ লোড হওয়ার সময় ডিজিটগুলো mechanically flip করে বসবে (একটাই বড় signature animation, বাকি পেজ শান্ত থাকবে)।
- Stat sections (batting/bowling card, partnerships): গ্লসি card grid না, বরং **ledger-table** — hairline horizontal rules, ধারাবাহিক row numbering, printed-scorebook টাইপ layout।
- Section dividers: গ্র্যাডিয়েন্ট বা shadow না — একটা thin **stitched-seam pattern** (বলের সেলাইয়ের অনুকরণে dashed double-line) divider হিসেবে ব্যবহার করা যায়, যেটা subject-নির্দিষ্ট আর literal কার্ড-শ্যাডো ট্রেন্ড থেকে দূরে।
- Numbered process steps (Create → Score → Share ইত্যাদি): "01/02/03" বদলে **over.ball notation** ব্যবহার করা যায় — যেমন 1.1, 1.2, 1.3 — যেটা genuinely cricket-এর নিজস্ব sequencing ভাষা, decorative numbering না।

### Signature Element

**একটাই jaw-drop মুহূর্ত**: হোমপেজ লোড হওয়ার সময় হিরো স্কোরবোর্ডের ডিজিটগুলো একে একে mechanically flip করে আসল স্কোরে গিয়ে থামে (split-flap animation), ঠিক যেমন পুরনো স্টেডিয়ামের ম্যানুয়াল স্কোরবোর্ডে হয়। এর বাইরে বাকি পুরো পেজ শান্ত, flat, animation-heavy না — যাতে "AI বানিয়েছে" feel না আসে।

### AI Prompt Addendum — UI ডিজাইনের জন্য

উপরের section 6-এর build-prompt-এর সাথে এই অংশটা যোগ করে দাও (আলাদা করে দিলেও চলবে, বা section 6-এর "TECH REQUIREMENTS"-এর নিচে জুড়ে দিতে পারো):

```
UI / VISUAL DESIGN DIRECTION (do NOT copy any existing cricket-scoring
product's look — this must be a distinct, original visual identity):

Theme: a stadium mechanical "split-flap" scoreboard crossed with a
handwritten scorer's ledger book. Avoid glossy SaaS gradient cards, emoji
icons, and dark-mode-with-neon-accent — those are generic AI-design
defaults, not this brief.

Palette (use exactly these, no gradients as primary surfaces):
- Pitch green background: #12261E
- Chalk surface: #EDEAE0
- Ink text: #1B1B18
- Flip-amber accent (for "live" state only): #E2A73B
- Boundary-red (wickets/alerts only): #8C2F1B
- Willow muted/secondary: #6E7B6A

Typography:
- Score digits: a tabular monospace face (e.g. IBM Plex Mono / Space Mono),
  large size, fixed-width, styled to evoke mechanical flip-board digits.
- Body copy: a restrained serif (e.g. Source Serif 4 / Newsreader) for a
  printed-ledger feel.
- Headings: a plain humanist sans (e.g. Inter / General Sans).
- No emoji as icons — use a single consistent line-icon set (e.g. Lucide)
  or custom minimal SVGs (bat, ball seam, stump).

Signature interaction: on the homepage/live-scorecard load, the score
digits animate in as a mechanical split-flap flip (each digit cycles
through a few values before settling), like a stadium manual scoreboard.
This is the one big animated moment on the page — everything else should
be calm, static, and precise (no scroll-triggered fade-ins everywhere, no
floating gradient blobs).

Layout notes:
- Batting/bowling/partnership stats render as a ledger-style table with
  hairline rules and row numbering, not card grids with shadows.
- Section dividers use a stitched double-dashed line motif (referencing a
  cricket ball's seam) instead of drop shadows or gradients.
- Any step-by-step / process UI should use cricket's own notation for
  sequence (e.g. "1.1, 1.2, 1.3" over.ball style) instead of generic 01/02/03
  numbering, since that's a real domain-specific sequencing convention.
- Keep the whole design responsive down to mobile (this is used pitch-side
  on a phone), with visible keyboard focus states and reduced-motion
  support for the split-flap animation.
```

---

## 9. পরবর্তী ধাপ (Optional)

চাইলে আমি এখনই বানিয়ে দিতে পারি:
- PostgreSQL schema-র আসল `.sql` ফাইল
- Scoring engine-এর একটা working JavaScript/TypeScript prototype (delivery log → stats calculator)
- একটা basic React scoring UI mockup — উপরের নতুন split-flap/ledger design direction অনুযায়ী

বলো কোনটা দিয়ে শুরু করতে চাও।
