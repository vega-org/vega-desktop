import React, { useEffect, useRef, useCallback } from "react";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import {
  setFocus,
  doesFocusableExist,
  ROOT_FOCUS_KEY,
} from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../storage";
import { useModalFocus, InModalProvider } from "../context/ModalFocusContext";

interface UseDialogFocusBoundaryOptions {
  isOpen: boolean;
  focusKey?: string;
  preferredChildFocusKey?: string;
  restoreFocusKey?: string;
  autoFocusDelay?: number;
}

export function useDialogFocusBoundary({
  isOpen,
  focusKey: customFocusKey,
  preferredChildFocusKey,
  restoreFocusKey,
  autoFocusDelay = 30,
}: UseDialogFocusBoundaryOptions) {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const { registerModal } = useModalFocus();

  // Register this modal with the global ModalFocusContext whenever isOpen is true
  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerModal();
    return () => {
      unregister();
    };
  }, [isOpen, registerModal]);

  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: customFocusKey,
    focusable: isOpen,
    isFocusBoundary: true,
    focusBoundaryDirections: ["up", "down", "left", "right"],
    trackChildren: true,
    preferredChildFocusKey,
  });

  // Focus preferred child on open with multi-frame retries (only once per open session)
  const hasFocusedOnOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasFocusedOnOpenRef.current = false;
      return;
    }
    if (hasFocusedOnOpenRef.current) return;
    hasFocusedOnOpenRef.current = true;

    let mounted = true;
    let attempts = 0;
    const maxAttempts = 20;

    const tryFocusChild = () => {
      if (!mounted) return;
      if (preferredChildFocusKey && doesFocusableExist(preferredChildFocusKey)) {
        setFocus(preferredChildFocusKey);
      } else if (attempts < maxAttempts) {
        attempts++;
        window.setTimeout(tryFocusChild, 25);
      } else {
        focusSelf();
      }
    };

    const timer = window.setTimeout(tryFocusChild, autoFocusDelay);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, preferredChildFocusKey, focusSelf, autoFocusDelay]);

  // Restore focus to trigger button on dialog close
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevOpenRef.current && !isOpen && restoreFocusKey) {
      let attempts = 0;
      const tryRestore = () => {
        if (doesFocusableExist(restoreFocusKey)) {
          setFocus(restoreFocusKey);
        } else if (attempts < 12) {
          attempts++;
          window.setTimeout(tryRestore, 35);
        }
      };
      window.setTimeout(tryRestore, 40);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, restoreFocusKey]);

  /**
   * Helper component to wrap the dialog content with isolated FocusContext and InModalProvider
   */
  const DialogFocusProvider = useCallback(
    ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        InModalProvider,
        null,
        React.createElement(
          FocusContext.Provider,
          { value: ROOT_FOCUS_KEY },
          React.createElement(
            FocusContext.Provider,
            { value: focusKey },
            children,
          ),
        ),
      ),
    [focusKey],
  );

  return { ref, focusKey, focusSelf, tvMode, DialogFocusProvider };
}
