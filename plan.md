# Vega Desktop — Conversion Plan

## Overview

Convert **vega-mobile** (React Native / Expo) into **vega-desktop** (Tauri v2 + React + Vite).
The desktop app must support all features of the mobile app, use the same external provider system, and be designed so it can later be converted to an Android app with minimal effort.

The existing `vega-desktop` scaffold is a bare Tauri v2 + React + Vite project. We will build the desktop UI inside it.

---

## Architecture Decisions

### Tech Stack
| Layer | Mobile (current) | Desktop (target) |
|---|---|---|
| Framework | React Native + Expo | React + Vite + Tauri v2 |
| Styling | NativeWind (TailwindCSS) | Vanilla CSS (design tokens from `cinematic_noir/DESIGN.md`) |
| Navigation | React Navigation (stack + tabs) | React Router DOM (sidebar + routes) |
| State | Zustand + MMKV persistence | Zustand + `localStorage` persistence |
| HTTP | Axios | Axios (same) |
| Storage | MMKV (react-native-mmkv-storage) | `localStorage` wrapper implementing `IStorageService` |
| Player | react-native-video | `tauri-plugin-libmpv` |
| WebView (WAF) | react-native-webview | Tauri `tauri-plugin-shell` open-url OR custom Tauri webview window |
| Crypto | expo-crypto | Web Crypto API (`crypto.subtle` / `crypto.getRandomValues`) |
| HTML parsing | cheerio | cheerio (same — works in browser) |
| Data fetching | @tanstack/react-query | @tanstack/react-query (same) |
| File system | @dr.pogodin/react-native-fs | Tauri `@tauri-apps/plugin-fs` |
| Downloads | Custom RN downloader | Tauri `@tauri-apps/plugin-http` + `@tauri-apps/plugin-fs` |
| Notifications | @notifee/react-native | Tauri `@tauri-apps/plugin-notification` |

### Key Principle: Provider Compatibility
Providers are JS modules loaded dynamically via `new Function()` that receive a `providerContext` object with: `axios`, `cheerio`, `Crypto`, `getBaseUrl`, `commonHeaders`, `openWebView`.
The desktop must supply an identical `providerContext` so the exact same provider modules work unchanged.

### Key Principle: Android Later
- Use React (DOM) not React Native Web — React DOM is the simplest path for Tauri.
- Keep all business logic (hooks, stores, services, providers) in a `lib/` folder that has **zero** platform-specific imports.
- Tauri-specific code (fs, player, notifications) goes in a `platform/` adapter folder so it can be swapped for Android-Capacitor or React Native later.

---

## Feature List (mapped from mobile)

| # | Feature | Mobile Source | Priority |
|---|---------|--------------|----------|
| 1 | Provider extension system (install/uninstall/update from manifest URL) | `ExtensionManager.ts`, `extensionStorage.ts` | **P0** |
| 2 | Extensions UI (add source, browse/install/uninstall providers) | `Extensions.tsx` | **P0** |
| 3 | Home page (catalog posts by category) | `Home.tsx`, `useHomePageData.ts`, `getHomepagedata.ts` | **P1** |
| 4 | Post grid / list views | `ScrollList.tsx`, `Slider.tsx` | **P1** |
| 5 | Content info / metadata page | `Info.tsx`, `useContentInfo.ts` | **P1** |
| 6 | Season / episode list | `SeasonList.tsx`, `useEpisodes.ts` | **P1** |
| 7 | Stream resolution & server selection | `StreamModal.tsx`, `useStream.ts` | **P2** |
| 8 | Video player (libmpv) | `Player.tsx`, `usePlayerSettings.ts` | **P2** |
| 9 | Search (across providers) | `Search.tsx`, `SearchResults.tsx` | **P1** |
| 10 | Watchlist (add/remove bookmarks) | `WatchList.tsx`, `watchListStore.ts`, `WatchListStorage.ts` | **P1** |
| 11 | Watch history (progress tracking) | `WatchHistory.tsx`, `watchHistrory.ts`, `WatchHistoryStorage.ts` | **P1** |
| 12 | Continue watching (home hero) | `ContinueWatching.tsx`, `Hero.tsx` | **P1** |
| 13 | Settings page | `Settings.tsx` | **P2** |
| 14 | Preferences (theme, quality, player) | `Preference.tsx` | **P2** |
| 15 | Subtitle settings | `SubtitleSettings.tsx` | **P3** |
| 16 | Downloads | `Downloads.tsx`, `Downloader.tsx`, `downloader.ts` | **P3** |
| 17 | WAF / Cloudflare challenge solver | `WafWebViewDialog.tsx`, `wafResolver.ts`, `wafStore.ts` | **P2** |
| 18 | Provider drawer (switch active provider) | `ProviderDrawer.tsx` | **P0** |
| 19 | App update checker | `About.tsx` | **P3** |
| 20 | Theme customization | `themeStore.ts`, `constants.ts` themes | **P2** |

---

## Build Order (test-first, UI-first)

The order is designed so you can **test end-to-end as early as possible** — providers first, then posts, then info, then player, then polish.

### Phase 1 — Foundation & Provider System (testable immediately)
1. **Project setup** — install dependencies (`axios`, `cheerio`, `zustand`, `@tanstack/react-query`, `react-router-dom`, `lucide-react`)
2. **Platform adapters** — `platform/storage.ts` (localStorage wrapper implementing `IStorageService`), `platform/crypto.ts` (Web Crypto adapter)
3. **Port `lib/` layer** (no UI) — port these files with RN-specific imports replaced:
   - `lib/providers/types.ts` (copy as-is, remove `expo-crypto` import)
   - `lib/providers/headers.ts` (copy as-is)
   - `lib/providers/getBaseUrl.ts` (use localStorage-based cache)
   - `lib/providers/providerContext.ts` (use web crypto, web-based WAF)
   - `lib/storage/StorageService.ts` → rewrite to use `localStorage`
   - `lib/storage/extensionStorage.ts` (port, swap StorageService)
   - `lib/storage/SettingsStorage.ts` (port, remove download-location RN stuff for now)
   - `lib/storage/WatchHistoryStorage.ts` (port)
   - `lib/storage/WatchListStorage.ts` (port)
   - `lib/storage/CacheStorage.ts` (port)
   - `lib/storage/ProvidersStorage.ts` (port)
   - `lib/storage/index.ts` (port)
   - `lib/zustand/contentStore.ts` (replace MMKV with localStorage persistence)
   - `lib/zustand/themeStore.ts` (replace MMKV)
   - `lib/zustand/watchListStore.ts` (port)
   - `lib/zustand/watchHistrory.ts` (port)
   - `lib/zustand/wafStore.ts` (port as-is)
   - `lib/services/ExtensionManager.ts` (port as-is)
   - `lib/services/ProviderManager.ts` (replace `ToastAndroid` with console/toast)
   - `lib/client.ts` (remove `__DEV__` reference)
   - `lib/getHomepagedata.ts` (port as-is)
   - `lib/constants.ts` (remove RNFS dependency)
   - `lib/hooks/useHomePageData.ts` (port)
   - `lib/hooks/useContentInfo.ts` (port)
   - `lib/hooks/useEpisodes.ts` (port)
   - `lib/hooks/useStream.ts` (remove `ToastAndroid`, `ifExists`)
   - `lib/utils/helpers.ts` (port)
4. **Design system CSS** — create `styles/` with design tokens from `cinematic_noir/DESIGN.md`
5. **App shell** — sidebar nav (Home, Search, Watchlist, Settings), React Router layout
6. **Extensions page** — add source URL, fetch manifest, install/uninstall providers (this proves the whole provider pipeline works)

### Phase 2 — Content Discovery (post grid, info)
7. **Provider switcher** — dropdown or sidebar section to select active provider
8. **Home page** — hero banner + category rows of poster cards (from `getHomePageData`)
9. **Post card component** — poster image + title, click → info page
10. **Scroll list page** — paginated grid for a single category ("more" link)
11. **Info / metadata page** — backdrop, synopsis, tags, cast, rating, season list
12. **Season & episode list** — collapsible season sections, episode cards with play button

### Phase 3 — Playback
13. **Stream resolver** — wire up `useStream`, stream selection modal
14. **Player page (libmpv)** — integrate `tauri-plugin-libmpv`, controls overlay
15. **Watch history tracking** — save progress on pause/close, resume position
16. **Continue watching row** on home page

### Phase 4 — Search & Lists
17. **Search page** — search bar, multi-provider results
18. **Search results page** — results grid, click → info
19. **Watchlist page** — saved items grid, remove functionality

### Phase 5 — Settings & Polish
20. **Settings page** — grouped settings cards
21. **Preferences** — theme picker, quality filter, player settings
22. **Subtitle settings** — font size, opacity, padding
23. **WAF solver** — Tauri webview window for Cloudflare challenges
24. **Downloads** — Tauri FS-based download manager (desktop-specific)
25. **About page** — version, links, update checker
26. **Theme system** — dynamic CSS variables from zustand

---

## Folder Structure (target)

```
vega-desktop/
├── src/
│   ├── main.tsx                   # Entry point
│   ├── App.tsx                    # Router + layout shell
│   ├── styles/
│   │   ├── index.css              # Global styles + design tokens
│   │   ├── variables.css          # CSS custom properties
│   │   └── components/            # Per-component CSS modules
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Topbar.tsx
│   │   │   └── AppShell.tsx
│   │   ├── common/
│   │   │   ├── PostCard.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Toast.tsx
│   │   ├── home/
│   │   │   ├── Hero.tsx
│   │   │   ├── CategoryRow.tsx
│   │   │   └── ContinueWatching.tsx
│   │   ├── info/
│   │   │   ├── InfoHeader.tsx
│   │   │   ├── SeasonList.tsx
│   │   │   └── StreamModal.tsx
│   │   ├── player/
│   │   │   └── Player.tsx
│   │   ├── search/
│   │   │   ├── SearchBar.tsx
│   │   │   └── SearchResults.tsx
│   │   ├── settings/
│   │   │   ├── ExtensionsManager.tsx
│   │   │   ├── ProviderSwitcher.tsx
│   │   │   └── SettingsGroup.tsx
│   │   └── watchlist/
│   │       └── WatchlistGrid.tsx
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── InfoPage.tsx
│   │   ├── PlayerPage.tsx
│   │   ├── SearchPage.tsx
│   │   ├── WatchlistPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── ExtensionsPage.tsx
│   │   └── ScrollListPage.tsx
│   ├── lib/                       # Business logic (portable)
│   │   ├── providers/             # Ported from mobile
│   │   ├── storage/               # Ported with localStorage backend
│   │   ├── zustand/               # Ported with localStorage persistence
│   │   ├── services/              # ExtensionManager, ProviderManager
│   │   ├── hooks/                 # useHomePageData, useStream, etc.
│   │   ├── utils/
│   │   ├── client.ts
│   │   ├── constants.ts
│   │   └── getHomepagedata.ts
│   └── platform/                  # Platform-specific adapters
│       ├── storage.ts             # localStorage IStorageService impl
│       ├── crypto.ts              # Web Crypto adapter
│       ├── fs.ts                  # Tauri FS adapter
│       ├── player.ts              # libmpv integration
│       └── waf.ts                 # WAF solver (Tauri window)
├── src-tauri/                     # Tauri backend (Rust)
│   ├── src/
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## React Native → Web Migration Reference

| RN Concept | Web Equivalent |
|---|---|
| `View` | `div` |
| `Text` | `span` / `p` |
| `Image` | `img` |
| `ScrollView` | `div` with `overflow-y: auto` |
| `FlatList` | `div` with virtual scroll (or simple map) |
| `TouchableOpacity` | `button` / `div` with `:active` opacity |
| `SafeAreaView` | Not needed |
| `StatusBar` | Not needed |
| `Dimensions` | CSS media queries / `window.innerWidth` |
| `StyleSheet.create` | CSS modules / vanilla CSS |
| `Animated` | CSS transitions / framer-motion |
| `react-native-reanimated` | CSS transitions / framer-motion |
| `react-native-gesture-handler` | Native DOM events |
| `NavigationContainer` + stacks | `BrowserRouter` + `Routes` |
| `ToastAndroid` | Custom toast component or `sonner` |
| `MMKVLoader` | `localStorage` |
| `react-native-webview` | `iframe` or Tauri webview window |
| `@expo/vector-icons` | `lucide-react` icons |
| `react-native-linear-gradient` | CSS `linear-gradient` |
| `@react-native-community/blur` | CSS `backdrop-filter: blur()` |
| `BottomSheet` | Modal / side panel |

---

## Tauri Configuration Changes Needed

### `tauri.conf.json`
- Window size: `1280x800` (min `900x600`)
- Title: `Vega`
- Decorations: true (native title bar)
- Security: allow external URLs for provider fetching

### `Cargo.toml` additions
- `tauri-plugin-libmpv` (player)
- `tauri-plugin-fs` (file system access)
- `tauri-plugin-http` (HTTP client for downloads)
- `tauri-plugin-notification` (notifications)
- `tauri-plugin-shell` (open URLs)

### Capabilities
- `fs:default` (read/write app data)
- `http:default` (allow fetch)
- `notification:default`
- `shell:default` (open URLs)

---

## Design Reference

Designs in `desgin/` folder are reference only — not strict mockups. Key patterns:
- **Dark theme** with black background (#131313)
- **Left sidebar** with nav items (Home, Search, Watchlist, Settings)
- **Top bar** with catalog tabs (Movies, TV Shows, Originals) + search
- **Hero banner** with backdrop image, title, synopsis, tags, Play + My List buttons
- **Horizontal poster rows** with "more" link
- **Content detail page** with large backdrop, metadata, episodes grid
- **Settings** with provider cards, grouped option sections
- **Watchlist** with filter tabs + poster grid
- **Primary accent color**: `#ffb2be` (pink/red from cinematic noir)
- **Font**: Plus Jakarta Sans (or Inter as fallback)
