import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  LuExternalLink as ExternalLink,
  LuGithub as GitHub,
  LuStar as Star,
} from "react-icons/lu";
import { socialLinks } from "../../lib/constants";
import { FocusableButton } from "../layout/FocusableButton";

const particles = [0, 1, 2, 3, 4, 5];

export const GitHubStarButton: React.FC = () => {
  const [celebrating, setCelebrating] = React.useState(false);

  const handleClick = () => {
    if (celebrating) {
      return;
    }

    setCelebrating(true);
    window.setTimeout(() => {
      void openUrl(socialLinks.github).finally(() => setCelebrating(false));
    }, 480);
  };

  return (
    <FocusableButton
      className={`github-star-btn ${celebrating ? "is-celebrating" : ""}`}
      onClick={handleClick}
      title="Star Vega on GitHub"
      aria-label="Star Vega on GitHub"
    >
      <span className="github-star-icon" aria-hidden="true">
        <GitHub size={22} />
        <span className="github-star-particles">
          {particles.map((particle) => (
            <Star
              key={particle}
              size={10}
              className={`particle particle-${particle}`}
            />
          ))}
        </span>
      </span>
      <span>{celebrating ? "You are a star!" : "Star Vega on GitHub"}</span>
      <ExternalLink
        className="github-star-external"
        size={18}
        aria-hidden="true"
      />
    </FocusableButton>
  );
};
