import React, { useCallback, useState } from "react";

interface PlayerInitErrorProps {
  error: string;
  onBack: () => void;
  onOpenVlc?: () => void;
}

export const PlayerInitError: React.FC<PlayerInitErrorProps> = ({
  error,
  onBack,
  onOpenVlc,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(error).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }, [error]);

  return (
    <div className="player-page controls-visible">
      <div className="player-error">
        <h2>Player could not start</h2>
        <p className="player-error-message">{error}</p>
        <div className="player-error-actions">
          {onOpenVlc && <button onClick={onOpenVlc}>Open in VLC</button>}
          <button onClick={handleCopy}>
            {copied ? "Copied" : "Copy Error"}
          </button>
          <button onClick={onBack}>Go Back</button>
        </div>
      </div>
    </div>
  );
};
