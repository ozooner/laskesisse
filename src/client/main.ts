import { MarkerClusterer, type Renderer } from "@googlemaps/markerclusterer";
import {
  EVENTS, type EventKey, daysBetween, defaultEvent, eventDate, formatShort, isEventKey, tallinnToday,
} from "../shared/events";
import { NOTE_MAX, RULES, type House, type HouseInput, type RuleKey } from "../shared/houses";
import { ApiError, api, type Config } from "./api";
import { latLngOf, loadGoogleMaps } from "./maps";
import { type Mine, editLink, loadMine, readEditParam, saveMine } from "./mine";

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: {
        sitekey: string;
        language?: string;
        theme?: "light" | "dark" | "auto";
        "error-callback"?: (code: string) => boolean | void;
      }): string;
      reset(widgetId: string): void;
      getResponse(widgetId: string): string | undefined;
    };
  }
}

const DESCRIPTIONS: Record<EventKey, string> = {
  mardi:
    "Mardipäeval käivad mardisandid perest perre. Nad laulavad, tantsivad ja soovivad perele head ning saavad vastu ande. Kui ootad sante, pane oma maja kaardile.",
  kadri:
    "Kadripäeval käivad valgetes riietes kadrisandid. Nad laulavad, soovivad karjaõnne ja head talve ning saavad vastu ande. Kui ootad sante, pane oma maja kaardile.",
};

const THEME_COLORS: Record<EventKey, string> = { mardi: "#2a201a", kadri: "#f3f4f1" };
const ESTONIA = { center: { lat: 58.65, lng: 25.0 }, zoom: 7 };
const FALLBACK_MAP_ID = "DEMO_MAP_ID";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  today: tallinnToday(),
  event: "mardi" as EventKey,
  houses: [] as House[],
  config: null as Config | null,
  mapsReady: false,
  mine: loadMine(),
};

/* ---------------- Tabs and intro ---------------- */

function setEvent(event: EventKey) {
  state.event = event;
  document.documentElement.dataset.event = event;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[event]);
  if (location.hash !== `#${event}`) history.replaceState(null, "", `/#${event}`);

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tabs [role=tab]")) {
    const selected = tab.dataset.event === event;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  const date = eventDate(event, state.today);
  const days = daysBetween(state.today, date);
  const { name, untilWord } = EVENTS[event];
  $("count").innerHTML =
    days === 0 ? `Täna on ${name.toLowerCase()}!`
    : days === 1 ? `Homme on ${name.toLowerCase()}!`
    : `<b>${days}</b>päeva ${untilWord}`;
  $("desc").textContent = DESCRIPTIONS[event];
  $("fab").textContent = state.mine[event] ? "Minu maja" : "+ Ootan sante";

  hideCard();
  showMap(event);
  void loadHouses();
}

function renderTally() {
  const n = state.houses.length;
  $("tally").textContent =
    n === 0 ? "Kaardil pole veel ühtegi maja. Ole esimene!"
    : n === 1 ? "Kaardil on 1 pere, kes ootab sante."
    : `Kaardil on ${n} peret, kes ootavad sante.`;
}

async function loadHouses() {
  const event = state.event;
  try {
    const { houses } = await api.houses(event);
    if (event !== state.event) return; // tab changed meanwhile
    state.houses = houses;
  } catch {
    state.houses = [];
    $("tally").textContent = "Maju ei õnnestunud laadida. Proovi lehte värskendada.";
    return;
  }
  renderTally();
  renderMarkers();
}

/* ---------------- Main map ---------------- */

interface EventMap {
  el: HTMLDivElement;
  map: google.maps.Map;
  clusterer: MarkerClusterer;
}
const maps: Partial<Record<EventKey, EventMap>> = {};

function mapStatus(text: string | null) {
  const el = $("map-status");
  el.hidden = !text;
  el.textContent = text ?? "";
}

async function showMap(event: EventKey) {
  if (!state.mapsReady) return;
  const previous = Object.values(maps).find((m) => !m.el.hidden);
  for (const m of Object.values(maps)) m.el.hidden = true;

  let current = maps[event];
  if (!current) {
    // Each tab has its own Map ID (and so its own style), which cannot change after creation.
    const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
    const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0";
    $("map").append(el);
    const map = new Map(el, {
      center: previous?.map.getCenter() ?? ESTONIA.center,
      zoom: previous?.map.getZoom() ?? ESTONIA.zoom,
      mapId: state.config?.mapIds[event] || FALLBACK_MAP_ID,
      colorScheme: (event === "mardi" ? "DARK" : "LIGHT") as google.maps.ColorScheme,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
    const renderer: Renderer = {
      render: ({ count, position }) => {
        const content = document.createElement("div");
        content.className = "cluster-pin";
        content.textContent = String(count);
        return new AdvancedMarkerElement({ position, content, zIndex: 1000 + count });
      },
    };
    map.addListener("click", hideCard);
    current = maps[event] = { el, map, clusterer: new MarkerClusterer({ map, renderer }) };
  } else if (previous && previous !== current) {
    current.map.setCenter(previous.map.getCenter()!);
    current.map.setZoom(previous.map.getZoom()!);
  }
  current.el.hidden = false;
  renderMarkers();
}

async function renderMarkers() {
  const current = maps[state.event];
  if (!current) return;
  const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
  const mineId = state.mine[state.event]?.id;
  const markers = state.houses.map((house) => {
    const content = document.createElement("div");
    content.className = house.id === mineId ? "house-pin mine" : "house-pin";
    const marker = new AdvancedMarkerElement({
      position: { lat: house.lat, lng: house.lng },
      content,
      title: house.address,
      gmpClickable: true,
    });
    marker.addEventListener("gmp-click", () => showCard(house));
    return marker;
  });
  current.clusterer.clearMarkers();
  current.clusterer.addMarkers(markers);
}

function locateMe() {
  const current = maps[state.event];
  if (!current || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      current.map.panTo({ lat: coords.latitude, lng: coords.longitude });
      current.map.setZoom(15);
    },
    () => mapStatusFlash("Asukohta ei õnnestunud leida."),
    { enableHighAccuracy: false, timeout: 10_000 },
  );
}

function mapStatusFlash(text: string) {
  mapStatus(text);
  setTimeout(() => mapStatus(null), 3000);
}

/* ---------------- House card ---------------- */

function showCard(house: House) {
  $("card-address").textContent = house.address;
  $("card-time").textContent = `Ootame ${house.timeFrom}–${house.timeTo}`;
  const rules = $("card-rules");
  rules.replaceChildren(...house.rules.map((key) => {
    const li = document.createElement("li");
    li.textContent = RULES[key];
    return li;
  }));
  rules.hidden = house.rules.length === 0;
  $("card-note").textContent = house.note;
  $("card-note").hidden = !house.note;
  $<HTMLAnchorElement>("card-directions").href =
    `https://www.google.com/maps/dir/?api=1&destination=${house.lat},${house.lng}`;

  const report = $<HTMLButtonElement>("card-report");
  report.hidden = house.id === state.mine[state.event]?.id;
  report.disabled = false;
  report.textContent = "Teata probleemist";
  report.onclick = async () => {
    if (report.dataset.armed !== "1") {
      report.dataset.armed = "1";
      report.textContent = "Kas see kuulutus on vale või sobimatu? Vajuta uuesti";
      return;
    }
    report.disabled = true;
    try {
      await api.report(house.id);
      report.textContent = "Aitäh, vaatame üle.";
    } catch {
      report.textContent = "Teatamine ebaõnnestus.";
    }
  };
  delete report.dataset.armed;
  $("house-card").hidden = false;
}

function hideCard() {
  $("house-card").hidden = true;
}

/* ---------------- "Ootan sante" sheet ---------------- */

const form = $<HTMLFormElement>("house-form");
let picked: { address: string; lat: number; lng: number } | null = null;
let pickMap: { map: google.maps.Map; marker: google.maps.marker.AdvancedMarkerElement } | null = null;
let autocompleteReady = false;
let turnstileWidget: string | null = null;
let lastFocus: HTMLElement | null = null;

function buildRuleToggles() {
  $("rules").replaceChildren(...(Object.keys(RULES) as RuleKey[]).map((key) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="rule" value="${key}" /><span></span>`;
    label.querySelector("span")!.textContent = RULES[key];
    return label;
  }));
}

function updateNoteCount() {
  const length = $<HTMLTextAreaElement>("note").value.length;
  $("note-count").textContent = `${length}/${NOTE_MAX}`;
}

async function setupAutocomplete() {
  if (autocompleteReady || !state.mapsReady) return;
  autocompleteReady = true;
  const places = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  const autocomplete = new places.PlaceAutocompleteElement({ includedRegionCodes: ["ee"] });
  autocomplete.id = "address-autocomplete";
  autocomplete.setAttribute("placeholder", "Alusta aadressi kirjutamist");
  $("address-slot").append(autocomplete);

  autocomplete.addEventListener("gmp-select", async (event) => {
    const { placePrediction } = event as unknown as { placePrediction: google.maps.places.PlacePrediction };
    const place = placePrediction.toPlace();
    await place.fetchFields({ fields: ["formattedAddress", "location"] });
    if (!place.location) return;
    setPicked({
      address: (place.formattedAddress ?? "").replace(/, Eesti$/, ""),
      lat: place.location.lat(),
      lng: place.location.lng(),
    });
  });
}

async function setPicked(value: typeof picked) {
  picked = value;
  $("picked-address").hidden = !value;
  $("pick-map").hidden = !value;
  $("pick-hint").hidden = !value;
  if (!value || !state.mapsReady) return;
  $("picked-address").textContent = value.address;

  const position = { lat: value.lat, lng: value.lng };
  if (!pickMap) {
    const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
    const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
    const map = new Map($("pick-map"), {
      center: position,
      zoom: 18,
      mapId: state.config?.mapIds.kadri || FALLBACK_MAP_ID,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    const content = document.createElement("div");
    content.className = "house-pin";
    const marker = new AdvancedMarkerElement({ map, position, content, gmpDraggable: true, title: "Sinu uks" });
    const sync = () => {
      const p = latLngOf(marker.position);
      if (p && picked) picked = { ...picked, ...p };
    };
    marker.addListener("dragend", sync);
    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) marker.position = e.latLng;
      sync();
    });
    pickMap = { map, marker };
  } else {
    pickMap.marker.position = position;
    pickMap.map.setCenter(position);
    pickMap.map.setZoom(18);
  }
}

function setupTurnstile() {
  const siteKey = state.config?.turnstileSiteKey;
  if (!siteKey) return;
  if (turnstileWidget !== null) {
    window.turnstile?.reset(turnstileWidget);
    return;
  }
  const render = () => {
    turnstileWidget = window.turnstile!.render($("turnstile"), {
      sitekey: siteKey,
      language: "et",
      theme: state.event === "mardi" ? "dark" : "light",
      "error-callback": (code) => {
        // Codes are listed at developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/
        $("form-error").textContent = `Robotikontroll ei õnnestunud (viga ${code}). Värskenda lehte ja proovi uuesti.`;
        console.error("Turnstile error", code);
        return true;
      },
    });
  };
  if (window.turnstile) return render();
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = render;
  script.onerror = () => {
    $("form-error").textContent = "Robotikontrolli ei õnnestunud laadida. Värskenda lehte.";
  };
  document.head.append(script);
}

function fillForm(house: House | null) {
  form.reset();
  $<HTMLInputElement>("time-from").value = house?.timeFrom ?? "17:00";
  $<HTMLInputElement>("time-to").value = house?.timeTo ?? "20:00";
  $<HTMLTextAreaElement>("note").value = house?.note ?? "";
  for (const box of form.querySelectorAll<HTMLInputElement>("input[name=rule]")) {
    box.checked = house?.rules.includes(box.value as RuleKey) ?? false;
  }
  updateNoteCount();
  void setPicked(house ? { address: house.address, lat: house.lat, lng: house.lng } : null);
}

async function openSheet() {
  lastFocus = document.activeElement as HTMLElement | null;
  const event = state.event;
  const date = eventDate(event, state.today);
  const { name } = EVENTS[event];
  let mine: Mine | undefined = state.mine[event];
  let house: House | null = null;

  if (mine) {
    try {
      house = state.houses.find((h) => h.id === mine!.id) ?? (await api.house(mine.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        state.mine = saveMine(event, null);
        mine = undefined;
      }
    }
  }

  $("sheet-title").textContent = mine ? "Minu maja" : "Ootan sante";
  $("delete-notice").textContent =
    `Pane tähele: sinu lisatud aadress kustutatakse automaatselt, kui ${name.toLowerCase()} on möödas (${formatShort(date)}).`;
  $("submit").textContent = mine ? "Salvesta muudatused" : "Lisa kaardile";
  $("delete").hidden = !mine;
  $("delete-confirm").hidden = true;
  $("form-error").textContent = "";
  fillForm(house);

  form.hidden = false;
  $("sheet-done").hidden = true;
  $("sheet").hidden = false;
  $("backdrop").hidden = false;
  hideCard();

  if (!state.mapsReady) {
    $("form-error").textContent = "Kaart ei laadinud, seega ei saa praegu aadressi lisada. Proovi lehte värskendada.";
  }
  // Turnstile first, so a failing address search cannot keep the robot check from appearing.
  setupTurnstile();
  try {
    await setupAutocomplete();
  } catch (err) {
    console.error("Address search failed to load", err);
    autocompleteReady = false;
    $("form-error").textContent = "Aadressiotsing ei laadinud. Värskenda lehte ja proovi uuesti.";
  }
  (document.getElementById("address-autocomplete") ?? $("time-from")).focus();
}

function closeSheet() {
  $("sheet").hidden = true;
  $("backdrop").hidden = true;
  lastFocus?.focus();
}

function readForm(): HouseInput | string {
  if (!picked) return "Vali aadress soovituste nimekirjast.";
  const timeFrom = $<HTMLInputElement>("time-from").value;
  const timeTo = $<HTMLInputElement>("time-to").value;
  if (!timeFrom || !timeTo) return "Lisa kellaajad.";
  if (timeFrom >= timeTo) return "Lõpuaeg peab olema hilisem kui algusaeg.";
  const rules = [...form.querySelectorAll<HTMLInputElement>("input[name=rule]:checked")].map((b) => b.value as RuleKey);
  const turnstileToken = turnstileWidget !== null ? window.turnstile?.getResponse(turnstileWidget) : undefined;
  if (state.config?.turnstileSiteKey && !turnstileToken) {
    return turnstileWidget === null
      ? "Robotikontroll ei laadinud. Värskenda lehte."
      : "Palun oota, kuni robotikontroll lõpeb, või vajuta selle kastikesele.";
  }
  return {
    event: state.event,
    address: picked.address,
    lat: picked.lat,
    lng: picked.lng,
    timeFrom,
    timeTo,
    rules,
    note: $<HTMLTextAreaElement>("note").value.trim(),
    turnstileToken,
  };
}

async function submitForm(e: SubmitEvent) {
  e.preventDefault();
  const input = readForm();
  const error = $("form-error");
  if (typeof input === "string") {
    error.textContent = input;
    return;
  }
  const button = $<HTMLButtonElement>("submit");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Salvestan…";
  error.textContent = "";

  const event = state.event;
  const mine = state.mine[event];
  try {
    if (mine) {
      await api.update(mine.id, mine.token, input);
      closeSheet();
    } else {
      const created = await api.create(input);
      const newMine = { id: created.id, token: created.editToken, eventDate: created.eventDate };
      state.mine = saveMine(event, newMine);
      showDone(event, newMine);
    }
    $("fab").textContent = "Minu maja";
    await loadHouses();
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : "Salvestamine ebaõnnestus.";
    if (turnstileWidget !== null) window.turnstile?.reset(turnstileWidget);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function showDone(event: EventKey, mine: Mine) {
  const { name, visitors } = EVENTS[event];
  $("done-text").textContent =
    `${visitors} näevad sind nüüd kaardil. Kustutame sinu maja kaardilt automaatselt, kui ${name.toLowerCase()} on möödas (${formatShort(mine.eventDate)}).`;
  $<HTMLInputElement>("edit-link").value = editLink(mine);
  $("copy-link").textContent = "Kopeeri";
  form.hidden = true;
  $("sheet-done").hidden = false;
}

async function deleteMine() {
  const event = state.event;
  const mine = state.mine[event];
  if (!mine) return;
  try {
    await api.remove(mine.id, mine.token);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      $("form-error").textContent = err instanceof Error ? err.message : "Eemaldamine ebaõnnestus.";
      return;
    }
  }
  state.mine = saveMine(event, null);
  $("fab").textContent = "+ Ootan sante";
  closeSheet();
  await loadHouses();
}

async function copyEditLink() {
  const input = $<HTMLInputElement>("edit-link");
  try {
    await navigator.clipboard.writeText(input.value);
    $("copy-link").textContent = "Kopeeritud";
  } catch {
    input.select();
  }
}

/* ---------------- Start ---------------- */

async function claimEditLink(): Promise<EventKey | null> {
  const param = readEditParam();
  if (!param) return null;
  try {
    const house = await api.house(param.id);
    state.mine = saveMine(house.event, { id: house.id, token: param.token, eventDate: house.eventDate });
    return house.event;
  } catch {
    return null;
  }
}

async function start() {
  buildRuleToggles();

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tabs [role=tab]")) {
    tab.addEventListener("click", () => setEvent(tab.dataset.event as EventKey));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const next: EventKey = state.event === "mardi" ? "kadri" : "mardi";
      setEvent(next);
      $(`tab-${next}`).focus();
    });
  }
  window.addEventListener("hashchange", () => {
    const hash = location.hash.slice(1);
    if (isEventKey(hash) && hash !== state.event) setEvent(hash);
  });

  $("fab").addEventListener("click", openSheet);
  $("locate").addEventListener("click", locateMe);
  $("backdrop").addEventListener("click", closeSheet);
  document.querySelectorAll("[data-close-sheet]").forEach((b) => b.addEventListener("click", closeSheet));
  document.querySelector("[data-close-card]")!.addEventListener("click", hideCard);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("sheet").hidden) closeSheet();
  });
  form.addEventListener("submit", submitForm);
  $("note").addEventListener("input", updateNoteCount);
  $("delete").addEventListener("click", () => ($("delete-confirm").hidden = false));
  $("delete-no").addEventListener("click", () => ($("delete-confirm").hidden = true));
  $("delete-yes").addEventListener("click", deleteMine);
  $("copy-link").addEventListener("click", copyEditLink);

  const claimed = await claimEditLink();
  const hash = location.hash.slice(1);
  setEvent(claimed ?? (isEventKey(hash) ? hash : defaultEvent(state.today)));

  try {
    state.config = await api.config();
  } catch {
    mapStatus("Teenus ei vasta. Proovi lehte värskendada.");
    return;
  }
  if (!state.config.mapsApiKey) {
    mapStatus("Kaart pole veel seadistatud (Google Maps API võti puudub).");
  } else {
    try {
      await loadGoogleMaps(state.config.mapsApiKey);
      state.mapsReady = true;
      await showMap(state.event);
    } catch {
      mapStatus("Kaarti ei õnnestunud laadida.");
    }
  }
  if (claimed) await openSheet();
}

void start();
