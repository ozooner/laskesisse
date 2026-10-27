export const RULES = {
  sing: "Enne laul või tants",
  nutfree: "Pähklivabad maiustused",
  dog: "Koer on õues",
  bell: "Helista uksekella",
  small: "Väikesed grupid",
} as const;

export type RuleKey = keyof typeof RULES;

export const ADDRESS_MAX = 120;
export const NOTE_MAX = 280;

/** A listing as shown on the public map. */
export interface House {
  id: string;
  event: "mardi" | "kadri";
  eventDate: string;
  address: string;
  lat: number;
  lng: number;
  timeFrom: string;
  timeTo: string;
  rules: RuleKey[];
  note: string;
}

/** What the "Ootan sante" form sends. */
export interface HouseInput {
  event: "mardi" | "kadri";
  address: string;
  lat: number;
  lng: number;
  timeFrom: string;
  timeTo: string;
  rules: RuleKey[];
  note: string;
  turnstileToken?: string;
}
