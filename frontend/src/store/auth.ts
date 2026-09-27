/**
 * Session state.
 *
 * The store holds the *user*, never the tokens — those live in the HTTP layer,
 * where the access token stays in memory and only the refresh token touches
 * storage. On boot we ask the API who we are: if the refresh token is stale the
 * request fails and we land as a guest, which is the correct outcome.
 */

import { create } from "zustand";

import { ApiError, clearSession, hasSession, onAuthChange } from "@/lib/api/client";
import { auth } from "@/lib/api/endpoints";
import type { User } from "@/lib/api/types";

interface AuthState {
  user: User | null;
  status: "loading" | "authenticated" | "guest";
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    display_name: string;
  }) => Promise<{ pending: boolean; message?: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  restore: async () => {
    if (!hasSession()) {
      set({ user: null, status: "guest" });
      return;
    }
    try {
      const user = await auth.me();
      set({ user, status: "authenticated" });
    } catch (error) {
      // A network blip must not sign a pitch-side scorer out of their own match.
      if (error instanceof ApiError && error.isOffline) {
        set({ status: "guest" });
        return;
      }
      clearSession();
      set({ user: null, status: "guest" });
    }
  },

  login: async (email, password) => {
    const { user } = await auth.login({ email, password });
    set({ user, status: "authenticated" });
  },

  register: async (input) => {
    const result = await auth.register({
      ...input,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if ("pending_approval" in result && result.pending_approval) {
      set({ user: null, status: "guest" });
      return { pending: true, message: result.message };
    }
    if ("user" in result && result.user && "access_token" in result) {
      set({ user: result.user, status: "authenticated" });
    }
    return { pending: false };
  },

  logout: async () => {
    await auth.logout();
    set({ user: null, status: "guest" });
  },

  setUser: (user) => set({ user, status: user ? "authenticated" : "guest" }),
}));

// The HTTP layer clears the session when a refresh finally fails; mirror that
// into the UI so protected routes redirect instead of rendering an empty shell.
onAuthChange((authenticated) => {
  if (!authenticated) useAuth.setState({ user: null, status: "guest" });
});
