import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import './ContentSlider.css';

interface Post {
  title: string;
  image: string;
  link: string;
  progress?: number; // Optional progress percentage (0-1)
  providerValue?: string;
  type?: string;
  episodeTitle?: string;
}

interface ContentSliderProps {
  title: string;
  posts: Post[];
  isLoading?: boolean;
  providerValue?: string;
  onRemove?: (post: Post, e: React.MouseEvent) => void;
}

export const ContentSlider: React.FC<ContentSliderProps> = ({ title, posts, isLoading, providerValue, onRemove }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.8;
      const targetScroll = scrollRef.current.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount);
      scrollRef.current.scrollTo({
        left: targetScroll,
        behavior: 'smooth'
      });
    }
  };

  const handlePostClick = (post: Post) => {
    const finalProvider = post.providerValue || providerValue;

    if (finalProvider === 'local') {
      if (post.type === 'series') {
        navigate(`/downloads/series/${encodeURIComponent(post.title)}`);
      } else {
        navigate('/downloads');
      }
      return;
    }

    let url = `/content/${encodeURIComponent(post.link)}`;
    if (finalProvider) {
      url += `?provider=${encodeURIComponent(finalProvider)}`;
    }
    navigate(url);
  };

  if (isLoading) {
    return (
      <div className="slider-container">
        <h2 className="slider-title headline-md skeleton-text" />
        <div className="slider-row skeleton-row">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="post-card skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return null;
  }

  return (
    <div className="slider-container">
      <h2 className="slider-title headline-md">{title}</h2>
      
      <div className="slider-wrapper">
        <button 
          className="slider-arrow left glass-overlay" 
          onClick={() => handleScroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={32} />
        </button>

        <div className="slider-row" ref={scrollRef}>
          {posts.map((post, index) => (
            <div 
              key={`${post.link}-${index}`}
              className="post-card"
              onClick={() => handlePostClick(post)}
            >
              <div className="post-image-container">
                <img 
                  src={post.image} 
                  alt={post.title} 
                  className="post-image"
                  loading="lazy"
                />
                <div className="post-hover-overlay">
                  <Play size={48} fill="currentColor" />
                </div>
                {onRemove && (
                  <button 
                    className="post-remove-btn" 
                    onClick={(e) => onRemove(post, e)}
                    title="Remove from history"
                  >
                    <X size={20} />
                  </button>
                )}
                {post.progress !== undefined && (
                  <div className="post-progress-bar-container">
                    <div 
                      className="post-progress-bar-fill"
                      style={{ width: `${post.progress * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <h3 className="post-title label-md">{post.title}</h3>
            </div>
          ))}
        </div>

        <button 
          className="slider-arrow right glass-overlay" 
          onClick={() => handleScroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={32} />
        </button>
      </div>
    </div>
  );
};
