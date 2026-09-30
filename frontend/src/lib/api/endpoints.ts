/** One typed function per backend route. Nothing in the UI builds a URL itself. */

import { api, API_BASE, clearSession, setSession } from "./client";
import type {
  BracketNode,
  BroadcastSession,
  CameraInvite,
  CameraJoin,
  CareerStats,
  CoinFlipResult,
  DeliveryInput,
  DeliveryLogEntry,
  DeliveryUpdateInput,
  FacebookAppSettings,
  FacebookSocialStatus,
  MatchAwards,
  MatchCreateInput,
  MatchListItem,
  MatchSnapshot,
  MatchStatus,
  MatchUpdateInput,
  Message,
  OverlayDirector,
  OverlayState,
  Participant,
  Player,
  PlayerAward,
  PublicTournament,
  Readiness,
  ScoringResponse,
  SessionInfo,
  SocialDestinationItem,
  SpinWheelResult,
  Standings,
  Team,
  TeamMembership,
  TokenResponse,
  Tournament,
  TournamentFormat,
  User,
  MediaUploadUrl,
  PublicClubProfile,
  PublicPlayerProfile,
  BillingAccount,
  BillingCoupon,
  BillingCouponInput,
  BillingEntitlement,
  BillingPayment,
  BillingPaymentInput,
  BillingPlanInfo,
  BillingQuote,
  BillingQuoteInput,
} from "./types";

// -------------------------------------------------------------------- auth

export const auth = {
  async register(input: {
    email: string;
    password: string;
    display_name: string;
    timezone?: string;
  }): Promise<TokenResponse | { pending_approval: true; message: string; user: User }> {
    const tokens = await api.post<TokenResponse | { pending_approval: true; message: string; user: User }>(
      "/auth/register",
      input,
      { auth: false },
    );
    if ("pending_approval" in tokens && tokens.pending_approval) {
      return tokens;
    }
    if ("access_token" in tokens && tokens.access_token) {
      setSession(tokens);
    }
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
    secondary_color?: string | null;
    home_ground?: string | null;
    logo_url?: string | null;
    cover_url?: string | null;
    founded_year?: number | null;
    description?: string | null;
    coach_name?: string | null;
    manager_name?: string | null;
    owner_label?: string | null;
    sponsor?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    social_links?: Record<string, string>;
    players?: Array<{ name: string; role?: string }>;
  }) => api.post<Team>("/teams", input),
  update: (id: string, input: Record<string, unknown>) =>
    api.patch<Team>(`/teams/${id}`, input),
  remove: (id: string) => api.delete<Message>(`/teams/${id}`),
  addPlayer: (
    teamId: string,
    input: {
      name: string;
      role?: string;
      nickname?: string | null;
      jersey_number?: number | null;
      photo_url?: string | null;
      batting_hand?: string | null;
      bowling_style?: string | null;
    },
  ) => api.post<Player>(`/teams/${teamId}/players`, input),
  updatePlayer: (teamId: string, playerId: string, input: Record<string, unknown>) =>
    api.patch<Player>(`/teams/${teamId}/players/${playerId}`, input),
  removePlayer: (teamId: string, playerId: string) =>
    api.delete<Message>(`/teams/${teamId}/players/${playerId}`),
};

export const media = {
  uploadUrl: (input: {
    kind: "team_logo" | "team_cover" | "player_photo" | "player_cover" | "generic";
    content_type: string;
    filename?: string;
    content_length?: number;
  }) => api.post<MediaUploadUrl>("/media/upload-url", input),

  async uploadFile(
    file: File,
    kind: "team_logo" | "team_cover" | "player_photo" | "player_cover" | "generic",
  ): Promise<string> {
    const signed = await media.uploadUrl({
      kind,
      content_type: file.type || "image/jpeg",
      filename: file.name,
      content_length: file.size,
    });
    const response = await fetch(signed.upload_url, {
      method: signed.method,
      headers: signed.headers,
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
    return signed.public_url;
  },
};

export const profiles = {
  club: (idOrSlug: string) =>
    api.get<PublicClubProfile>(`/public/teams/${idOrSlug}`, { auth: false }),
  player: (idOrSlug: string) =>
    api.get<PublicPlayerProfile>(`/public/players/${idOrSlug}`, { auth: false }),
  playerStats: (idOrSlug: string, lastN = 10) =>
    api.get<CareerStats>(`/public/players/${idOrSlug}/stats`, {
      auth: false,
      query: { last_n: lastN },
    }),
  playerAwards: (idOrSlug: string) =>
    api.get<PlayerAward[]>(`/public/players/${idOrSlug}/awards`, { auth: false }),
  playerQrUrl: (idOrSlug: string) =>
    `${API_BASE}/public/players/${encodeURIComponent(idOrSlug)}/qr`,
};

export const memberships = {
  list: (teamId: string) => api.get<TeamMembership[]>(`/teams/${teamId}/members`),
  invite: (teamId: string, input: { email: string; role?: string }) =>
    api.post<TeamMembership>(`/teams/${teamId}/invites`, input),
  acceptInvite: (token: string) => api.post<TeamMembership>(`/teams/invites/${token}/accept`, {}),
  requestJoin: (teamId: string) => api.post<TeamMembership>(`/teams/${teamId}/join-requests`, {}),
  decideRequest: (teamId: string, memberId: string, accept: boolean) =>
    api.post<TeamMembership>(
      `/teams/${teamId}/join-requests/${memberId}/${accept ? "accept" : "reject"}`,
      {},
    ),
  setRole: (teamId: string, memberId: string, role: string) =>
    api.patch<TeamMembership>(`/teams/${teamId}/members/${memberId}`, { role }),
  remove: (teamId: string, memberId: string) =>
    api.delete<Message>(`/teams/${teamId}/members/${memberId}`),
};

export const awards = {
  list: (teamId: string, playerId: string) =>
    api.get<PlayerAward[]>(`/teams/${teamId}/players/${playerId}/awards`),
  create: (
    teamId: string,
    playerId: string,
    input: { kind?: string; title: string; description?: string | null },
  ) => api.post<PlayerAward>(`/teams/${teamId}/players/${playerId}/awards`, input),
  remove: (teamId: string, playerId: string, awardId: string) =>
    api.delete<Message>(`/teams/${teamId}/players/${playerId}/awards/${awardId}`),
};

export const broadcast = {
  getActive: (matchId: string) =>
    api.get<BroadcastSession>(`/matches/${matchId}/stream-sessions/active`),
  ensure: (matchId: string) =>
    api.post<BroadcastSession>(`/matches/${matchId}/stream-sessions/ensure`, {}),
  create: (
    matchId: string,
    input: {
      destination_label?: string | null;
      rtmp_url?: string | null;
      stream_key?: string | null;
      whip_path?: string | null;
    } = {},
  ) => api.post<BroadcastSession>(`/matches/${matchId}/stream-sessions`, input),
  updateDestinations: (
    matchId: string,
    input: {
      destination_label?: string | null;
      rtmp_url?: string | null;
      stream_key?: string | null;
      whip_path?: string | null;
    },
  ) => api.patch<BroadcastSession>(`/matches/${matchId}/stream-sessions/active`, input),
  goLive: (matchId: string) =>
    api.post<BroadcastSession>(`/matches/${matchId}/stream-sessions/active/go-live`, {}),
  end: (matchId: string) =>
    api.post<BroadcastSession>(`/matches/${matchId}/stream-sessions/active/end`, {}),
  facebookStart: (matchId: string, next?: string) =>
    api.get<{ auth_url: string; enabled: boolean }>(
      `/matches/${matchId}/stream-sessions/active/social/facebook/start`,
      { query: { next } },
    ),
  facebookDisconnect: (matchId: string) =>
    api.post<{ facebook: FacebookSocialStatus }>(
      `/matches/${matchId}/stream-sessions/active/social/facebook/disconnect`,
      {},
    ),
  socialSelect: (
    matchId: string,
    input: { kind: SocialDestinationItem["kind"]; id?: string | null },
  ) =>
    api.post<{ selected: SocialDestinationItem; facebook: FacebookSocialStatus }>(
      `/matches/${matchId}/stream-sessions/active/social/select`,
      input,
    ),
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
  patchOverlay: (id: string, input: Partial<OverlayDirector>) =>
    api.patch<OverlayDirector>(`/matches/${id}/overlay`, input),
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
  changeBowler: (
    matchId: string,
    input: { bowler_id: string; expected_state_version?: number | null },
    inningsId?: string,
  ) =>
    api.post<ScoringResponse>(`/matches/${matchId}/crease/bowler`, input, {
      query: inningsId ? { innings_id: inningsId } : undefined,
    }),
  swapEnds: (
    matchId: string,
    input: { expected_state_version?: number | null } = {},
    inningsId?: string,
  ) =>
    api.post<ScoringResponse>(`/matches/${matchId}/crease/swap-ends`, input, {
      query: inningsId ? { innings_id: inningsId } : undefined,
    }),
  setBatters: (
    matchId: string,
    input: {
      striker_id: string;
      non_striker_id: string;
      expected_state_version?: number | null;
    },
    inningsId?: string,
  ) =>
    api.post<ScoringResponse>(`/matches/${matchId}/crease/ends`, input, {
      query: inningsId ? { innings_id: inningsId } : undefined,
    }),
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
  awards: (slug: string) => api.public<MatchAwards>(`/public/matches/${slug}/awards`),
  overlayQrUrl: (
    slug: string,
    opts: { design?: string; position?: "bottom" | "top"; origin?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.design) params.set("design", opts.design);
    if (opts.position) params.set("position", opts.position);
    if (opts.origin) params.set("origin", opts.origin);
    const qs = params.toString();
    return `${API_BASE}/public/matches/${encodeURIComponent(slug)}/overlay/qr${qs ? `?${qs}` : ""}`;
  },
  camera: (slug: string, token: string) =>
    api.public<CameraInvite>(`/public/matches/${slug}/camera/${token}`),
  cameraQrUrl: (slug: string, token: string, origin?: string) => {
    const base = `${API_BASE}/public/matches/${encodeURIComponent(slug)}/camera/${encodeURIComponent(token)}/qr`;
    if (!origin) return base;
    return `${base}?origin=${encodeURIComponent(origin)}`;
  },
  cameraClaim: (slug: string, token: string) =>
    api.public<{ status: string }>(`/public/matches/${slug}/camera/${token}/claim`, {
      method: "POST",
      body: {},
    }),
  cameraJoin: (slug: string, token: string, deviceId: string) =>
    api.public<CameraJoin>(`/public/matches/${slug}/camera/${token}/join`, {
      method: "POST",
      body: { device_id: deviceId },
    }),
  cameraDestinations: (
    slug: string,
    token: string,
    input: { destination_label?: string; rtmp_url?: string; stream_key?: string },
  ) =>
    api.public<BroadcastSession>(`/public/matches/${slug}/camera/${token}/destinations`, {
      method: "PATCH",
      body: input,
    }),
  cameraOverlay: (slug: string, token: string, input: Partial<OverlayDirector>) =>
    api.public<OverlayDirector>(`/public/matches/${slug}/camera/${token}/overlay`, {
      method: "PATCH",
      body: input,
    }),
  cameraGoLive: (
    slug: string,
    token: string,
    input: { device_id?: string; whip_path?: string | null } = {},
  ) =>
    api.public<{
      status: string;
      started_at?: string | null;
      facebook_ingest?: boolean;
      facebook?: FacebookSocialStatus;
    }>(`/public/matches/${slug}/camera/${token}/go-live`, {
      method: "POST",
      body: input,
    }),
  cameraEnd: (
    slug: string,
    token: string,
    input: { device_id?: string; whip_path?: string | null } = {},
  ) =>
    api.public<{ status: string }>(`/public/matches/${slug}/camera/${token}/end`, {
      method: "POST",
      body: input,
    }),
  cameraSocial: (slug: string, token: string) =>
    api.public<{ facebook: FacebookSocialStatus }>(`/public/matches/${slug}/camera/${token}/social`),
  cameraFacebookStart: (slug: string, token: string) =>
    api.public<{ auth_url: string; enabled: boolean }>(
      `/public/matches/${slug}/camera/${token}/social/facebook/start`,
    ),
  cameraFacebookDisconnect: (slug: string, token: string) =>
    api.public<{ facebook: FacebookSocialStatus }>(
      `/public/matches/${slug}/camera/${token}/social/facebook/disconnect`,
      { method: "POST", body: {} },
    ),
  cameraSocialSelect: (
    slug: string,
    token: string,
    input: { kind: SocialDestinationItem["kind"]; id?: string | null },
  ) =>
    api.public<{ selected: SocialDestinationItem; facebook: FacebookSocialStatus }>(
      `/public/matches/${slug}/camera/${token}/social/select`,
      { method: "POST", body: input },
    ),
  tournament: (slug: string) => api.public<PublicTournament>(`/public/tournaments/${slug}`),
  standings: (slug: string) => api.public<Standings>(`/public/tournaments/${slug}/standings`),
};

export const admin = {
  matches: (params: { status?: MatchStatus; limit?: number } = {}) =>
    api.get<MatchListItem[]>("/admin/matches", { query: { ...params } }),
  patchOverlay: (id: string, input: Partial<OverlayDirector>) =>
    api.patch<OverlayDirector>(`/admin/matches/${id}/overlay`, input),
  facebookSettings: () => api.get<FacebookAppSettings>("/admin/settings/facebook"),
  saveFacebookSettings: (input: { app_id: string; app_secret?: string | null }) =>
    api.put<FacebookAppSettings>("/admin/settings/facebook", input),
};

export const billing = {
  entitlement: () => api.get<BillingEntitlement>("/billing/entitlement"),
  users: (params: { q?: string; pending?: boolean; limit?: number; offset?: number } = {}) =>
    api.get<BillingAccount[]>("/billing/users", { query: { ...params } }),
  setApproval: (userId: string, is_approved: boolean) =>
    api.patch<BillingAccount>(`/billing/users/${userId}/approval`, { is_approved }),
  grantCredits: (userId: string, input: { credits: number; mode?: "add" | "set"; note?: string | null }) =>
    api.post<BillingAccount>(`/billing/users/${userId}/credits`, input),
  plans: () => api.get<BillingPlanInfo[]>("/billing/plans"),
  quote: (input: BillingQuoteInput) => api.post<BillingQuote>("/billing/quote", input),
  payments: (params: { user_id?: string; limit?: number; offset?: number } = {}) =>
    api.get<BillingPayment[]>("/billing/payments", { query: { ...params } }),
  recordPayment: (input: BillingPaymentInput) => api.post<BillingPayment>("/billing/payments", input),
  voidPayment: (id: string) => api.post<BillingPayment>(`/billing/payments/${id}/void`, {}),
  coupons: () => api.get<BillingCoupon[]>("/billing/coupons"),
  createCoupon: (input: BillingCouponInput) => api.post<BillingCoupon>("/billing/coupons", input),
  updateCoupon: (id: string, input: { is_active?: boolean; note?: string | null }) =>
    api.patch<BillingCoupon>(`/billing/coupons/${id}`, input),
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
