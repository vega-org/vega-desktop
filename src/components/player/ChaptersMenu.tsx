import React, { useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";
import type { MpvChapter } from "../../lib/player/PlayerEngine";

interface ChaptersMenuProps {
  chapters: MpvChapter[];
  activeChapterIndex: number;
  formatTime: (timeInSeconds: number) => string;
  onSeek: (time: number) => void;
  onClose: () => void;
}

export const ChaptersMenu: React.FC<ChaptersMenuProps> = ({
  chapters,
  activeChapterIndex,
  formatTime,
  onSeek,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_CHAPTERS_MENU",
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
      <div ref={menuRef} className="inline-menu left chapters-menu" onClick={stop}>
        {chapters.map((chapter, index) => {
          const isSelected = index === activeChapterIndex;
          return (
            <FocusableButton
              key={`${chapter.time}-${index}`}
              focusable={true}
              focusKey={`CHAPTER_ITEM_${index}`}
              className={`inline-menu-item chapter-menu-item ${isSelected ? "selected" : ""}`}
              onClick={() => {
                onSeek(chapter.time);
                onClose();
              }}
            >
              <span className="chapter-menu-title">{chapter.title}</span>
              <span className="chapter-menu-time">
                {formatTime(chapter.time)}
              </span>
              {isSelected && <Check size={14} />}
            </FocusableButton>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
};
