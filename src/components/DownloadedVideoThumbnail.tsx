import { useEffect, useState } from "react";
import { getDownloadedVideoThumbnail } from "../lib/downloadThumbnailCache";

interface DownloadedVideoThumbnailProps {
  filePath: string;
  title: string;
}

export const DownloadedVideoThumbnail = ({
  filePath,
  title,
}: DownloadedVideoThumbnailProps) => {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setThumbnail(null);

    void getDownloadedVideoThumbnail(filePath).then((result) => {
      if (active) setThumbnail(result);
    });

    return () => {
      active = false;
    };
  }, [filePath]);

  return (
    <span className="downloaded-video-thumbnail" aria-hidden="true">
      {thumbnail && <img src={thumbnail} alt={`${title} thumbnail`} />}
      <span className="downloaded-thumbnail-play" />
    </span>
  );
};
