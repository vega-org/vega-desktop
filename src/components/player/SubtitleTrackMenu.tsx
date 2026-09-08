import React, { useRef, useState, useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCaptions as Subtitles, LuMinus as Minus, LuPlus as Plus, LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";
import type { MpvTrack } from "../../lib/hooks/useMpvPlayer";

interface SubtitleTrackMenuProps {
  subtitleTracks: MpvTrack[];
  subtitleDelay: number;
  onSubtitleDelayChange?: (delayMs: number) => void;
  onSelectSubtitleTrack: (id: number | "no" | "auto") => void;
  onShowOnlineSearch: () => void;
  onLoadLocalSubtitle: () => void;
  onClose: () => void;
}

export const SubtitleTrackMenu: React.FC<SubtitleTrackMenuProps> = ({
  subtitleTracks,
  subtitleDelay,
  onSubtitleDelayChange,
  onSelectSubtitleTrack,
  onShowOnlineSearch,
  onLoadLocalSubtitle,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_SUBTITLE_MENU",
    focusable: tvMode,
  });

  const [isEditingDelay, setIsEditingDelay] = useState(false);
  const [customDelayInput, setCustomDelayInput] = useState(String(subtitleDelay));
  const delayInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCustomDelayInput(String(subtitleDelay));
  }, [subtitleDelay]);

  useEffect(() => {
    if (isEditingDelay) {
      delayInputRef.current?.focus();
      delayInputRef.current?.select();
    }
  }, [isEditingDelay]);

  useEffect(() => {
    if (tvMode) {
      const timer = setTimeout(() => focusSelf(), 30);
      return () => clearTimeout(timer);
    }
  }, [focusSelf, tvMode]);

  const handleSaveCustomDelay = () => {
    const parsed = parseInt(customDelayInput, 10);
    if (!isNaN(parsed)) {
      onSubtitleDelayChange?.(parsed);
    } else {
      setCustomDelayInput(String(subtitleDelay));
    }
    setIsEditingDelay(false);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={menuRef} className="inline-menu left wide" onClick={stop}>
        <div
          className="inline-menu-zoom-row"
          style={{
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            marginBottom: "4px",
            paddingBottom: "8px",
          }}
        >
          <div className="inline-menu-zoom-label">
            <Subtitles size={16} />
            <span>Sync</span>
          </div>
          <div className="inline-menu-zoom-actions">
            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="SUB_SYNC_MINUS"
              onClick={(e) => {
                e.stopPropagation();
                onSubtitleDelayChange?.(subtitleDelay - 50);
              }}
              title="Subtitles earlier (-50ms)"
              aria-label="Subtitles earlier"
            >
              <Minus size={13} />
            </FocusableButton>

            {isEditingDelay ? (
              <div
                className="delay-input-wrapper"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={delayInputRef}
                  type="number"
                  step={10}
                  className="delay-level-input"
                  value={customDelayInput}
                  onChange={(e) => setCustomDelayInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveCustomDelay();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setCustomDelayInput(String(subtitleDelay));
                      setIsEditingDelay(false);
                    }
                  }}
                  onBlur={handleSaveCustomDelay}
                />
                <span className="delay-input-unit">ms</span>
              </div>
            ) : (
              <FocusableButton
                type="button"
                className={`zoom-level-badge ${subtitleDelay !== 0 ? "custom" : ""}`}
                focusable={true}
                focusKey="SUB_SYNC_VALUE"
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomDelayInput(String(subtitleDelay));
                  setIsEditingDelay(true);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSubtitleDelayChange?.(0);
                }}
                title="Click to enter custom delay (ms), double-click to reset"
              >
                {subtitleDelay > 0 ? `+${subtitleDelay}ms` : `${subtitleDelay}ms`}
              </FocusableButton>
            )}

            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="SUB_SYNC_PLUS"
              onClick={(e) => {
                e.stopPropagation();
                onSubtitleDelayChange?.(subtitleDelay + 50);
              }}
              title="Subtitles later (+50ms)"
              aria-label="Subtitles later"
            >
              <Plus size={13} />
            </FocusableButton>
          </div>
        </div>

        <FocusableButton
          focusable={true}
          focusKey="SUB_TRACK_OFF"
          className={`inline-menu-item ${!subtitleTracks.some((t) => t.selected) ? "selected" : ""}`}
          onClick={() => {
            onSelectSubtitleTrack("no");
            onClose();
          }}
        >
          <span>Off</span>
          {!subtitleTracks.some((t) => t.selected) && <Check size={14} />}
        </FocusableButton>

        {subtitleTracks.map((t, subIdx) => {
          const isDuplicateLang = Boolean(
            t.lang &&
            t.lang !== "und" &&
            t.lang !== "ext" &&
            subtitleTracks.filter((x) => (x.lang || "").toLowerCase() === t.lang.toLowerCase()).length > 1
          );

          const mainLabel =
            t.lang && t.lang !== "und" && t.lang !== "ext"
              ? `${t.lang.toUpperCase()}${isDuplicateLang ? ` #${subIdx + 1}` : ""}`
              : t.title || `Subtitle ${subIdx + 1}`;

          const secondaryLabel =
            t.title &&
              t.lang &&
              t.lang !== "und" &&
              t.lang !== "ext" &&
              t.title.toLowerCase() !== t.lang.toLowerCase()
              ? t.title
              : "";

          return (
            <FocusableButton
              key={t.id}
              focusable={true}
              focusKey={`SUB_TRACK_${t.id}_${subIdx}`}
              className={`inline-menu-item ${t.selected ? "selected" : ""}`}
              onClick={() => {
                onSelectSubtitleTrack(t.id);
                onClose();
              }}
            >
              <div className="track-details">
                <span className="track-name">
                  {mainLabel}
                  {(t as any).isBitmapSub && (
                    <span
                      style={{
                        fontSize: "10px",
                        opacity: 0.65,
                        marginLeft: "6px",
                        padding: "1px 4px",
                        borderRadius: "3px",
                        background: "rgba(255,255,255,0.15)",
                      }}
                    >
                      Image
                    </span>
                  )}
                </span>
                {secondaryLabel && (
                  <span className="track-lang">
                    {secondaryLabel}
                    {(t as any).isBitmapSub ? " (Bitmap - requires Native)" : ""}
                  </span>
                )}
              </div>
              {t.selected && <Check size={14} />}
            </FocusableButton>
          );
        })}

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.1)",
            margin: "4px 0",
          }}
        />

        <FocusableButton
          focusable={true}
          focusKey="SUB_ACTION_SEARCH"
          className="inline-menu-item"
          onClick={() => {
            onClose();
            onShowOnlineSearch();
          }}
        >
          <span>Search online...</span>
        </FocusableButton>

        <FocusableButton
          focusable={true}
          focusKey="SUB_ACTION_LOCAL"
          className="inline-menu-item"
          onClick={() => {
            onClose();
            onLoadLocalSubtitle();
          }}
        >
          <span>Load local subtitle...</span>
        </FocusableButton>
      </div>
    </FocusContext.Provider>
  );
};
