import React, { useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";

interface ServerSelectMenuProps {
  streamData?: any[];
  selectedStream?: any;
  onSelectStream?: (stream: any) => void;
  onClose: () => void;
}

export const ServerSelectMenu: React.FC<ServerSelectMenuProps> = ({
  streamData,
  selectedStream,
  onSelectStream,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_SERVER_MENU",
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
      <div ref={menuRef} className="inline-menu right wide" onClick={stop}>
        {(!streamData || streamData.length === 0) && (
          <div className="inline-menu-item">No alternative servers</div>
        )}
        {streamData?.map((s: any, idx: number) => {
          const rawTags: string[] = Array.isArray(s.tags)
            ? s.tags
            : typeof s.tag === "string"
              ? [s.tag]
              : [];
          const tags = rawTags
            .map((t) => (typeof t === "string" ? t.trim() : ""))
            .filter(
              (t) =>
                Boolean(t) &&
                t.toLowerCase() !== s.quality?.toString().trim().toLowerCase(),
            );

          return (
            <FocusableButton
              key={idx}
              focusable={true}
              focusKey={`SERVER_ITEM_${idx}`}
              className={`inline-menu-item ${selectedStream?.link === s.link ? "selected" : ""}`}
              onClick={() => {
                onSelectStream?.(s);
                onClose();
              }}
            >
              <div className="track-details">
                <span className="track-name">
                  {s.server || `Server ${idx + 1}`}
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {s.quality && (
                    <span className="track-lang">{s.quality}</span>
                  )}
                  {tags.map((t, tIdx) => (
                    <span
                      key={tIdx}
                      className="track-lang"
                      style={{ opacity: 0.85 }}
                    >
                      {t.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
              {selectedStream?.link === s.link && <Check size={14} />}
            </FocusableButton>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
};
