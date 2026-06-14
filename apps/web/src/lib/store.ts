// Zustand auth store — holds the authenticated user across the session.
// Hydrated by NavBar on mount via GET /auth/me.
// Cleared on logout.

import { create } from "zustand";
import type { User } from "@/types";

interface AuthStore {
  user: User | null;
  hydrated: boolean;
  setUser: (user: User | null) => void;
  setHydrated: () => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  hydrated: false,
  setUser: (user) => set({ user }),
  setHydrated: () => set({ hydrated: true }),
  clearUser: () => set({ user: null }),
}));
