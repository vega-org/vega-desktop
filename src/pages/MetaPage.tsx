import React, { useMemo, useState, useEffect } from 'react';
import useWatchListStore from '../lib/zustand/watchListStore';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookmarkPlus, Video, Download, Loader2, BookmarkCheck, Trash2 } from 'lucide-react';
import { useContentDetails } from '../lib/hooks/useContentInfo';
import { useEpisodes } from '../lib/hooks/useEpisodes';
import useContentStore from '../lib/zustand/contentStore';
import { useDownloadStore } from '../lib/zustand/downloadStore';
import { providerManager } from '../lib/services/ProviderManager';
import { DownloadServerDialog } from '../components/DownloadServerDialog';
import { CustomSelect } from '../components/CustomSelect';
import { Link, Stream } from '../lib/providers/types';
import { settingsStorage } from '../lib/storage/SettingsStorage';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation-react';
import './MetaPage.css';

import { FocusableButton } from '../components/layout/FocusableButton';

const FocusableEpisodeCard: React.FC<{
  onClick: () => void;
  children: React.ReactNode[];
}> = ({ onClick, children }) => {
  return (
    <div className={`episode-card glass-overlay`} style={{ padding: 0, display: 'flex' }}>
      <FocusableButton 
        onClick={onClick} 
        className="episode-main-clickable" 
        style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          padding: '16px', 
          gap: '16px', 
          background: 'transparent', 
          border: 'none', 
          textAlign: 'left', 
          color: 'inherit',
          borderRadius: 'var(--rounded-lg)',
          minWidth: 0
        }}
      >
        {children[0]}
        {children[1]}
      </FocusableButton>
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
        {children[2]}
      </div>
    </div>
  );
};

const DownloadActionButton = ({
  id,
  ep,
  idx,
  type,
  seasonTitle,
  downloads,
  downloadingId,
  onDownloadClick,
  onDeleteClick
}: any) => {
  const isExtracting = downloadingId === id;
  const downloadState = downloads[id];

  if (isExtracting) {
    return (
      <FocusableButton 
        className="icon-btn opacity-50 cursor-not-allowed" 
        disabled 
        title="Extracting links..."
        onClick={(e: any) => e.stopPropagation?.()}
      >
        <Loader2 size={20} className="animate-spin text-primary" />
      </FocusableButton>
    );
  }

  if (downloadState) {
    if (downloadState.status === 'completed') {
      return (
        <FocusableButton 
          className="icon-btn" 
          onClick={(e: any) => {
            e.stopPropagation?.();
            if (window.confirm('Are you sure you want to delete this download?')) {
              onDeleteClick(id);
            }
          }}
          title="Delete Download"
        >
          <Trash2 size={20} className="text-primary" />
        </FocusableButton>
      );
    } else if (['downloading', 'queued', 'paused'].includes(downloadState.status)) {
      const progress = downloadState.totalBytes > 0 
        ? Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100) 
        : 0;
      return (
        <FocusableButton 
          className="icon-btn" 
          title={`Downloading: ${progress}%`}
          onClick={(e: any) => e.stopPropagation?.()}
          style={{ cursor: 'default' }}
        >
          <div style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: `conic-gradient(var(--primary) ${progress}%, transparent ${progress}%)`,
            border: '2px solid var(--surface-variant)',
            display: 'inline-block'
          }} />
        </FocusableButton>
      );
    } else if (downloadState.status === 'error') {
      return (
        <FocusableButton 
          className="icon-btn" 
          onClick={(e: any) => {
            e.stopPropagation?.();
            onDownloadClick(ep, idx, type, seasonTitle, id);
          }} 
          title="Retry Download"
        >
          <Download size={20} className="text-red-500" />
        </FocusableButton>
      );
    }
  }

  return (
    <FocusableButton
      className="icon-btn"
      onClick={(e: any) => {
        e.stopPropagation?.();
        onDownloadClick(ep, idx, type, seasonTitle, id);
      }}
      title="Download"
    >
      <Download size={20} className="text-primary" />
    </FocusableButton>
  );
};


export const MetaPage: React.FC = () => {
  const { url } = useParams<{ url: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { provider } = useContentStore();
  const { addDownload, downloads, cancelDownload } = useDownloadStore();
  const { watchList, addItem, removeItem } = useWatchListStore();
  const tvMode = settingsStorage.isTvModeEnabled();

  const { ref: focusRef, focusKey } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
  });

  const link = decodeURIComponent(url || '');
  const urlProvider = searchParams.get('provider');
  const activeProviderValue = urlProvider || provider?.value || '';

  const { info, meta, isLoading, error } = useContentDetails(
    link,
    activeProviderValue
  );

  const [activeSeason, setActiveSeason] = useState<Link | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogStreams, setDialogStreams] = useState<Stream[]>([]);
  const [dialogEpisodeTitle, setDialogEpisodeTitle] = useState('');
  const [dialogContext, setDialogContext] = useState<{
    id: string,
    title: string,
    poster: string,
    showName?: string,
    episodeName?: string,
    seasonTitle?: string,
    type: 'movie' | 'series',
    imdbId?: string
  } | null>(null);

  const excludedQualities = useMemo(() => settingsStorage.getExcludedQualities() || [], []);

  const filteredLinkList = useMemo(() => {
    if (!info?.linkList) return [];
    return info.linkList.filter((season: Link) => {
      // Exclude if the title contains any of the excluded qualities
      return !excludedQualities.some((q: string) => season.title.toLowerCase().includes(q.toLowerCase()));
    });
  }, [info?.linkList, excludedQualities]);

  // Scroll to top on page load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [link]);

  // Initialize activeSeason once info is loaded
  useEffect(() => {
    if (filteredLinkList && filteredLinkList.length > 0 && !activeSeason) {
      const savedTitle = localStorage.getItem(`vega_season_${link}`);
      let defaultSeason = filteredLinkList[0];
      if (savedTitle) {
        const found = filteredLinkList.find((l: Link) => l.title === savedTitle);
        if (found) defaultSeason = found;
      }
      setActiveSeason(defaultSeason);
    }
  }, [filteredLinkList, activeSeason, link]);

  // Fetch episodes if the active season uses episodesLink
  const { data: episodeList, isLoading: episodeLoading, error: episodeError } = useEpisodes(
    activeSeason?.episodesLink,
    activeProviderValue,
    !!activeSeason?.episodesLink
  );

  const bgImage = useMemo(() => meta?.background || info?.image, [meta, info]);
  const urlPoster = searchParams.get('poster');
  const posterImage = useMemo(() => meta?.poster || info?.image || urlPoster, [meta, info, urlPoster]);
  const title = useMemo(() => meta?.name || info?.title, [meta, info]);
  const description = useMemo(() => meta?.description || info?.synopsis || info?.description, [meta, info]);
  const year = useMemo(() => meta?.year || info?.year, [meta, info]);

  const isInWatchList = useMemo(() => {
    return watchList.some(item => item.link === link);
  }, [watchList, link]);

  const toggleWatchList = () => {
    if (isInWatchList) {
      removeItem(link);
    } else {
      addItem({
        title: title || info?.title || '',
        poster: posterImage || '',
        link: link,
        provider: activeProviderValue,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="meta-page skeleton-page">
        <div className="meta-header" style={{ width: 'calc(100% - 32px)', display: 'flex', justifyContent: 'space-between' }}>
          <FocusableButton className="icon-btn back-btn glass-overlay" onClick={() => navigate(-1)}>
            <ArrowLeft size={24} />
          </FocusableButton>
        </div>
        <div className="meta-hero-bg-container">
          <div className="meta-hero-bg skeleton-bg" />
        </div>
        <div className="meta-hero-content-wrapper">
          <div className="meta-hero-vignette">
            <div className="meta-hero-content">
              <div className="skeleton-title" />
              <div className="meta-tags">
                <div className="skeleton-tag" />
                <div className="skeleton-tag" />
                <div className="skeleton-tag" />
              </div>
            </div>
          </div>
        </div>
        <div className="meta-content-wrapper">
          <div className="meta-content-inner">
            <div className="meta-details">
              <div className="skeleton-text" />
              <div className="skeleton-text" />
              <div className="skeleton-text" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="error-state">
        <h2 className="headline-md">Failed to load details</h2>
        <p className="body-md text-muted">{error?.message || 'Content not found'}</p>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Go Back
        </button>
      </div>
    );
  }

  const handlePlayClick = (episodeData: any[], linkIndex: number, type: string) => {
    navigate('/player', {
      state: {
        episodeList: episodeData,
        linkIndex,
        primaryTitle: meta?.name || meta?.title || info?.title || '',
        secondaryTitle: activeSeason?.title || '',
        type,
        poster: {
          poster: posterImage,
          logo: meta?.logo,
          background: bgImage,
        },
        providerValue: activeProviderValue,
        infoUrl: link,
      },
    });
  };

  const handleDownloadClick = async (ep: { title: string, link: string }, idx: number, type: string, seasonTitle?: string, exactId?: string) => {
    try {
      const baseTitle = meta?.name || meta?.title || info?.title || 'Unknown Title';

      const id = exactId || (seasonTitle
        ? `${baseTitle}_S${seasonTitle}_E${idx + 1}`
        : `${baseTitle}_direct_${idx}`);

      setDownloadingId(id);

      const controller = new AbortController();
      const streams = await providerManager.getStream({
        link: ep.link,
        type: type,
        signal: controller.signal,
        providerValue: activeProviderValue
      });

      if (streams && streams.length > 0) {
        setDialogStreams(streams);

        const finalTitle = seasonTitle ? `${baseTitle} S${seasonTitle} E${idx + 1}` : (ep.title || baseTitle || 'Download');

        setDialogEpisodeTitle(finalTitle);
        setDialogContext({
          id,
          title: finalTitle,
          poster: meta?.poster || info?.poster || posterImage || '',
          showName: baseTitle,
          episodeName: ep.title,
          seasonTitle: seasonTitle,
          type: (type as 'movie' | 'series') || 'movie',
          imdbId: meta?.imdbId
        });
      } else {
        console.error("No streams found to download");
      }
    } catch (err) {
      console.error("Failed to extract stream for download", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleStreamSelected = async (stream: Stream) => {
    if (!dialogContext) return;

    await addDownload({
      id: dialogContext.id,
      title: dialogContext.title,
      url: stream.link,
      poster: dialogContext.poster,
      provider: activeProviderValue || 'unknown',
      showName: dialogContext.showName,
      episodeName: dialogContext.episodeName,
      seasonTitle: dialogContext.seasonTitle,
      type: dialogContext.type,
      imdbId: dialogContext.imdbId
    });

    // Clear context
    setDialogContext(null);
    setDialogStreams([]);
  };


  return (
    <FocusContext.Provider value={focusKey}>
      <div className="meta-page" ref={focusRef as any}>
        <div className="meta-header" style={{ width: 'calc(100% - 32px)', display: 'flex', justifyContent: 'space-between' }}>
          <FocusableButton className="icon-btn back-btn glass-overlay" onClick={() => navigate(-1)}>
            <ArrowLeft size={24} />
          </FocusableButton>
        </div>

      {/* Fixed Background Image */}
      <div className="meta-hero-bg-container">
        <div
          className="meta-hero-bg"
          style={bgImage ? { backgroundImage: `url(${bgImage})` } : {}}
        />
      </div>

      {/* Scrolling Header with Logo */}
      <div className="meta-hero-content-wrapper">
        <div className="meta-hero-vignette">
          <div className="meta-hero-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px' }}>
            <div>
              {meta?.logo ? (
                <img src={meta.logo} alt={title} className="meta-logo" />
              ) : (
                <h1 className="display-lg meta-title">{title}</h1>
              )}

              <div className="meta-tags">
                {year && <span className="meta-tag">{year}</span>}
                {meta?.runtime && <span className="meta-tag">{meta.runtime}</span>}
                {meta?.imdbRating && <span className="meta-tag">⭐ {meta.imdbRating}</span>}
                {info?.type && <span className="meta-tag capitalize">{info.type}</span>}
              </div>
            </div>

            <div className="meta-actions" style={{ marginBottom: '16px' }}>
              <FocusableButton 
                className="icon-btn glass-overlay" 
                onClick={toggleWatchList}
                title={isInWatchList ? "Remove from Watchlist" : "Add to Watchlist"}
                style={{ 
                  width: '48px', 
                  height: '48px', 
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isInWatchList ? 'var(--primary)' : 'inherit',
                  border: isInWatchList ? '1px solid var(--primary)' : '1px solid var(--surface-variant)'
                }}
              >
                {isInWatchList ? <BookmarkCheck size={24} /> : <BookmarkPlus size={24} />}
              </FocusableButton>
            </div>
          </div>
        </div>
      </div>

      <div className="meta-content-wrapper">
        <div className="meta-content-inner">
          <div className="meta-details">

            {description && (
              <div className="meta-synopsis">
                <h3 className="title-md text-primary" style={{ marginBottom: '4px' }}>Synopsis</h3>
                <p className="body-md text-muted">{description}</p>
              </div>
            )}

            {meta?.cast && meta.cast.length > 0 && (
              <div className="meta-cast">
                <h3 className="title-md text-primary" style={{ marginBottom: '4px' }}>Cast</h3>
                <p className="body-md text-muted">{meta.cast.join(', ')}</p>
              </div>
            )}

            {meta?.genre && meta.genre.length > 0 && (
              <div className="meta-genre">
                <h3 className="title-md text-primary" style={{ marginBottom: '4px' }}>Genres</h3>
                <p className="body-md text-muted">{meta.genre.join(', ')}</p>
              </div>
            )}
          </div>

          {/* Content Links: Seasons, Episodes, or Direct Links */}
          {filteredLinkList && filteredLinkList.length > 0 && (
            <div className="meta-episodes-section">
              <div className="episodes-header-row">
                {filteredLinkList.length > 1 ? (
                  <CustomSelect
                    options={filteredLinkList.map((season: Link) => ({
                      value: season.title,
                      label: season.title
                    }))}
                    value={activeSeason?.title || ''}
                    onChange={(val) => {
                      const season = filteredLinkList.find((l: Link) => l.title === val);
                      if (season) {
                        setActiveSeason(season);
                        localStorage.setItem(`vega_season_${link}`, season.title);
                      }
                    }}
                    className="season-selector-custom"
                  />
                ) : (
                  <h3 className="title-md text-primary" style={{ marginBottom: '16px' }}>
                    {activeSeason?.title || 'Episodes'}
                  </h3>
                )}
              </div>

              {/* Loader for episodes */}
              {episodeLoading && (
                <div className="episodes-list">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="skeleton-episode" />
                  ))}
                </div>
              )}

              {/* Error for episodes */}
              {episodeError && !episodeLoading && (
                <p className="text-red-500">Failed to load episodes. Please try again.</p>
              )}

              {/* Render Episodes */}
              {activeSeason?.episodesLink && !episodeLoading && episodeList && episodeList.length > 0 && (
                <div className="episodes-list">
                  {episodeList.map((ep, idx) => (
                    <FocusableEpisodeCard
                      key={ep.link || idx}
                      onClick={() => handlePlayClick(episodeList, idx, 'series')}
                    >
                      <div className="episode-number">{idx + 1}</div>
                      <div className="episode-info">
                        <h4 className="label-lg" title={ep.title}>{ep.title}</h4>
                      </div>
                      <div className="episode-actions">
                        <DownloadActionButton
                          id={`${meta?.name || meta?.title || info?.title || 'Unknown Title'}_S${activeSeason?.title}_E${idx + 1}`}
                          ep={ep}
                          idx={idx}
                          type="series"
                          seasonTitle={activeSeason?.title}
                          downloads={downloads}
                          downloadingId={downloadingId}
                          onDownloadClick={handleDownloadClick}
                          onDeleteClick={cancelDownload}
                        />
                      </div>
                    </FocusableEpisodeCard>
                  ))}
                </div>
              )}

              {/* Render Direct Links (for movies or direct server links) */}
              {activeSeason?.directLinks && activeSeason.directLinks.length > 0 && (
                <div className="episodes-list">
                  {activeSeason.directLinks.map((link, idx) => (
                    <FocusableEpisodeCard
                      key={link.link || idx}
                      onClick={() => handlePlayClick(activeSeason.directLinks!, idx, link.type || 'movie')}
                    >
                      <div className="episode-number">
                        <Video size={24} />
                      </div>
                      <div className="episode-info">
                        <h4 className="label-lg" title={link.title}>{link.title}</h4>
                      </div>
                      <div className="episode-actions">
                        <DownloadActionButton
                          id={`${meta?.name || meta?.title || info?.title || 'Unknown Title'}_direct_${idx}`}
                          ep={link}
                          idx={idx}
                          type={link.type || 'movie'}
                          seasonTitle={activeSeason?.title}
                          downloads={downloads}
                          downloadingId={downloadingId}
                          onDownloadClick={handleDownloadClick}
                          onDeleteClick={cancelDownload}
                        />
                      </div>
                    </FocusableEpisodeCard>
                  ))}
                </div>
              )}

              {/* No content state */}
              {!episodeLoading && activeSeason?.episodesLink && (!episodeList || episodeList.length === 0) && (
                <p className="text-muted">No episodes found for this season.</p>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Download Dialog */}
      <DownloadServerDialog
        isOpen={dialogStreams.length > 0}
        onClose={() => setDialogStreams([])}
        streams={dialogStreams}
        episodeTitle={dialogEpisodeTitle}
        onSelect={handleStreamSelected}
      />
    </div>
    </FocusContext.Provider>
  );
};
