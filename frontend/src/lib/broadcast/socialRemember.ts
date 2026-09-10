import type { SocialDestination } from "@/components/broadcast/SocialStreamConnect";

const STORAGE_KEY = "odcc.social-destination.v1";

export type RememberedSocial = {
  destination: SocialDestination;
  destinationName: string;
  streamKey: string;
};

export function loadRememberedSocial(): RememberedSocial | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedSocial>;
    const destination = parsed.destination;
    if (
      destination !== "youtube" &&
      destination !== "facebook_page" &&
      destination !== "facebook_group" &&
      destination !== "facebook_profile"
    ) {
      return null;
    }
    return {
      destination,
      destinationName: typeof parsed.destinationName === "string" ? parsed.destinationName : "",
      streamKey: typeof parsed.streamKey === "string" ? parsed.streamKey : "",
    };
  } catch {
    return null;
  }
}

export function rememberSocial(value: RememberedSocial): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
