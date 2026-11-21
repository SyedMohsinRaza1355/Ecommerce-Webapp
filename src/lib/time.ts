/** Time helpers kept out of React render functions. */
export const hoursAgo = (h: number, now = Date.now()) => new Date(now - h * 3600_000);
