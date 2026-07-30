import React, { useEffect, useState } from "react";
import {
  LuGitBranch as GitCommit,
  LuUser as User,
  LuCheck as CheckCircle,
  LuExternalLink as ExternalLink,
  LuTag as TagIcon,
  LuCalendar as CalendarIcon,
  LuPackage as PackageIcon,
  LuRefreshCw as RefreshCw,
  LuLayers as LayersIcon,
} from "react-icons/lu";
import { openUrl } from "@tauri-apps/plugin-opener";
import logo from "../assets/logo.png";
import "./ChangelogPage.css";

interface ReleaseEntry {
  tag: string;
  name: string;
  date?: string;
  author?: string;
  isLatest?: boolean;
  isPreRelease?: boolean;
  highlights: string[];
  bodyText?: string;
  assetsCount?: number;
}

const STATIC_RELEASE_HISTORY: ReleaseEntry[] = [
  {
    tag: "v1.4.3b",
    name: "VegaBR31 v1.4.3b — Update by Angel Mehul Singh",
    date: "Latest Release (Current Build)",
    author: "Angel Mehul Singh",
    isLatest: true,
    highlights: [
      "Persistent MPV Volume Bar: Remembers user volume levels across app launches & restarts.",
      "Picture-in-Picture App Navigation: Added 'Navigate to App' button in PiP overlay controls to browse the app while playing video.",
      "VegaBR31 Rebranding: Updated app name to VegaBR31 across tauri.conf.json, NSIS installers (VegaBR31_x64-setup.exe), desktop shortcuts, and UI components.",
      "Design System & Theme Overhaul: Added Deep Blue theme, glow backdrops, primary color channels, and glowing active navigation tabs.",
      "Settings & Subtitle Enhancements: Reordered preference groups with Lucide icons, card shadows, and real-time cinematic subtitle preview box.",
      "Download Badges & Extensions Tabs: Added status badges (Downloading, Error, Queued, Paused) and tabbed Discover/Installed views.",
    ],
  },
  {
    tag: "v1.4.1",
    name: "Vega v1.4.1",
    date: "2 weeks ago",
    author: "github-actions",
    highlights: [
      "Added Chrome TLS fingerprinting for stream request compatibility.",
      "Fixed Linux scroll issue across list and grid views.",
    ],
    assetsCount: 13,
  },
  {
    tag: "v1.4.0",
    name: "Vega v1.4.0",
    date: "2 weeks ago",
    author: "github-actions",
    highlights: [
      "Watchlist, Continue Watching and Downloads sync support with the mobile app.",
    ],
    assetsCount: 13,
  },
  {
    tag: "v1.3.1",
    name: "Vega v1.3.1",
    date: "3 weeks ago",
    author: "github-actions",
    isPreRelease: true,
    highlights: ["TV OS crash fix and stability improvements."],
    assetsCount: 19,
  },
  {
    tag: "v1.3.0",
    name: "Vega v1.3.0",
    date: "Last month",
    author: "github-actions",
    highlights: [
      "Torrent playback and download engine integration.",
      "UI improvements and minor bug fixes.",
    ],
    assetsCount: 17,
  },
  {
    tag: "v1.2.3",
    name: "Vega v1.2.3",
    date: "Jun 30",
    author: "github-actions",
    highlights: [
      "Added HLS stream downloader.",
      "Added DNS over HTTPS (DoH) privacy options.",
      "UI fixes and performance updates.",
    ],
    assetsCount: 17,
  },
  {
    tag: "v1.2.2",
    name: "Vega v1.2.2",
    date: "Jun 26",
    author: "github-actions",
    highlights: [
      "Playback and window fixes for Linux and macOS.",
      "Updated WAF solver engine.",
      "Added toggle option to disable hardware acceleration.",
    ],
    assetsCount: 17,
  },
  {
    tag: "v1.2.1",
    name: "Vega v1.2.1",
    date: "Jun 25",
    author: "github-actions",
    highlights: [
      "TV app mode and Smart TV gamepad navigation.",
      "Spatial navigation core integration.",
      "Fixed auto install update background routine.",
    ],
    assetsCount: 17,
  },
  {
    tag: "v1.0.0",
    name: "Vega v1.0.0",
    date: "Jun 23",
    author: "github-actions",
    highlights: ["Initial public release of Vega for Desktop."],
    assetsCount: 9,
  },
];

export const ChangelogPage: React.FC = () => {
  const [releases, setReleases] = useState<ReleaseEntry[]>(STATIC_RELEASE_HISTORY);
  const [loading, setLoading] = useState(false);

  const fetchRemoteReleases = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        "https://api.github.com/repos/vega-org/vega-desktop/releases",
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const remoteMapped: ReleaseEntry[] = data.map((rel: any, idx: number) => {
            const bodyLines = rel.body
              ? rel.body
                  .split("\n")
                  .map((l: string) => l.trim())
                  .filter((l: string) => l.length > 0 && !l.startsWith("#"))
              : [];

            const isCurrentAngelBuild = rel.tag_name?.includes("1.4.3") || idx === 0;

            return {
              tag: rel.tag_name || `v${rel.name}`,
              name: isCurrentAngelBuild
                ? "VegaBR31 v1.4.3b — Update by Angel Mehul Singh"
                : rel.name || rel.tag_name,
              date: rel.published_at
                ? new Date(rel.published_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "Recent",
              author: rel.author?.login || "github-actions",
              isLatest: idx === 0,
              isPreRelease: rel.prerelease,
              highlights:
                isCurrentAngelBuild
                  ? STATIC_RELEASE_HISTORY[0].highlights
                  : bodyLines.length > 0
                    ? bodyLines.slice(0, 5)
                    : ["Release updates and general bug fixes."],
              assetsCount: rel.assets?.length || 0,
            };
          });

          // Ensure v1.4.3b Angel release is at top
          if (!remoteMapped.some((r) => r.tag === "v1.4.3b")) {
            setReleases([STATIC_RELEASE_HISTORY[0], ...remoteMapped]);
          } else {
            setReleases(remoteMapped);
          }
        }
      }
    } catch (err) {
      console.warn("Using offline release history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRemoteReleases();
  }, []);

  const gitStats = [
    { label: "App Name", value: "VegaBR31 Desktop" },
    { label: "Current Version", value: "v1.4.3b (1.4.3-beta)" },
    { label: "Author & Lead Dev", value: "Angel Mehul Singh" },
    { label: "UI & Tech Stack", value: "br31tech.in" },
    { label: "Git Branch", value: "v1.4.3b" },
    { label: "Build Target", value: "Windows x64 (NSIS Installer)" },
    { label: "Core Runtime", value: "Tauri v2 + Rust + libmpv + React 19" },
  ];

  return (
    <div className="changelog-full-container">
      {/* Edge-to-Edge Hero Banner */}
      <div className="changelog-hero">
        <div className="changelog-hero-content">
          <div className="changelog-brand-badge">
            <img src={logo} alt="VegaBR31 Logo" className="changelog-brand-logo" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="changelog-hero-title">VegaBR31 Release History</h1>
              <span className="changelog-hero-pill">v1.4.3b</span>
            </div>
            <p className="changelog-hero-sub">
              Full version changelog, tag releases, and UI enhancements by Angel Mehul Singh
            </p>
          </div>
        </div>

        <button
          className="changelog-refresh-btn"
          onClick={fetchRemoteReleases}
          disabled={loading}
          title="Refresh Release Tags"
        >
          <RefreshCw size={16} className={loading ? "spin-icon" : ""} />
          <span>{loading ? "Fetching..." : "Refresh Tags"}</span>
        </button>
      </div>

      <div className="changelog-content-wrapper">
        {/* Developer Attribution Banner */}
        <div className="developer-spotlight-card">
          <div className="spotlight-left">
            <div className="spotlight-avatar">
              <User size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="spotlight-name">Angel Mehul Singh</h2>
                <span className="spotlight-badge">Lead Developer</span>
              </div>
              <p className="spotlight-sub">
                Designed & Engineered UI enhancements, MPV volume persistence, PiP navigation, and VegaBR31 desktop installer.
              </p>
            </div>
          </div>
          <button
            className="spotlight-link-btn"
            onClick={() => openUrl("https://br31tech.in")}
          >
            <span>Visit br31tech.in</span>
            <ExternalLink size={14} />
          </button>
        </div>

        {/* Repository & Environment Stats */}
        <div className="section-header">
          <GitCommit size={20} className="section-icon" />
          <h2>Repository & System Specifications</h2>
        </div>

        <div className="specs-grid">
          {gitStats.map((stat, idx) => (
            <div key={idx} className="spec-card">
              <span className="spec-label">{stat.label}</span>
              <span className="spec-value">{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Release Timeline List */}
        <div className="section-header mt-lg">
          <LayersIcon size={20} className="section-icon" />
          <h2>Version History & Release Tags</h2>
        </div>

        <div className="release-timeline">
          {releases.map((rel, idx) => (
            <div
              key={idx}
              className={`release-card ${rel.isLatest ? "latest-release" : ""}`}
            >
              <div className="release-card-header">
                <div className="release-tag-group">
                  <span className="release-tag-badge">
                    <TagIcon size={14} />
                    {rel.tag}
                  </span>
                  {rel.isLatest && <span className="badge-latest">Latest</span>}
                  {rel.isPreRelease && <span className="badge-prerelease">Pre-release</span>}
                </div>

                <div className="release-meta-info">
                  {rel.author && (
                    <span className="release-author">
                      <User size={13} /> {rel.author}
                    </span>
                  )}
                  {rel.date && (
                    <span className="release-date">
                      <CalendarIcon size={13} /> {rel.date}
                    </span>
                  )}
                  {rel.assetsCount ? (
                    <span className="release-assets">
                      <PackageIcon size={13} /> {rel.assetsCount} Assets
                    </span>
                  ) : null}
                </div>
              </div>

              <h3 className="release-title">{rel.name}</h3>

              <div className="release-highlights">
                {rel.highlights.map((point, pIdx) => (
                  <div key={pIdx} className="highlight-point">
                    <CheckCircle size={15} className="highlight-icon" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
