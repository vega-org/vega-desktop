import React from 'react';
import { Play, Info } from 'lucide-react';
import { useHeroMetadata } from '../../lib/hooks/useHomePageData';
import { useNavigate } from 'react-router-dom';
import useContentStore from '../../lib/zustand/contentStore';
import './Hero.css';

interface HeroProps {
  post: {
    title: string;
    image: string;
    link: string;
  } | null;
}

export const Hero: React.FC<HeroProps> = ({ post }) => {
  const navigate = useNavigate();
  const { provider } = useContentStore();

  const { data: meta } = useHeroMetadata(
    post?.link || '',
    provider?.value || ''
  );

  if (!post) {
    return (
      <div className="hero-container skeleton">
        <div className="hero-skeleton-bg" />
      </div>
    );
  }

  // Use high-res background from meta if available, otherwise use post.image
  const bgImage = meta?.background || post.image;
  // Use logo if available, otherwise just text
  const logoUrl = meta?.logo;
  const description = meta?.description || meta?.plot || '';

  const handleInfoClick = () => {
    // Navigate to details page. Ensure link is encoded to pass as URL param safely.
    navigate(`/content/${encodeURIComponent(post.link)}`);
  };

  const handlePlayClick = () => {
    // For now, redirect to details page. Later it will directly play or show episodes.
    navigate(`/content/${encodeURIComponent(post.link)}`);
  };

  return (
    <div className="hero-container">
      <div
        className="hero-background"
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <div className="hero-vignette" />

      <div className="hero-content">
        {logoUrl ? (
          <img src={logoUrl} alt={post.title} className="hero-logo" />
        ) : (
          <h1 className="hero-title display-lg">{post.title}</h1>
        )}

        {description && (
          <p className="hero-description body-lg">
            {description}
          </p>
        )}

        <div className="hero-actions">
          <button className="btn-play" onClick={handlePlayClick}>
            <Play size={24} fill="currentColor" />
            <span className="label-lg">Play</span>
          </button>

          {/* <button className="btn-info glass-overlay" onClick={handleInfoClick}>
            <Info size={24} />
            <span className="label-lg">More Info</span>
          </button> */}
        </div>
      </div>
    </div>
  );
};
