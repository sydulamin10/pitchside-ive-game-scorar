/** One typed function per backend route. Nothing in the UI builds a URL itself. */

import { api, clearSession, setSession } from "./client";
import type {
  BracketNode,
  CoinFlipResult,
  DeliveryInput,
  DeliveryLogEntry,
  DeliveryUpdateInput,
  MatchCreateInput,
  MatchListItem,
  MatchSnapshot,
  MatchStatus,
  MatchUpdateInput,
  Message,
  OverlayState,
  Participant,
  Player,
  PublicTournament,
  Readiness,
  ScoringResponse,
  SessionInfo,
  SpinWheelResult,
  Standings,
  Team,
  TokenResponse,
  Tournament,
  TournamentFormat,
  User,
} from "./types";

// -------------------------------------------------------------------- auth

export const auth = {
  async register(input: {
    email: string;
    password: string;
    display_name: string;
    timezone?: string;
  }): Promise<TokenResponse> {
    const tokens = await api.post<TokenResponse>("/auth/register", input, { auth: false });
    setSession(tokens);
    return tokens;
  },

  async login(input: { email: string; password: string }): Promise<TokenResponse> {
    const tokens = await api.post<TokenResponse>("/auth/login", input, { auth: false });
    setSession(tokens);
    return tokens;
  },

  async logout(): Promise<void> {
    try {
      await api.post<Message>("/auth/logout", {});
    } finally {
      // Whatever the server said, this device is signed out.
      clearSession();
    }
  },

  logoutEverywhere: () => api.post<Message>("/auth/logout-all", {}),
  me: () => api.get<User>("/users/me"),
  sessions: () => api.get<SessionInfo[]>("/users/me/sessions"),
  revokeSession: (id: string) => api.delete<Message>(`/users/me/sessions/${id}`),
  changePassword: (input: { current_password: string; new_password: string }) =>
    api.post<Message>("/users/me/password", input),
};

// ------------------------------------------------------------------- teams

export const teams = {
  list: () => api.get<Team[]>("/teams"),
  get: (id: string) => api.get<Team>(`/teams/${id}`),
  create: (input: {
    name: string;
    short_name?: string | null;
    primary_color?: string | null;
    home_ground?: string | null;
    players?: Array<{ name: string; role?: string }>;
  }) => api.post<Team>("/teams", input),
  update: (id: string, input: Record<string, unknown>) =>
    api.patch<Team>(`/teams/${id}`, input),
  remove: (id: string) => api.delete<Message>(`/teams/${id}`),
  addPlayer: (teamId: string, input: { name: string; role?: string }) =>
    api.post<Player>(`/teams/${teamId}/players`, input),
  updatePlayer: (teamId: string, playerId: string, input: Record<string, unknown>) =>
    api.patch<Player>(`/teams/${teamId}/players/${playerId}`, input),
  removePlayer: (teamId: string, playerId: string) =>
    api.delete<Message>(`/teams/${teamId}/players/${playerId}`),
};

// ----------------------------------------------------------------- matches

export const matches = {
  list: (params: { status?: MatchStatus; tournament_id?: string; limit?: number } = {}) =>
    api.get<MatchListItem[]>("/matches", { query: { ...params } }),
  create: (input: MatchCreateInput) => api.post<MatchSnapshot>("/matches", input),
  get: (id: string) => api.get<MatchSnapshot>(`/matches/${id}`),
  update: (id: string, input: MatchUpdateInput) =>
    api.patch<MatchSnapshot>(`/matches/${id}`, input),
  remove: (id: string) => api.delete<Message>(`/matches/${id}`),
  replaceSquad: (
    id: string,
    input: {
      team_id: string;
      players: Array<{
        player_id?: string | null;
        name?: string | null;
        batting_order?: number | null;
        is_captain?: boolean;
        is_wicket_keeper?: boolean;
        is_playing?: boolean;
      }>;
    },
  ) => api.put<MatchSnapshot>(`/matches/${id}/squad`, input),
  startInnings: (
    id: string,
    input: {
      batting_team_id?: string | null;
      overs_limit?: number | null;
      target_runs?: number | null;
      is_super_over?: boolean;
      is_follow_on?: boolean;
    } = {},
  ) => api.post<MatchSnapshot>(`/matches/${id}/innings`, input),
  closeInnings: (
    id: string,
    inningsId: string,
    input: { end_reason?: string; note?: string | null } = {},
  ) => api.post<MatchSnapshot>(`/matches/${id}/innings/${inningsId}/close`, input),
  reviseInnings: (
    id: string,
    inningsId: string,
    query: { overs_limit?: number; target_runs?: number },
  ) =>
    api.post<MatchSnapshot>(`/matches/${id}/innings/${inningsId}/revise`, undefined, { query }),
  abandon: (id: string, input: { result_summary?: string | null } = {}) =>
    api.post<MatchSnapshot>(`/matches/${id}/abandon`, input),
  rebuild: (id: string) => api.post<MatchSnapshot>(`/matches/${id}/rebuild`, {}),
  addCollaborator: (id: string, input: { email: string; role?: "scorer" | "viewer" }) =>
    api.post<Message>(`/matches/${id}/collaborators`, input),
  deliveries: (
    id: string,
    query: { innings_id?: string; limit?: number; offset?: number } = {},
  ) =>
    api.get<{
      items: DeliveryLogEntry[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    }>(`/matches/${id}/deliveries`, { query }),
  revisions: (id: string) =>
    api.get<{
      items: Array<{
        id: string;
        delivery_id: string;
        revision: number;
        change_kind: string;
        reason: string | null;
        created_at: string;
        previous_state: Record<string, unknown> | null;
        new_state: Record<string, unknown> | null;
      }>;
    }>(`/matches/${id}/revisions`),
};

// ----------------------------------------------------------------- scoring

export const scoring = {
  record: (matchId: string, ball: DeliveryInput) =>
    api.post<ScoringResponse>(`/matches/${matchId}/deliveries`, ball),
  /** Drain an offline queue. The server replays in order and reports duplicates. */
  sync: (matchId: string, deliveries: DeliveryInput[], stopOnError = false) =>
    api.post<ScoringResponse>(`/matches/${matchId}/deliveries/sync`, {
      deliveries,
      stop_on_error: stopOnError,
    }),
  edit: (matchId: string, deliveryId: string, input: DeliveryUpdateInput) =>
    api.patch<ScoringResponse>(`/matches/${matchId}/deliveries/${deliveryId}`, input),
  remove: (matchId: string, deliveryId: string, reason?: string) =>
    api.delete<ScoringResponse>(`/matches/${matchId}/deliveries/${deliveryId}`, {
      query: { reason },
    }),
  undo: (matchId: string, inningsId?: string) =>
    api.post<ScoringResponse>(`/matches/${matchId}/undo`, { innings_id: inningsId ?? null }),
};

// ------------------------------------------------------------- tournaments

export const tournaments = {
  list: () => api.get<Tournament[]>("/tournaments"),
  get: (id: string) => api.get<Tournament>(`/tournaments/${id}`),
  create: (input: {
    name: string;
    description?: string | null;
    tournament_format: TournamentFormat;
    venue?: string | null;
    default_overs_limit?: number | null;
    teams_advancing_per_group?: number;
    team_ids?: string[];
    groups?: string[];
    points?: {
      points_per_win: number;
      points_per_tie: number;
      points_per_loss: number;
      points_per_no_result: number;
      use_net_run_rate: boolean;
    };
  }) => api.post<Tournament>("/tournaments", input),
  update: (id: string, input: Record<string, unknown>) =>
    api.patch<Tournament>(`/tournaments/${id}`, input),
  remove: (id: string) => api.delete<Message>(`/tournaments/${id}`),
  addGroup: (id: string, input: { name: string; ordinal?: number }) =>
    api.post<{ id: string; name: string; ordinal: number }>(`/tournaments/${id}/groups`, input),
  participants: (id: string) => api.get<Participant[]>(`/tournaments/${id}/participants`),
  addParticipants: (
    id: string,
    participants: Array<{ team_id: string; group_id?: string | null; seed?: number | null }>,
  ) => api.post<Participant[]>(`/tournaments/${id}/participants`, { participants }),
  removeParticipant: (id: string, teamId: string) =>
    api.delete<Message>(`/tournaments/${id}/participants/${teamId}`),
  adjustPoints: (
    id: string,
    input: { team_id: string; points_adjustment: number; note?: string },
  ) => api.post<Message>(`/tournaments/${id}/points-adjustment`, input),
  fixtures: (id: string) => api.get<MatchListItem[]>(`/tournaments/${id}/matches`),
  createFixtures: (
    id: string,
    fixtures: Array<{
      team_a_id: string;
      team_b_id: string;
      scheduled_at?: string | null;
      venue?: string | null;
      round_label?: string | null;
      overs_limit?: number | null;
    }>,
  ) => api.post<MatchListItem[]>(`/tournaments/${id}/fixtures`, { fixtures }),
  generateRoundRobin: (
    id: string,
    input: {
      double_round?: boolean;
      start_date?: string | null;
      interval_minutes?: number;
      venue?: string | null;
      overs_limit?: number | null;
    } = {},
  ) => api.post<MatchListItem[]>(`/tournaments/${id}/fixtures/round-robin`, input),
  standings: (id: string) => api.get<Standings>(`/tournaments/${id}/standings`),
  bracket: (id: string) => api.get<BracketNode[]>(`/tournaments/${id}/bracket`),
  generateBracket: (
    id: string,
    input: {
      teams_advancing_per_group?: number | null;
      include_third_place?: boolean;
      seed_from_standings?: boolean;
    } = {},
  ) => api.post<BracketNode[]>(`/tournaments/${id}/bracket`, input),
  updateBracketSlot: (id: string, bracketId: string, input: Record<string, unknown>) =>
    api.patch<BracketNode>(`/tournaments/${id}/bracket/${bracketId}`, input),
};

// ------------------------------------------------------------------ public

export const publicApi = {
  match: (slug: string) => api.public<MatchSnapshot>(`/public/matches/${slug}`),
  overlay: (slug: string) => api.public<OverlayState>(`/public/matches/${slug}/overlay`),
  tournament: (slug: string) => api.public<PublicTournament>(`/public/tournaments/${slug}`),
  standings: (slug: string) => api.public<Standings>(`/public/tournaments/${slug}/standings`),
};

// ------------------------------------------------------------------- tools

export const tools = {
  coinFlip: (input: { call?: "heads" | "tails" | null; called_by?: string | null } = {}) =>
    api.public<CoinFlipResult>("/tools/coin-flip", { method: "POST", body: input }),
  spinWheel: (input: { options: string[]; picks?: number; shuffle_all?: boolean }) =>
    api.public<SpinWheelResult>("/tools/spin-wheel", { method: "POST", body: input }),
};

export const health = {
  ready: () => api.public<Readiness>("/health/ready"),
};
