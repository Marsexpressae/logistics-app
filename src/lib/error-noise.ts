// Browser errors that say nothing about our app and would only fill the error log with noise.
const NOISE = [
  /ResizeObserver loop/i, // a harmless browser message
  /^Script error\.?$/i, // an error from another website's script, with no details
  /(chrome|moz|safari)-extension:\/\//i, // a browser extension
  /Loading chunk .* failed/i, // the phone lost its connection for a moment
  /Failed to fetch|NetworkError|Load failed/i, // offline or a dropped connection, not a bug
  /AbortError/i,
];

export function isNoise(message: string): boolean {
  return NOISE.some((pattern) => pattern.test(message));
}
