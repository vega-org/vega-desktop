/**
 * Rough low-end check: 4 or fewer logical cores, or 4 GB RAM or less
 * (deviceMemory is Chromium only, so WebView2; undefined elsewhere).
 */
export const isLowEndDevice = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return cores <= 4 || (memory !== undefined && memory <= 4);
};
