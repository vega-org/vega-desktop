import { useSyncExternalStore } from "react";

// Keys that move or use the spatial-navigation focus. Gamepad input arrives as
// synthetic keydown events with the same keys.
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "Enter",
]);

let keyboardActive = false;
const listeners = new Set<() => void>();

const setKeyboardActive = (value: boolean) => {
  if (keyboardActive === value) return;
  keyboardActive = value;
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (NAV_KEYS.has(event.key)) setKeyboardActive(true);
    },
    true,
  );
  window.addEventListener("vega:remote-activity", () => setKeyboardActive(true));
  window.addEventListener("pointerdown", () => setKeyboardActive(false), true);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * True while the user drives the UI with keyboard or controller, false after a
 * mouse or touch press. Outside TV mode, focus rings only show while true.
 */
export const useKeyboardNavActive = () =>
  useSyncExternalStore(subscribe, () => keyboardActive);
