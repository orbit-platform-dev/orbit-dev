// Deterministic-ish relative timestamps anchored to load time so the UI always
// shows fresh "x ago" values regardless of when the app is opened.
const now = Date.now();

export const mins = (n: number) => n * 60_000;
export const hours = (n: number) => n * 3_600_000;
export const days = (n: number) => n * 86_400_000;

/** ISO timestamp `offsetMs` in the past (negative = future). */
export const ago = (offsetMs: number) => new Date(now - offsetMs).toISOString();
/** ISO timestamp `offsetMs` in the future. */
export const ahead = (offsetMs: number) => new Date(now + offsetMs).toISOString();
