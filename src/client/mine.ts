import { EVENT_KEYS, type EventKey, tallinnToday } from "../shared/events";

/** The listing this browser created, with the private token that allows editing it. */
export interface Mine {
  id: string;
  token: string;
  eventDate: string;
}

type MineByEvent = Partial<Record<EventKey, Mine>>;

const KEY = "laskesisse:mine";

export function loadMine(): MineByEvent {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as MineByEvent;
    const today = tallinnToday();
    for (const key of EVENT_KEYS) {
      if (all[key] && all[key].eventDate < today) delete all[key];
    }
    return all;
  } catch {
    return {};
  }
}

export function saveMine(event: EventKey, mine: Mine | null): MineByEvent {
  const all = loadMine();
  if (mine) all[event] = mine;
  else delete all[event];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the edit link still works
  }
  return all;
}

export function editLink(mine: Mine): string {
  return `${location.origin}/?muuda=${mine.id}.${mine.token}`;
}

/** Reads `?muuda=<id>.<token>` from an edit link. */
export function readEditParam(): { id: string; token: string } | null {
  const value = new URLSearchParams(location.search).get("muuda");
  const [id, token] = value?.split(".") ?? [];
  return id && token ? { id, token } : null;
}
