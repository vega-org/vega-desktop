import React from "react";
import { LuPlay, LuSkipForward } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";

export interface ResumeTarget {
  mode: "resume" | "next" | "start";
  title: string;
  /** Season label shown before the title, when it differs from the open one. */
  seasonTitle?: string;
  /** Watched fraction, 0 to 1. */
  progress?: number;
  /** Seconds left, for the "left" label. */
  remainingSeconds?: number;
}

const HEADINGS: Record<ResumeTarget["mode"], string> = {
  resume: "Resume",
  next: "Up next",
  start: "Start watching",
};

const formatRemaining = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
};

/** Leading button of the title actions; same targets as the mobile app. */
export const ResumeButton: React.FC<{
  target: ResumeTarget;
  onPress: () => void;
}> = ({ target, onPress }) => {
  const details = [
    target.seasonTitle,
    target.title,
    target.mode === "resume" && target.remainingSeconds
      ? formatRemaining(target.remainingSeconds)
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const Icon = target.mode === "next" ? LuSkipForward : LuPlay;

  return (
    <FocusableButton
      className="content-resume-button"
      focusKey="CONTENT_RESUME"
      aria-label={`${HEADINGS[target.mode]} ${details}`}
      title={details}
      onClick={onPress}
    >
      <Icon size={16} fill="currentColor" aria-hidden="true" />
      <strong>{HEADINGS[target.mode]}</strong>
      {details && <span className="content-resume-detail">{details}</span>}
      {target.mode === "resume" && target.progress ? (
        <span className="content-resume-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(target.progress, 1) * 100}%` }} />
        </span>
      ) : null}
    </FocusableButton>
  );
};
