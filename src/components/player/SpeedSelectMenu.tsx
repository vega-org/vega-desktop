import React, { useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";

interface SpeedSelectMenuProps {
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export const SpeedSelectMenu: React.FC<SpeedSelectMenuProps> = ({
  playbackRate,
  onPlaybackRateChange,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_SPEED_MENU",
    focusable: tvMode,
  });

  useEffect(() => {
    if (tvMode) {
      const timer = setTimeout(() => focusSelf(), 30);
      return () => clearTimeout(timer);
    }
  }, [focusSelf, tvMode]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={menuRef} className="inline-menu left" onClick={stop}>
        {SPEED_OPTIONS.map((rate) => {
          const isSelected = Math.abs(playbackRate - rate) < 0.01;
          return (
            <FocusableButton
              key={rate}
              focusable={true}
              focusKey={`SPEED_ITEM_${rate.toString().replace(".", "_")}`}
              className={`inline-menu-item ${isSelected ? "selected" : ""}`}
              onClick={() => {
                onPlaybackRateChange(rate);
                onClose();
              }}
            >
              <span>{rate}x</span>
              {isSelected && <Check size={14} />}
            </FocusableButton>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
};
