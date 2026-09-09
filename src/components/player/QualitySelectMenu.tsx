import React, { useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";
import type { MpvTrack } from "../../lib/player/PlayerEngine";

interface QualitySelectMenuProps {
  videoTracks?: MpvTrack[];
  videoHeight?: number;
  selectedStream?: any;
  getQualityInfo: (h: number, fallbackStr: string) => { text: string; Icon: any };
  onSelectVideoTrack: (id: number | "no" | "auto") => void;
  onClose: () => void;
}

export const QualitySelectMenu: React.FC<QualitySelectMenuProps> = ({
  videoTracks = [],
  videoHeight = 0,
  selectedStream,
  getQualityInfo,
  onSelectVideoTrack,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_QUALITY_MENU",
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
        <FocusableButton
          focusable={true}
          focusKey="QUALITY_ITEM_AUTO"
          className={`inline-menu-item ${!videoTracks.some((t) => t.selected) ? "selected" : ""}`}
          onClick={() => {
            onSelectVideoTrack("auto");
            onClose();
          }}
        >
          <span>Auto</span>
          {!videoTracks.some((t) => t.selected) && <Check size={14} />}
        </FocusableButton>

        {videoTracks.map((t, idx) => {
          const h = t.demuxH || (t.selected ? videoHeight : 0);
          const fallback =
            t.selected && selectedStream?.quality
              ? selectedStream.quality
              : t.title || t.codec || `Track ${t.id}`;
          const info = getQualityInfo(h, fallback);
          const primary = info.text;
          const secondary =
            h || (t.selected && selectedStream?.quality)
              ? t.title || t.codec
              : null;

          return (
            <FocusableButton
              key={t.id}
              focusable={true}
              focusKey={`QUALITY_ITEM_${t.id}_${idx}`}
              className={`inline-menu-item ${t.selected ? "selected" : ""}`}
              onClick={() => {
                onSelectVideoTrack(t.id);
                onClose();
              }}
            >
              <div className="track-details">
                <span className="track-name">{primary}</span>
                {secondary && <span className="track-lang">{secondary}</span>}
              </div>
              {t.selected && <Check size={14} />}
            </FocusableButton>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
};
