/**
 * The API contract, transcribed from the FastAPI schemas.
 *
 * These types are hand-written rather than generated so the shapes the UI
 * depends on are reviewable in one place; `spec/scoring-fixtures.json` and the
 * backend tests are what keep them honest.
 */

// ------------------------------------------------------------------- enums

export const MATCH_FORMATS = [
  "t20",
  "t10",
  "odi",
  "test",
  "box",
  "turf",
  "gully",
  "tape_ball",
  "tennis_ball",
  "custom",
] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

export const MATCH_FORMAT_LABELS: Record<MatchFormat, string> = {
  t20: "T20",
  t10: "T10",
  odi: "ODI",
  test: "Test",
  box: "Box",
  turf: "Turf",
  gully: "Gully",
  tape_ball: "Tape ball",
  tennis_ball: "Tennis ball",
  custom: "Custom",
};

export type MatchStatus = "setup" | "live" | "innings_break" | "completed" | "abandoned";
export type TossDecision = "bat" | "bowl";
export type InningsStatus = "pending" | "in_progress" | "completed";
export type InningsEndReason =
  "overs_complete" | "all_out" | "target_reached" | "declared" | "rain" | "forfeit" | "other";

export const EXTRA_TYPES = ["wide", "no_ball", "bye", "leg_bye", "penalty"] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

export const WICKET_TYPES = [
  "bowled",
  "caught",
  "caught_and_bowled",
  "lbw",
  "stumped",
  "hit_wicket",
  "run_out",
  "obstructing_the_field",
  "hit_ball_twice",
  "timed_out",
  "retired_out",
  "retired_hurt",
] as const;
export type WicketType = (typeof WICKET_TYPES)[number];

export const WICKET_TYPE_LABELS: Record<WicketType, string> = {
  bowled: "Bowled",
  caught: "Caught",
  caught_and_bowled: "Caught & bowled",
  lbw: "LBW",
  stumped: "Stumped",
  hit_wicket: "Hit wicket",
  run_out: "Run out",
  obstructing_the_field: "Obstructing the field",
  hit_ball_twice: "Hit the ball twice",
  timed_out: "Timed out",
  retired_out: "Retired out",
  retired_hurt: "Retired hurt",
};

/** Dismissals that need a fielder named. */
export const WICKETS_NEEDING_FIELDER: readonly WicketType[] = [
  "caught",
  "run_out",
  "stumped",
] as const;

export type NextAction =
  "select_openers" | "select_bowler" | "select_batter" | "record_delivery" | "innings_complete";

export type BatterStatus = "not_out" | "out" | "retired_hurt" | "did_not_bat";
export type MatchResultType =
  "win" | "tie" | "draw" | "no_result" | "abandoned" | "forfeit" | "super_over";
export type TournamentFormat = "league" | "group_knockout" | "knockout";
export type TournamentStatus = "draft" | "active" | "completed" | "archived";
export type BracketRound =
  "round_of_16" | "quarter_final" | "semi_final" | "third_place" | "final";
export type CollaboratorRole = "owner" | "scorer" | "viewer";
export type PlayerRole = "batter" | "bowler" | "allrounder" | "wicket_keeper" | "unknown";

// -------------------------------------------------------------------- auth

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  is_email_verified: boolean;
  timezone: string;
  created_at: string;
  last_login_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string | null;
  user: User;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
  is_current: boolean;
}

// ------------------------------------------------------------------- teams

export interface Player {
  id: string;
  team_id: string;
  name: string;
  nickname: string | null;
  public_slug: string | null;
  role: PlayerRole;
  batting_hand: "right" | "left" | null;
  bowling_style: string | null;
  jersey_number: number | null;
  sort_order: number;
  is_active: boolean;
  photo_url: string | null;
  cover_url: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  location: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  career_summary: string | null;
  social_links: Record<string, string>;
  profile_url: string | null;
}

export interface Team {
  id: string;
  name: string;
  short_name: string | null;
  public_slug: string | null;
  logo_url: string | null;
  cover_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  home_ground: string | null;
  founded_year: number | null;
  description: string | null;
  coach_name: string | null;
  manager_name: string | null;
  owner_label: string | null;
  sponsor: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: Record<string, string>;
  created_at: string;
  profile_url: string | null;
  players: Player[];
}

export interface PublicPlayerProfile extends Omit<Player, "team_id" | "sort_order" | "is_active"> {
  team: {
    id: string;
    name: string;
    short_name: string | null;
    public_slug: string | null;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    profile_url: string | null;
  } | null;
}

export type PublicClubProfile = Omit<Team, "contact_email" | "contact_phone" | "created_at">;

export interface MediaUploadUrl {
  upload_url: string;
  public_url: string;
  method: "PUT";
  headers: Record<string, string>;
  object_key: string;
  expires_at: string;
  backend: "local" | "r2";
}

export type TeamMemberRole =
  | "owner"
  | "manager"
  | "coach"
  | "captain"
  | "vice_captain"
  | "player";

export type MembershipStatus = "active" | "invited" | "requested" | "rejected" | "left";

export interface TeamMembership {
  id: string;
  team_id: string;
  user_id: string | null;
  player_id: string | null;
  role: TeamMemberRole;
  status: MembershipStatus;
  invited_email: string | null;
  invite_token: string | null;
  invited_by_user_id: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface PlayerAward {
  id: string;
  player_id: string;
  team_id: string | null;
  kind: "trophy" | "certificate" | "achievement";
  title: string;
  description: string | null;
  awarded_at: string;
  image_url: string | null;
}

export interface CareerStats {
  batting?: Record<string, number | string | null>;
  bowling?: Record<string, number | string | null>;
  fielding?: Record<string, number | string | null>;
  recent_matches?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BroadcastSession {
  id: string;
  match_id: string;
  status: "idle" | "preview" | "live" | "ended" | "error";
  destination_label: string | null;
  rtmp_url: string | null;
  whip_path: string | null;
  whip_publish_url: string | null;
  has_stream_key: boolean;
  stream_key?: string;
  camera_token: string | null;
  camera_url: string | null;
  camera_qr_url?: string | null;
  publisher_claimed_at: string | null;
  last_error: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_by_user_id: string;
  created_at: string;
}

export interface CameraInvite {
  slug: string;
  match_id: string;
  title: string;
  status: string;
  publisher_claimed: boolean;
  whip_publish_url: string | null;
  destination_label: string | null;
  camera_url: string;
}

export interface MatchAwards {
  result_summary?: string | null;
  man_of_the_match?: {
    player_id: string;
    name: string;
    photo_url?: string | null;
    rating?: number;
    stat?: string;
  } | null;
  best_batter?: {
    player_id: string;
    name: string;
    photo_url?: string | null;
    stat?: string;
  } | null;
  best_bowler?: {
    player_id: string;
    name: string;
    photo_url?: string | null;
    stat?: string;
  } | null;
  best_fielder?: {
    player_id: string;
    name: string;
    photo_url?: string | null;
    stat?: string;
  } | null;
  mvp_ratings?: Array<{
    player_id: string;
    name: string;
    photo_url?: string | null;
    rating: number;
  }>;
  innings?: Array<{
    sequence: number;
    batting_team: string;
    bowling_team: string;
    score: string;
    overs_text: string;
    overs: Array<{ over_number: number; runs: number; wickets: number }>;
  }>;
}


// ----------------------------------------------------------------- scoring

export interface TeamBadge {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

export interface MatchRules {
  overs_limit: number | null;
  balls_per_over: number;
  players_per_side: number;
  max_overs_per_bowler: number | null;
  wide_penalty_runs: number;
  no_ball_penalty_runs: number;
  free_hit_after_no_ball: boolean;
  allow_boundaries: boolean;
  last_batter_can_bat_alone: boolean;
  dls_enabled: boolean;
  overrides: Record<string, unknown>;
}

export interface MatchHeader {
  id: string;
  slug: string;
  title: string;
  status: MatchStatus;
  format: MatchFormat;
  venue: string | null;
  city: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  state_version: number;
  share_url: string;
  tournament: { id: string; name: string; slug: string; round: string | null } | null;
  teams: { a: TeamBadge; b: TeamBadge };
  toss: { winner_team_id: string | null; decision: TossDecision | null };
  rules: MatchRules;
}

export interface MatchResult {
  type: MatchResultType | null;
  winner_team_id: string | null;
  summary: string;
  margin_runs: number | null;
  margin_wickets: number | null;
  is_decided: boolean;
}

export interface SquadMember {
  id: string;
  player_id: string | null;
  team_id: string;
  name: string;
  batting_order: number;
  is_captain: boolean;
  is_wicket_keeper: boolean;
  is_playing: boolean;
  is_substitute: boolean;
}

export interface BatterCard {
  player_id: string;
  name: string;
  batting_position: number;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  dots: number;
  strike_rate: number;
  status: BatterStatus;
  is_out: boolean;
  has_batted: boolean;
  wicket_type: WicketType | null;
  dismissal_text: string | null;
  dismissed_by_bowler_id: string | null;
  fielder_id: string | null;
  is_striker: boolean;
  is_non_striker: boolean;
}

export interface BowlerCard {
  player_id: string;
  name: string;
  balls_bowled: number;
  overs_text: string;
  overs_decimal: number;
  runs_conceded: number;
  wickets: number;
  maidens: number;
  wides: number;
  no_balls: number;
  dots: number;
  fours_conceded: number;
  sixes_conceded: number;
  economy: number;
  is_current_bowler: boolean;
}

export interface Partnership {
  wicket_number: number;
  batter_a_id: string;
  batter_a_name: string;
  batter_a_runs: number;
  batter_b_id: string | null;
  batter_b_name: string | null;
  batter_b_runs: number;
  runs: number;
  balls: number;
  is_current: boolean;
}

export interface FallOfWicket {
  wicket_number: number;
  runs_at_fall: number;
  overs_text: string;
  batter_id: string;
  batter_name: string;
  dismissal_text: string;
}

export interface Extras {
  wide: number;
  no_ball: number;
  bye: number;
  leg_bye: number;
  penalty: number;
  total: number;
}

export interface BallSummary {
  delivery_id: string;
  sequence: number;
  over_number: number;
  ball_in_over: number;
  over_ball_text: string;
  display: string;
  runs_total: number;
  batter_runs: number;
  extra_type: ExtraType | null;
  extra_runs: number;
  is_wicket: boolean;
  is_legal: boolean;
  is_free_hit: boolean;
  striker_id: string;
  striker_name: string;
  bowler_id: string;
  bowler_name: string;
  commentary: string | null;
}

export interface OverSummary {
  over_number: number;
  bowler_id: string;
  bowler_name: string;
  runs: number;
  wickets: number;
  is_maiden: boolean;
  is_complete: boolean;
  balls: BallSummary[];
}

export interface InningsState {
  total_runs: number;
  wickets: number;
  legal_balls: number;
  balls_per_over: number;
  overs_text: string;
  overs_decimal: number;
  run_rate: number;
  required_run_rate: number | null;
  projected_score: number | null;
  balls_remaining: number | null;
  wickets_remaining: number;
  runs_needed: number | null;
  target_runs: number | null;
  overs_limit: number | null;
  max_wickets: number;
  is_all_out: boolean;
  is_complete: boolean;
  end_reason: InningsEndReason | null;
  next_action: NextAction;
  is_free_hit: boolean;
  striker_id: string | null;
  non_striker_id: string | null;
  current_bowler_id: string | null;
  previous_over_bowler_id: string | null;
  extras: Extras;
  batting: BatterCard[];
  bowling: BowlerCard[];
  partnerships: Partnership[];
  current_partnership: Partnership | null;
  fall_of_wickets: FallOfWicket[];
  available_batter_ids: string[];
  ineligible_bowler_ids: string[];
  warnings: string[];
  overs: OverSummary[];
  /** Present on the full scorecard. */
  timeline?: BallSummary[];
  /** Present instead of `timeline` on compact payloads. */
  recent_balls?: BallSummary[];
}

export interface InningsSnapshot {
  id: string;
  sequence: number;
  status: InningsStatus;
  batting_team_id: string;
  bowling_team_id: string;
  batting_team_name: string;
  bowling_team_name: string;
  is_super_over: boolean;
  is_follow_on: boolean;
  overs_limit: number | null;
  target_runs: number | null;
  /** Runs awarded outside any delivery; the local engine needs them to match. */
  penalty_runs: number;
  end_reason: InningsEndReason | null;
  state: InningsState;
}

/** The full scorecard: what the console and the public page both render. */
export interface MatchSnapshot {
  match: MatchHeader;
  result: MatchResult;
  innings: InningsSnapshot[];
  current_innings_id: string | null;
  squads?: Record<string, SquadMember[]>;
}

export interface BatterLine {
  player_id: string;
  name: string;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  strike_rate: number;
  photo_url?: string | null;
  jersey_number?: number | null;
}

export interface BowlerLine {
  player_id: string;
  name: string;
  overs_text: string;
  runs_conceded: number;
  wickets: number;
  economy: number;
  maidens: number;
  photo_url?: string | null;
  jersey_number?: number | null;
}


/** The realtime frame. Small on purpose: it travels over mobile data. */
export interface CompactState {
  status: MatchStatus;
  state_version: number;
  innings_id?: string;
  innings_sequence?: number;
  title?: string;
  venue?: string | null;
  city?: string | null;
  tournament?: {
    id: string;
    name: string;
    slug: string;
    round: string | null;
  } | null;
  toss?: {
    winner?: TeamBadge | null;
    winner_team_id?: string | null;
    decision?: TossDecision | null;
  } | null;
  batting_team?: TeamBadge;
  bowling_team?: TeamBadge;
  score?: {
    runs: number;
    wickets: number;
    overs_text: string;
    run_rate: number;
    required_run_rate: number | null;
    target_runs: number | null;
    runs_needed: number | null;
    balls_remaining: number | null;
    extras_total: number;
    is_free_hit: boolean;
  };
  striker?: BatterLine | null;
  non_striker?: BatterLine | null;
  bowler?: BowlerLine | null;
  current_partnership?: Partnership | null;
  recent_balls?: BallSummary[];
  result_summary?: string | null;
  next_action?: NextAction;
}

export interface OverlayState {
  status: MatchStatus;
  state_version: number;
  batting: Pick<TeamBadge, "name" | "short_name" | "logo_url" | "primary_color">;
  bowling: Pick<TeamBadge, "name" | "short_name" | "logo_url" | "primary_color">;
  score_text: string;
  overs_text: string | null;
  run_rate: number | null;
  required_run_rate: number | null;
  target_runs: number | null;
  runs_needed: number | null;
  balls_remaining: number | null;
  is_free_hit: boolean | null;
  striker: BatterLine | null;
  non_striker: BatterLine | null;
  bowler: BowlerLine | null;
  partnership: Partnership | null;
  recent_balls: string[];
  result_summary: string | null;
}

// ------------------------------------------------------------- match lists

export interface MatchListItem {
  id: string;
  public_slug: string;
  title: string | null;
  status: MatchStatus;
  match_format: MatchFormat;
  venue: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  state_version: number;
  team_a_name: string | null;
  team_b_name: string | null;
  team_a_id: string;
  team_b_id: string;
  tournament_id: string | null;
  score_line: string | null;
}

// ------------------------------------------------------------- write bodies

export interface SquadPlayerInput {
  player_id?: string | null;
  name?: string | null;
  batting_order?: number | null;
  is_captain?: boolean;
  is_wicket_keeper?: boolean;
  is_playing?: boolean;
}

export interface MatchTeamInput {
  team_id?: string | null;
  name?: string | null;
  short_name?: string | null;
  players: SquadPlayerInput[];
}

export interface MatchRulesInput {
  overs_limit?: number | null;
  balls_per_over?: number;
  players_per_side?: number;
  max_overs_per_bowler?: number | null;
  wide_penalty_runs?: number;
  no_ball_penalty_runs?: number;
  free_hit_after_no_ball?: boolean;
  allow_boundaries?: boolean;
  last_batter_can_bat_alone?: boolean;
  dls_enabled?: boolean;
  overrides?: Record<string, unknown>;
}

export interface MatchCreateInput {
  title?: string | null;
  venue?: string | null;
  city?: string | null;
  match_format: MatchFormat;
  rules: MatchRulesInput;
  team_a: MatchTeamInput;
  team_b: MatchTeamInput;
  toss?: { winner_team_id: string; decision: TossDecision } | null;
  scheduled_at?: string | null;
  tournament_id?: string | null;
  tournament_round?: string | null;
}

export interface MatchUpdateInput {
  title?: string | null;
  venue?: string | null;
  city?: string | null;
  scheduled_at?: string | null;
  rules?: MatchRulesInput | null;
  toss?: { winner_team_id: string; decision: TossDecision } | null;
  expected_state_version?: number | null;
}

/** One ball, exactly as the console records it. */
export interface DeliveryInput {
  striker_id: string;
  non_striker_id: string;
  bowler_id: string;
  batter_runs?: number;
  extra_type?: ExtraType | null;
  extra_runs?: number;
  is_boundary?: boolean;
  batters_crossed?: boolean | null;
  is_wicket?: boolean;
  wicket_type?: WicketType | null;
  dismissed_player_id?: string | null;
  fielder_id?: string | null;
  replacement_batter_id?: string | null;
  commentary?: string | null;
  client_event_id?: string;
  occurred_at?: string;
  expected_state_version?: number | null;
}

export interface DeliveryUpdateInput {
  striker_id?: string;
  non_striker_id?: string;
  bowler_id?: string;
  batter_runs?: number;
  extra_type?: ExtraType | null;
  clear_extra?: boolean;
  extra_runs?: number;
  is_boundary?: boolean;
  batters_crossed?: boolean | null;
  clear_batters_crossed?: boolean;
  is_wicket?: boolean;
  wicket_type?: WicketType | null;
  dismissed_player_id?: string | null;
  fielder_id?: string | null;
  replacement_batter_id?: string | null;
  commentary?: string | null;
  reason?: string | null;
  expected_state_version?: number | null;
}

export interface DeliveryRejection {
  client_event_id: string | null;
  index: number;
  code: string;
  message: string;
}

export interface ScoringResult {
  delivery_id: string | null;
  state_version: number;
  accepted: number;
  duplicates: number;
  rejected: DeliveryRejection[];
}

/** Every scoring write returns the result plus the new state. */
export interface ScoringResponse {
  result: ScoringResult;
  state: MatchSnapshot;
}

export interface DeliveryLogEntry {
  id: string;
  innings_id: string;
  sequence: number;
  striker_id: string;
  non_striker_id: string;
  bowler_id: string;
  batter_runs: number;
  extra_type: ExtraType | null;
  extra_runs: number;
  is_boundary: boolean;
  batters_crossed: boolean | null;
  is_wicket: boolean;
  wicket_type: WicketType | null;
  dismissed_player_id: string | null;
  fielder_id: string | null;
  replacement_batter_id: string | null;
  commentary: string | null;
  revision: number;
  created_at: string;
}

// ------------------------------------------------------------- tournaments

export interface TournamentGroup {
  id: string;
  name: string;
  ordinal: number;
}

export interface Tournament {
  id: string;
  public_slug: string;
  name: string;
  description: string | null;
  tournament_format: TournamentFormat;
  status: TournamentStatus;
  venue: string | null;
  logo_url: string | null;
  default_overs_limit: number | null;
  default_max_overs_per_bowler: number | null;
  points_per_win: number;
  points_per_tie: number;
  points_per_loss: number;
  points_per_no_result: number;
  use_net_run_rate: boolean;
  teams_advancing_per_group: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  groups: TournamentGroup[];
  share_url: string | null;
  team_count: number;
  match_count: number;
}

export interface Participant {
  id: string;
  team_id: string;
  team_name: string;
  short_name: string | null;
  logo_url: string | null;
  group_id: string | null;
  group_name: string | null;
  seed: number | null;
  points_adjustment: number;
}

export interface StandingRow {
  team_id: string;
  team_name: string;
  group_id: string | null;
  group_name: string | null;
  position: number;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_result: number;
  points: number;
  points_adjustment: number;
  runs_scored: number;
  overs_faced: number;
  runs_conceded: number;
  overs_bowled: number;
  run_rate_for: number;
  run_rate_against: number;
  net_run_rate: number;
  form: string[];
}

export interface Standings {
  tournament: {
    id: string;
    name: string;
    slug: string;
    format: TournamentFormat;
    status: TournamentStatus;
    use_net_run_rate: boolean;
    teams_advancing_per_group: number;
    share_url: string;
  };
  groups: TournamentGroup[];
  standings: StandingRow[];
  computed_at: string;
}

export interface BracketNode {
  id: string;
  round: BracketRound;
  ordinal: number;
  label: string | null;
  team_a_id: string | null;
  team_a_name: string | null;
  team_b_id: string | null;
  team_b_name: string | null;
  source_a_label: string | null;
  source_b_label: string | null;
  match_id: string | null;
  match_slug: string | null;
  winner_team_id: string | null;
  next_bracket_match_id: string | null;
  scheduled_at: string | null;
  score_line: string | null;
}

export interface PublicFixture {
  id: string;
  slug: string;
  title: string | null;
  status: MatchStatus;
  round: string | null;
  scheduled_at: string | null;
  team_a: string | null;
  team_b: string | null;
  result_summary: string | null;
  share_url: string;
}

/** The public tournament page: standings, fixtures and bracket in one call. */
export interface PublicTournament extends Standings {
  fixtures: PublicFixture[];
  bracket: Array<{
    id: string;
    round: BracketRound;
    ordinal: number;
    label: string | null;
    team_a: string | null;
    team_b: string | null;
    winner_team_id: string | null;
    match_slug: string | null;
    scheduled_at: string | null;
  }>;
}

// ------------------------------------------------------------------- tools

export interface CoinFlipResult {
  result: "heads" | "tails";
  call: "heads" | "tails" | null;
  called_by: string | null;
  call_correct: boolean | null;
  flipped_at: string;
  receipt: string;
}

export interface SpinWheelResult {
  winners: string[];
  order: string[];
  spun_at: string;
  receipt: string;
}

// ------------------------------------------------------------------ health

export interface Readiness {
  status: "ok" | "degraded" | "error";
  checks: {
    database: { ok: boolean; latency_ms: number };
    cache: { ok: boolean; configured: boolean };
  };
  realtime: { subscribers: number };
  version: string;
}

export interface Message {
  message: string;
}
