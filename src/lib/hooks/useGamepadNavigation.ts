import { useEffect, useRef } from "react";
import { navigateByDirection } from "@noriginmedia/norigin-spatial-navigation-core";

type Direction = "up" | "down" | "left" | "right";

interface DirectionState {
  isHeld: boolean;
  firstPressTime: number;
  lastRepeatTime: number;
}

const INITIAL_DELAY_MS = 220;
const REPEAT_INTERVAL_MS = 90;
const STICK_DEADZONE = 0.45;

export function useGamepadNavigation() {
  const rafRef = useRef<number | null>(null);
  const prevButtonsRef = useRef<boolean[]>([]);
  const dirStatesRef = useRef<Record<Direction, DirectionState>>({
    up: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    down: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    left: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
    right: { isHeld: false, firstPressTime: 0, lastRepeatTime: 0 },
  });

  useEffect(() => {
    const notifyActivity = () => {
      window.dispatchEvent(new CustomEvent("vega:remote-activity"));
    };

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
      window.dispatchEvent(event);
    };

    const triggerDirection = (dir: Direction) => {
      notifyActivity();
      try {
        navigateByDirection(dir);
      } catch {}

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
      if (isPressed) {
        if (!state.isHeld) {
          state.isHeld = true;
          state.firstPressTime = now;
          state.lastRepeatTime = now;
          triggerDirection(dir);
        } else if (
          now - state.firstPressTime > INITIAL_DELAY_MS &&
          now - state.lastRepeatTime > REPEAT_INTERVAL_MS
        ) {
          state.lastRepeatTime = now;
          triggerDirection(dir);
        }
      } else {
        state.isHeld = false;
      }
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

      // D-Pad and Left Analog Stick
      const stickX = axes[0] ?? 0;
      const stickY = axes[1] ?? 0;

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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);
}
