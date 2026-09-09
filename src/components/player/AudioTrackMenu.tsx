import React, { useRef, useState, useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuAudioLines, LuMinus as Minus, LuPlus as Plus, LuCheck as Check } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";
import type { MpvTrack } from "../../lib/player/PlayerEngine";

interface AudioTrackMenuProps {
  audioTracks: MpvTrack[];
  audioDelay: number;
  onAudioDelayChange?: (delayMs: number) => void;
  onSelectAudioTrack: (id: number | "no" | "auto") => void;
  onClose: () => void;
}

export const AudioTrackMenu: React.FC<AudioTrackMenuProps> = ({
  audioTracks,
  audioDelay,
  onAudioDelayChange,
  onSelectAudioTrack,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_AUDIO_MENU",
    focusable: tvMode,
  });

  const [isEditingDelay, setIsEditingDelay] = useState(false);
  const [customDelayInput, setCustomDelayInput] = useState(String(audioDelay));
  const delayInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCustomDelayInput(String(audioDelay));
  }, [audioDelay]);

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
      onAudioDelayChange?.(parsed);
    } else {
      setCustomDelayInput(String(audioDelay));
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
            <LuAudioLines size={16} />
            <span>Sync</span>
          </div>
          <div className="inline-menu-zoom-actions">
            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="AUDIO_SYNC_MINUS"
              onClick={(e) => {
                e.stopPropagation();
                onAudioDelayChange?.(audioDelay - 50);
              }}
              title="Audio earlier (-50ms)"
              aria-label="Audio earlier"
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
                      setCustomDelayInput(String(audioDelay));
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
                className={`zoom-level-badge ${audioDelay !== 0 ? "custom" : ""}`}
                focusable={true}
                focusKey="AUDIO_SYNC_VALUE"
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomDelayInput(String(audioDelay));
                  setIsEditingDelay(true);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onAudioDelayChange?.(0);
                }}
                title="Click to enter custom delay (ms), double-click to reset"
              >
                {audioDelay > 0 ? `+${audioDelay}ms` : `${audioDelay}ms`}
              </FocusableButton>
            )}

            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="AUDIO_SYNC_PLUS"
              onClick={(e) => {
                e.stopPropagation();
                onAudioDelayChange?.(audioDelay + 50);
              }}
              title="Audio later (+50ms)"
              aria-label="Audio later"
            >
              <Plus size={13} />
            </FocusableButton>
          </div>
        </div>

        {audioTracks.length === 0 && (
          <div className="inline-menu-item">No audio tracks</div>
        )}

        {audioTracks.map((t, idx) => {
          const mainName =
            t.lang && t.lang !== "und"
              ? t.lang.toUpperCase()
              : t.title || `Audio ${idx + 1}`;
          const subName =
            t.title && t.lang && t.lang !== "und" && t.title.toLowerCase() !== t.lang.toLowerCase()
              ? t.title
              : t.codec && t.codec !== "auto"
                ? t.codec.toUpperCase()
                : "";

          return (
            <FocusableButton
              key={t.id}
              focusable={true}
              focusKey={`AUDIO_TRACK_${t.id}_${idx}`}
              className={`inline-menu-item ${t.selected ? "selected" : ""}`}
              onClick={() => {
                onSelectAudioTrack(t.id);
                onClose();
              }}
            >
              <div className="track-details">
                <span className="track-name">{mainName}</span>
                {subName && <span className="track-lang">{subName}</span>}
              </div>
              {t.selected && <Check size={14} />}
            </FocusableButton>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
};
