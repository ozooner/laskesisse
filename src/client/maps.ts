/** Loads the Google Maps JavaScript API once; afterwards use google.maps.importLibrary(). */
let loading: Promise<void> | undefined;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const callback = "__laskesisseMapsReady";
    (window as unknown as Record<string, () => void>)[callback] = () => resolve();
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      language: "et",
      region: "EE",
      loading: "async",
      callback,
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.append(script);
  });
  return loading;
}

/** Reads a position from an advanced marker, whichever shape the API returns. */
export function latLngOf(position: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitudeLiteral | null | undefined) {
  if (!position) return null;
  return typeof position.lat === "function"
    ? { lat: (position as google.maps.LatLng).lat(), lng: (position as google.maps.LatLng).lng() }
    : { lat: position.lat as number, lng: position.lng as number };
}
