# Vega Desktop — Progress Tracker

## Status Legend
- `[ ]` Not started
- `[/]` In progress
- `[x]` Completed
- `[!]` Blocked

---

## Phase 1 — Foundation & Provider System
- [x] Install dependencies (axios, cheerio, zustand, react-query, react-router-dom, lucide-react)
- [x] Create design system CSS (variables.css, index.css with tokens from cinematic_noir)
- [x] Create platform adapter: `platform/storage.ts` (localStorage → IStorageService)
- [x] Create platform adapter: `platform/crypto.ts` (Web Crypto API)
- [x] Port `lib/providers/types.ts` (remove expo-crypto import, use web crypto type)
- [x] Port `lib/providers/headers.ts` (copy as-is)
- [x] Port `lib/providers/getBaseUrl.ts` (use localStorage cache)
- [x] Port `lib/providers/providerContext.ts` (web crypto, web WAF)
- [x] Port `lib/storage/StorageService.ts` (rewrite with localStorage)
- [x] Port `lib/storage/extensionStorage.ts`
- [x] Port `lib/storage/SettingsStorage.ts`
- [x] Port `lib/storage/WatchHistoryStorage.ts`
- [x] Port `lib/storage/WatchListStorage.ts`
- [x] Port `lib/storage/CacheStorage.ts`
- [x] Port `lib/storage/ProvidersStorage.ts`
- [x] Port `lib/storage/index.ts`
- [x] Port `lib/zustand/contentStore.ts` (localStorage persistence)
- [x] Port `lib/zustand/themeStore.ts` (localStorage persistence)
- [x] Port `lib/zustand/watchListStore.ts`
- [x] Port `lib/zustand/watchHistrory.ts`
- [x] Port `lib/zustand/wafStore.ts`
- [x] Port `lib/services/ExtensionManager.ts`
- [x] Port `lib/services/ProviderManager.ts` (replace ToastAndroid)
- [x] Port `lib/client.ts` (remove __DEV__)
- [x] Port `lib/getHomepagedata.ts`
- [x] Port `lib/constants.ts` (remove RNFS)
- [x] Port `lib/hooks/useHomePageData.ts`
- [x] Port `lib/hooks/useContentInfo.ts`
- [x] Port `lib/hooks/useEpisodes.ts`
- [x] Port `lib/hooks/useStream.ts` (remove ToastAndroid)
- [x] Port `lib/utils/helpers.ts`
- [x] Create app shell (Sidebar + Topbar + React Router layout)
- [x] Build Extensions page (add source, browse manifest, install/uninstall)
- [x] **MILESTONE: Can install a provider and verify modules are cached**

## Phase 2 — Content Discovery
- [x] Build provider switcher component (dropdown in sidebar)
- [x] Build Home page (carousels for Trending, Popular, etc.)
- [x] Implement `useHomePageData` properly in components
- [x] Build Info/Meta page (cover image, title, plot, cast)
- [x] **MILESTONE: Can view home page and click a post to see its details**
- [x] Build Info/metadata page (backdrop, synopsis, tags, cast, rating)
- [x] Build SeasonList component (collapsible seasons, episode cards)
- [x] **MILESTONE: Can browse provider catalog, click post → see info → see episodes**

## Phase 2.5 — Meta Page Parity
- [x] Parse provider `linkList` instead of assuming `info.episodes`
- [x] Season selector dropdown for multi-season content
- [x] Implement `useEpisodes` hook to fetch dynamically
- [x] Render episodes grid (`activeSeason.episodesLink`)
- [x] Render direct links grid (`activeSeason.directLinks`)
- [x] **MILESTONE: Full feature parity with mobile Meta Page**

## Phase 3 — Playback
- [x] Install and configure `tauri-plugin-libmpv`
- [x] Build `useMpvPlayer` hook (init, observe properties, play/pause/seek/volume/speed)
- [x] Build stream resolver (useStream hook integration in PlayerPage)
- [x] Build PlayerSettings component (server/speed/audio/subtitle tabs)
- [x] Build PlayerControls component (Netflix-style overlay with timeline, volume, skip)
- [x] Build PlayerPage (libmpv + controls + settings + keyboard shortcuts)
- [x] Wire up MetaPage → PlayerPage navigation with episode list / link index
- [x] Wire up watch history tracking (save progress periodically)
- [x] Auto next-episode on EOF and "Next" button at 80% progress
- [x] Keyboard shortcuts (Space/K=pause, Arrow=seek, F=fullscreen, M=mute, N=next, Esc=back)
- `[x]` Add ContinueWatching row on home page
- `[x]` **MILESTONE: Can play a stream from a provider, resume where left off**

## Phase 4 — Search & Lists
- `[x]` Build Search page (search bar, provider multi-search)
- `[x]` Build SearchResults page (results grid)
- `[x]` Build Watchlist page (saved items grid, remove, filter tabs)
- `[x]` **MILESTONE: Full search and watchlist working**

## Phase 5 — Settings & Polish
- `[x]` Build Settings page (grouped cards layout)
- `[x]` Build Preferences section (theme picker, quality filter, player settings)
- `[x]` Build SubtitleSettings section
- `[ ]` Build WAF solver (Tauri webview window for CF challenges)
- `[x]` Build Downloads page (Tauri FS download manager)
- `[x]` Build About page (version, links, update checker)
- `[x]` Wire up theme system (dynamic CSS variables from zustand)
- `[x]` Polish animations, transitions, hover effects
- `[x]` Responsive layout adjustments
- `[ ]` **MILESTONE: Feature-complete desktop app**

---

## Issues & Blockers
_None yet._

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-22 | Initial plan created |
