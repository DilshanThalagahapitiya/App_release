export const nowIso = () => new Date().toISOString();
export const addSeconds = (s: number, from = new Date()) => new Date(from.getTime() + s * 1000).toISOString();
export const addDays = (d: number, from = new Date()) => addSeconds(d * 86400, from);
export const epochSeconds = () => Math.floor(Date.now() / 1000);
