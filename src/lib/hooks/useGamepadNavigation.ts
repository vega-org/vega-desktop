import { useEffect, useRef } from "react";

type Direction = "up" | "down" | "left" | "right";

interface DirectionState {
  isHeld: boolean;
  firstPressTime: number;
  lastRepeatTime: number;
  latchedOff: boolean;
}

// Match Android's default key repeat timeout so a normal press on a Bluetooth remote
// (which Android exposes as a gamepad) doesn't auto-repeat.
const INITIAL_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;
const STICK_DEADZONE = 0.45;

// An axis is ignored until it has reported a value at rest at least once. Sony Bravia and
// several other Android TV remotes enumerate as KEYBOARD|DPAD|JOYSTICK and expose phantom
// axes pinned at -1.0, which otherwise reads as a D-pad direction held down forever.
const AXIS_NEUTRAL_EPSILON = 0.2;

// Remotes that deliver real keydown events already drive spatial navigation, so the gamepad
// fallback must stand down or every press moves focus twice.
const REAL_KEY_SUPPRESS_MS = 2000;

// No one holds a direction this long. Treat it as a stuck axis/button and latch it off until
// the device reports the direction released.
const STUCK_DIRECTION_MS = 6000;

const makeDirectionState = (): DirectionState => ({
  isHeld: false,
  firstPressTime: 0,
  lastRepeatTime: 0,
  latchedOff: false,
});

export function useGamepadNavigation() {
  const rafRef = useRef<number | null>(null);
  const prevButtonsRef = useRef<boolean[]>([]);
  const lastRealKeyTimeRef = useRef(Number.NEGATIVE_INFINITY);
  const axisTrustedRef = useRef<boolean[]>([]);
  const gamepadIndexRef = useRef<number | null>(null);
  const dirStatesRef = useRef<Record<Direction, DirectionState>>({
    up: makeDirectionState(),
    down: makeDirectionState(),
    left: makeDirectionState(),
    right: makeDirectionState(),
  });

  useEffect(() => {
    const notifyActivity = () => {
      window.dispatchEvent(new CustomEvent("vega:remote-activity"));
    };

    // Synthetic events are untrusted, so this only records presses the platform really sent.
    const handleRealKey = (event: KeyboardEvent) => {
      if (event.isTrusted) lastRealKeyTimeRef.current = performance.now();
    };
    window.addEventListener("keydown", handleRealKey, true);

    // Emulate exactly one real key press: dispatch once on the focused element and let it
    // bubble to window, where spatial navigation and other listeners handle it.
    const dispatchKeyEvent = (key: string, code: string, type: "keydown" | "keyup" = "keydown") => {
      const activeEl = document.activeElement || document.body;
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        view: window,
      });
      activeEl.dispatchEvent(event);
    };

    // Navigation happens through the synthetic arrow key event (spatial navigation reads
    // event.code), so don't also call navigateByDirection() or each press moves focus twice.
    // This matters for Bluetooth TV remotes that Android exposes as gamepads.
    const triggerDirection = (dir: Direction) => {
      notifyActivity();

      const keyMap: Record<Direction, { key: string; code: string }> = {
        up: { key: "ArrowUp", code: "ArrowUp" },
        down: { key: "ArrowDown", code: "ArrowDown" },
        left: { key: "ArrowLeft", code: "ArrowLeft" },
        right: { key: "ArrowRight", code: "ArrowRight" },
      };

      const { key, code } = keyMap[dir];
      dispatchKeyEvent(key, code, "keydown");
      setTimeout(() => dispatchKeyEvent(key, code, "keyup"), 16);
    };

    const processDirection = (dir: Direction, isPressed: boolean, now: number) => {
      const state = dirStatesRef.current[dir];
      if (!isPressed) {
        state.isHeld = false;
        state.latchedOff = false;
        return;
      }
      if (state.latchedOff) return;

      if (!state.isHeld) {
        state.isHeld = true;
        state.firstPressTime = now;
        state.lastRepeatTime = now;
        triggerDirection(dir);
      } else if (now - state.firstPressTime > STUCK_DIRECTION_MS) {
        state.latchedOff = true;
      } else if (
        now - state.firstPressTime > INITIAL_DELAY_MS &&
        now - state.lastRepeatTime > REPEAT_INTERVAL_MS
      ) {
        state.lastRepeatTime = now;
        triggerDirection(dir);
      }
    };

    const resetDirectionStates = () => {
      dirStatesRef.current.up = makeDirectionState();
      dirStatesRef.current.down = makeDirectionState();
      dirStatesRef.current.left = makeDirectionState();
      dirStatesRef.current.right = makeDirectionState();
    };

    const readAxis = (axes: readonly number[], index: number) => {
      const raw = axes[index] ?? 0;
      if (!axisTrustedRef.current[index]) {
        if (Math.abs(raw) <= AXIS_NEUTRAL_EPSILON) axisTrustedRef.current[index] = true;
        return 0;
      }
      return raw;
    };

    const pollGamepads = () => {
      const gamepads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      let activeGamepad: Gamepad | null = null;

      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected) {
          activeGamepad = gp;
          break;
        }
      }

      if (!activeGamepad) {
        rafRef.current = requestAnimationFrame(pollGamepads);
        return;
      }

      const now = performance.now();
      const buttons = activeGamepad.buttons;
      const axes = activeGamepad.axes;

      if (activeGamepad.index !== gamepadIndexRef.current) {
        gamepadIndexRef.current = activeGamepad.index;
        axisTrustedRef.current = [];
        resetDirectionStates();
      }

      // The device is sending real key events, so spatial navigation is already handling it.
      if (now - lastRealKeyTimeRef.current < REAL_KEY_SUPPRESS_MS) {
        resetDirectionStates();
        prevButtonsRef.current = buttons.map((b) => Boolean(b.pressed));
        rafRef.current = requestAnimationFrame(pollGamepads);
        return;
      }

      // D-Pad and Left Analog Stick
      const stickX = readAxis(axes, 0);
      const stickY = readAxis(axes, 1);

      const dpadUp = Boolean(buttons[12]?.pressed) || stickY < -STICK_DEADZONE;
      const dpadDown = Boolean(buttons[13]?.pressed) || stickY > STICK_DEADZONE;
      const dpadLeft = Boolean(buttons[14]?.pressed) || stickX < -STICK_DEADZONE;
      const dpadRight = Boolean(buttons[15]?.pressed) || stickX > STICK_DEADZONE;

      processDirection("up", dpadUp, now);
      processDirection("down", dpadDown, now);
      processDirection("left", dpadLeft, now);
      processDirection("right", dpadRight, now);

      // Edge-triggered Action Buttons
      const prevButtons = prevButtonsRef.current;
      const isPressed = (idx: number) => Boolean(buttons[idx]?.pressed);
      const isJustPressed = (idx: number) => isPressed(idx) && !prevButtons[idx];

      // A / Cross (Button 0) -> Select / Enter
      if (isJustPressed(0)) {
        notifyActivity();
        dispatchKeyEvent("Enter", "Enter", "keydown");
        setTimeout(() => dispatchKeyEvent("Enter", "Enter", "keyup"), 16);
      }

      // B / Circle (Button 1) -> Back / Escape
      if (isJustPressed(1)) {
        notifyActivity();
        dispatchKeyEvent("Escape", "Escape", "keydown");
        setTimeout(() => dispatchKeyEvent("Escape", "Escape", "keyup"), 16);
      }

      // X / Square (Button 2) -> Play / Pause
      if (isJustPressed(2)) {
        notifyActivity();
        dispatchKeyEvent("k", "KeyK", "keydown");
        setTimeout(() => dispatchKeyEvent("k", "KeyK", "keyup"), 16);
      }

      // Y / Triangle (Button 3) -> Toggle Episode drawer / Subtitles
      if (isJustPressed(3)) {
        notifyActivity();
        window.dispatchEvent(new CustomEvent("vega:toggle-episodes"));
      }

      // LB (Button 4) -> Seek backward (-10s)
      if (isJustPressed(4)) {
        notifyActivity();
        dispatchKeyEvent("ArrowLeft", "ArrowLeft", "keydown");
        setTimeout(() => dispatchKeyEvent("ArrowLeft", "ArrowLeft", "keyup"), 16);
      }

      // RB (Button 5) -> Seek forward (+10s)
      if (isJustPressed(5)) {
        notifyActivity();
        dispatchKeyEvent("ArrowRight", "ArrowRight", "keydown");
        setTimeout(() => dispatchKeyEvent("ArrowRight", "ArrowRight", "keyup"), 16);
      }

      // LT (Button 6) -> Skip backward / Previous
      if (isJustPressed(6)) {
        notifyActivity();
        dispatchKeyEvent("p", "KeyP", "keydown");
        setTimeout(() => dispatchKeyEvent("p", "KeyP", "keyup"), 16);
      }

      // RT (Button 7) -> Skip forward / Next episode
      if (isJustPressed(7)) {
        notifyActivity();
        dispatchKeyEvent("n", "KeyN", "keydown");
        setTimeout(() => dispatchKeyEvent("n", "KeyN", "keyup"), 16);
      }

      // Start / Menu (Button 9) -> Toggle controls
      if (isJustPressed(9)) {
        notifyActivity();
        dispatchKeyEvent("m", "KeyM", "keydown");
        setTimeout(() => dispatchKeyEvent("m", "KeyM", "keyup"), 16);
      }

      // Save state for next frame
      prevButtonsRef.current = buttons.map((b) => Boolean(b.pressed));
      rafRef.current = requestAnimationFrame(pollGamepads);
    };

    rafRef.current = requestAnimationFrame(pollGamepads);

    return () => {
      window.removeEventListener("keydown", handleRealKey, true);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);
}
