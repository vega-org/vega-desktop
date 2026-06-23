# Vega Desktop — Memory & Instructions

> This document captures everything an agent needs to continue work on this project without any prior context.

Always Upate progress and memory files when needed

---

## Project Overview

- **Porting Guideline:** Always look at the `vega-mobile` codebase for existing interfaces, constants, and utilities before creating new ones.
- **Mobile First rule:** Always read the mobile code first to understand how it works before developing a feature. Do not make assumptions about how the mobile app behaves.

**Goal**: Convert `vega-mobile` (React Native / Expo) into `vega-desktop` (Tauri v2 + React + Vite).

**Monorepo layout**:
```
c:\Users\sangw\Desktop\vega-new\
├── vega-mobile/     # Source of truth — React Native app (DO NOT MODIFY)
├── vega-desktop/    # Target — Tauri v2 + React + Vite app (WORK HERE)
├── desgin/          # Design references (not strict, just inspiration)
└── assets/          # Shared assets
```

**Planning docs**:
- `vega-desktop/plan.md` — full conversion plan, architecture, build order
- `vega-desktop/progress.md` — checkbox tracker for all tasks
- `vega-desktop/memory.md` — this file

---

## Critical Architecture Decisions

### 1. Provider System Must Be 100% Compatible
The app works with external "provider" extensions — JS modules hosted on GitHub that are fetched, cached, and executed at runtime via `new Function()`. These providers receive a `providerContext` object:

```typescript
type ProviderContext = {
  axios: AxiosStatic;
  Crypto: typeof Crypto;
  getBaseUrl: (providerValue: string) => Promise<string>;
  commonHeaders: Record<string, string>;
  cheerio: typeof cheerio;
  openWebView: (url: string, options?: OpenWebViewOptions) => Promise<OpenWebViewResult>;
};
```

**The desktop app MUST provide this exact same interface** so the same provider modules work without changes.

- `axios` — use the same `axios` npm package
- `cheerio` — use the same `cheerio` npm package (works in browser)
- `Crypto` — mobile uses `expo-crypto`; desktop must wrap Web Crypto API to match the `expo-crypto` API surface (specifically `digestStringAsync` and `randomUUID`)
- `getBaseUrl` — fetches from `https://himanshu8443.github.io/providers/modflix.json`, caches for 1 hour
- `commonHeaders` — static object with User-Agent etc.
- `openWebView` — mobile opens a React Native WebView to solve Cloudflare challenges. Desktop must open a Tauri webview window or use `<iframe>` equivalent

### 2. Storage Abstraction
Mobile uses `react-native-mmkv-storage` via a `StorageService` class that implements `IStorageService`:
```typescript
interface IStorageService {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
  getBool(key: string, defaultValue?: boolean): boolean;
  setBool(key: string, value: boolean): void;
  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;
  getObject<T>(key: string): T | undefined;
  setObject<T>(key: string, value: T): void;
  getArray<T>(key: string): T[] | undefined;
  setArray<T>(key: string, value: T[]): void;
  delete(key: string): void;
  contains(key: string): boolean;
  clearAll(): void;
}
```

Desktop must implement this same interface using `localStorage`. All storage classes (`SettingsStorage`, `ExtensionStorage`, `WatchHistoryStorage`, etc.) depend on this interface, so once the adapter is correct, everything else ports cleanly.

### 3. Zustand Persistence
Mobile uses MMKV for zustand `persist` middleware. Desktop must use zustand's built-in `createJSONStorage(() => localStorage)`.

### 4. No React Native Dependencies
The desktop app is pure React DOM. No React Native imports anywhere. When porting:
- Replace `View` → `div`
- Replace `Text` → `span`/`p`
- Replace `Image` → `img`
- Replace `FlatList`/`FlashList` → `div` with `.map()`
- Replace `TouchableOpacity` → `button`
- Replace `react-native-reanimated`/`Animated` → CSS transitions or `framer-motion`
- Replace `@expo/vector-icons` → `lucide-react`
- Replace `ToastAndroid.show()` → custom toast or `console.log` (for now)
- Replace `react-native-linear-gradient` → CSS `linear-gradient`
- Replace `@react-native-community/blur` → CSS `backdrop-filter: blur()`
- Replace React Navigation → React Router DOM

### 5. Player: tauri-plugin-libmpv
- GitHub: https://github.com/nini22P/tauri-plugin-libmpv
- Install: `npm run tauri add libmpv`
- Setup: `npx tauri-plugin-libmpv-api setup-lib` (auto-downloads libmpv DLLs on Windows)
- Requires `libmpv-wrapper.dll` and `libmpv-2.dll` in `src-tauri/lib/`
- Provides a Tauri command API to control mpv from the frontend
- **Architecture**: mpv renders on the native window canvas, React UI overlays on top. The `player-page` class uses `position: fixed; inset: 0; background: #000` so the page fills the entire window.
- **Key files**:
  - `src/lib/hooks/useMpvPlayer.ts` — Hook wrapping `init`, `destroy`, `command`, `setProperty`, `observeProperties`. Exposes `loadFile`, `togglePause`, `seek`, `setVolumeLevel`, `setPlaybackSpeed`, `addSubtitleTrack`, `setSubtitleTrack`, `setAudioTrack`.
  - `src/pages/PlayerPage.tsx` — Orchestrator: stream fetching, mpv lifecycle, progress tracking, keyboard shortcuts, controls auto-hide.
  - `src/pages/PlayerControls.tsx` — Netflix-style overlay: top bar (back + title), center (skip/play/skip), bottom (timeline + actions).
  - `src/pages/PlayerSettings.tsx` — Settings panel with tabs: Server, Speed, Audio, Subtitles.
  - `src/pages/PlayerPage.css` — Dark glassmorphic styling with gradient overlays, smooth animations.
- **Route**: `/player` is outside the `<Layout>` wrapper (no sidebar/topbar in player mode). Data passed via `navigate('/player', { state: {...} })`.
- **Keyboard shortcuts**: Space/K=pause, Left/Right=seek ±10s, Up/Down=volume ±5, F=fullscreen, M=mute, N=next, Esc=back/exit-fullscreen.
- **Progress tracking**: Uses same `usePlayerProgress` hook as mobile. Saves to `cacheStorage` every 5 seconds, restores on re-entry.

### 6. Future Android Compatibility
Keep platform-specific code in `src/platform/` adapters:
- `platform/storage.ts` — localStorage now, MMKV later for Android
- `platform/crypto.ts` — Web Crypto now, expo-crypto later
- `platform/fs.ts` — Tauri FS now, RNFS later
- `platform/player.ts` — libmpv now, react-native-video later
- `platform/waf.ts` — Tauri window now, RN WebView later

---

## File Mapping (Mobile → Desktop)

### Files to PORT (copy and modify)
| Mobile Source | Desktop Target | Changes Needed |
|---|---|---|
| `src/lib/providers/types.ts` | `src/lib/providers/types.ts` | Remove `expo-crypto` import, use web crypto type |
| `src/lib/providers/headers.ts` | `src/lib/providers/headers.ts` | Copy as-is |
| `src/lib/providers/getBaseUrl.ts` | `src/lib/providers/getBaseUrl.ts` | Use localStorage-based `cacheStorageService` |
| `src/lib/providers/providerContext.ts` | `src/lib/providers/providerContext.ts` | Import from platform adapters |
| `src/lib/storage/extensionStorage.ts` | `src/lib/storage/extensionStorage.ts` | Use ported `mainStorage` |
| `src/lib/storage/SettingsStorage.ts` | `src/lib/storage/SettingsStorage.ts` | Remove download-location RN specifics |
| `src/lib/storage/WatchHistoryStorage.ts` | `src/lib/storage/WatchHistoryStorage.ts` | Use ported `mainStorage` |
| `src/lib/storage/WatchListStorage.ts` | `src/lib/storage/WatchListStorage.ts` | Use ported `mainStorage` |
| `src/lib/storage/CacheStorage.ts` | `src/lib/storage/CacheStorage.ts` | Use ported `cacheStorage` |
| `src/lib/storage/ProvidersStorage.ts` | `src/lib/storage/ProvidersStorage.ts` | Use ported `mainStorage` |
| `src/lib/zustand/*` | `src/lib/zustand/*` | Replace MMKV with localStorage persistence |
| `src/lib/services/ExtensionManager.ts` | `src/lib/services/ExtensionManager.ts` | Copy as-is (pure JS) |
| `src/lib/services/ProviderManager.ts` | `src/lib/services/ProviderManager.ts` | Replace `ToastAndroid` |
| `src/lib/hooks/*` | `src/lib/hooks/*` | Remove RN-specific imports |
| `src/lib/getHomepagedata.ts` | `src/lib/getHomepagedata.ts` | Copy as-is |
| `src/lib/client.ts` | `src/lib/client.ts` | Remove `__DEV__` reference |
| `src/lib/constants.ts` | `src/lib/constants.ts` | Remove RNFS, keep themes/flags/links |
| `src/lib/utils/helpers.ts` | `src/lib/utils/helpers.ts` | Port, check for RN deps |

### Files to REWRITE (new desktop UI)
| Feature | Desktop File(s) |
|---|---|
| App shell & routing | `src/App.tsx`, `src/components/layout/*` |
| Home page | `src/pages/HomePage.tsx`, `src/components/home/*` |
| Info page | `src/pages/InfoPage.tsx`, `src/components/info/*` |
| Player page | `src/pages/PlayerPage.tsx`, `src/components/player/*` |
| Search page | `src/pages/SearchPage.tsx`, `src/components/search/*` |
| Watchlist page | `src/pages/WatchlistPage.tsx`, `src/components/watchlist/*` |
| Settings page | `src/pages/SettingsPage.tsx`, `src/components/settings/*` |
| Extensions page | `src/pages/ExtensionsPage.tsx`, `src/components/settings/ExtensionsManager.tsx` |
| Scroll list page | `src/pages/ScrollListPage.tsx` |

### Files NOT needed on desktop
| Mobile File | Reason |
|---|---|
| `BootSplash` | Desktop doesn't need splash screen |
| `react-native-orientation-locker` | Desktop handles window natively |
| `react-native-haptic-feedback` | No haptics on desktop |
| `expo-navigation-bar` | Not applicable |
| `react-native-safe-area-context` | Not needed |
| `@notifee/react-native` | Use Tauri notification plugin instead |
| `@react-native-firebase/*` | No Firebase on desktop |
| `react-native-bootsplash` | No splash |
| `react-native-permissions` | Tauri handles permissions differently |
| `@himanshu8443/react-native-apk-installer` | Android-only |
| `react-native-fullscreen-chz` | Desktop window controls |
| `react-native-volume-manager` | OS handles volume |

---

## Design Reference

Designs are in `c:\Users\sangw\Desktop\vega-new\desgin\` — use as inspiration, not strict spec.

### Color Palette (from cinematic_noir/DESIGN.md)
```css
--background: #131313;
--surface: #131313;
--surface-container: #1f1f1f;
--surface-container-high: #2a2a2a;
--on-surface: #e2e2e2;
--on-surface-variant: #e4bdc2;
--primary: #ffb2be;
--primary-container: #ff4e7c;
--outline: #ab888c;
--outline-variant: #5b3f43;
--error: #ffb4ab;
```

### Typography
- Font: **Plus Jakarta Sans** (Google Fonts), fallback to **Inter**
- Display: 48px / 800 weight
- Headline: 32px / 700 weight
- Body: 16px / 400 weight
- Label: 14px / 600 weight

### Layout
- Sidebar: ~200px fixed width, left side
- Main content: fluid, with 24px gutters
- Poster cards: 2:3 aspect ratio
- Episode cards: 16:9 aspect ratio
- Border radius: 16px for cards, 8px for buttons

---

## Build & Dev Commands

```bash
cd c:\Users\sangw\Desktop\vega-new\vega-desktop

# Install frontend deps
npm install

# Start dev (Vite only — for UI development without Tauri)
npm run dev

# Start dev with Tauri (full desktop app)
npm run tauri dev

# Build production
npm run tauri build
```

---

## Important Patterns

### How providers work (end to end)
1. User adds a **source URL** (GitHub raw URL) → stored in `extensionStorage`
2. App fetches `manifest.json` from that URL → list of `ProviderExtension`
3. User installs a provider → app downloads JS modules (`posts.js`, `meta.js`, `stream.js`, `catalog.js`, optionally `episodes.js`) from `{sourceUrl}/dist/{providerValue}/`
4. Modules are **cached as strings** in localStorage (via `extensionStorage.cacheProviderModules`)
5. When the app needs data, `ProviderManager` reads the cached module string and executes it with `new Function()`, passing `providerContext` as an argument
6. The module exports functions like `getPosts`, `getSearchPosts`, `getMeta`, `getStream`, `getEpisodes`

### How content flows
```
Provider Source URL → manifest.json → install provider → cached JS modules
                                                              ↓
Home Page → getCatalog() → catalog.js exports → getPosts() → posts.js
                                                              ↓
                                                          Post[] → PostCard grid
                                                              ↓
Info Page → getMeta() → meta.js → Info (title, synopsis, links, seasons)
                                                              ↓
Episode List → getEpisodes() → episodes.js → EpisodeLink[]
                                                              ↓
Player → getStream() → stream.js → Stream[] → play first/selected
```

### Storage instances
- `mainStorage` — primary storage (settings, providers, watch history)
- `cacheStorage` — cache storage (base URLs, home data cache)

### Zustand stores
- `contentStore` — active provider, installed/available providers
- `themeStore` — primary color, custom theme flag
- `watchListStore` — bookmark list
- `watchHistoryStore` — watch history with progress
- `wafStore` — pending WAF challenge queue

---

## Gotchas & Warnings

1. **Provider modules use `new Function()`** — this requires CSP to allow `unsafe-eval`. Tauri's CSP in `tauri.conf.json` is already `null` (unrestricted) — keep it that way.

2. **`expo-crypto` API surface** — providers may call `Crypto.digestStringAsync('SHA-256', input)`. The Web Crypto equivalent is `crypto.subtle.digest('SHA-256', encoder.encode(input))` but the result is an ArrayBuffer, not a hex string. The adapter must return hex strings to match expo-crypto's behavior.

3. **Module code format** — the provider JS modules are CommonJS-style: they assign to `exports.getPosts = ...`. The `ProviderManager.executeModule()` wraps them in a function that provides `exports`, `__awaiter`, `Object`, `console`, `Promise` in scope. This must work identically on desktop.

4. **`getBaseUrl`** fetches from a static GitHub JSON — this is a network call, not a local lookup. The cache is 1 hour.

5. **cheerio works in browser** — no changes needed, `cheerio` is a pure JS library.

6. **Tauri security** — for provider fetching and streaming, Tauri needs network access. The default Tauri config allows this.

7. **Downloads** — mobile uses RN-specific download APIs. Desktop should use Tauri's `@tauri-apps/plugin-http` for downloads. This is a P3 feature, skip initially.

8. **WAF/Cloudflare solver** — mobile opens a WebView for the user to solve captchas. Desktop equivalent: open a new Tauri webview window, wait for cookies, close it. This is P2 — skip initially, providers that need WAF will fail gracefully.

9. **`ToastAndroid`** — used in several places. Replace with a simple toast notification system or `console.warn` initially.

10. **`__DEV__` global** — used in `client.ts`. Replace with `import.meta.env.DEV` for Vite.

---

## How To Continue Work

1. Read `plan.md` for the full architecture and build order
2. Check `progress.md` for what's done and what's next
3. Follow the build order in `plan.md` — each phase is designed so you can test incrementally
4. When porting a file from mobile, always check this `memory.md` for the mapping and what changes are needed
5. Test early: after Phase 1 completes, you should be able to install a provider from the Extensions page
6. After Phase 2, you should be able to browse content and see info pages
7. The player (Phase 3) requires `tauri-plugin-libmpv` setup — run `npx tauri-plugin-libmpv-api setup-lib` in `src-tauri/`

 # # #   6 .   T a u r i   H T T P   P l u g i n   &   C O R S   B y p a s s i n g 
 T o   b y p a s s   C O R S   f o r   e x t e r n a l   p r o v i d e r s ,   ` a x i o s `   r e q u e s t s   a r e   p a t c h e d   u s i n g   ` t a u r i A x i o s A d a p t e r `   a n d   t h e   s a n d b o x   ` f e t c h `   i s   o v e r r i d d e n   w i t h   ` t a u r i F e t c h `   ( ` @ t a u r i - a p p s / p l u g i n - h t t p ` ) . 
 * * C R I T I C A L * * :   Y o u   m u s t   w h i t e l i s t   U R L s   i n   ` s r c - t a u r i / c a p a b i l i t i e s / d e f a u l t . j s o n `   f o r   t h e   H T T P   p l u g i n   t o   w o r k .   E x a m p l e : 
 ` ` ` j s o n 
 " a l l o w " :   [   {   " u r l " :   " h t t p : / / * * "   } ,   {   " u r l " :   " h t t p s : / / * * "   }   ] 
 ` ` ` 
 F a i l u r e   t o   d o   t h i s   r e s u l t s   i n   ` u r l   n o t   a l l o w e d   o n   t h e   c o n f i g u r e d   s c o p e `   e r r o r s . 
 
 # # #   7 .   C o n t e n t   I n f o   S t r u c t u r e   ( L i n k L i s t   v s   E p i s o d e s ) 
 P r o v i d e r s   d o   n o t   r e t u r n   a n   ` e p i s o d e s `   a r r a y   d i r e c t l y   i n s i d e   ` g e t M e t a D a t a ` .   T h e y   r e t u r n   ` l i n k L i s t `   w h i c h   c o n t a i n s   a n   a r r a y   o f   S e a s o n s   o r   C a t e g o r i e s .   E a c h   ` L i n k `   o b j e c t   c o n t a i n s   e i t h e r   ` e p i s o d e s L i n k `   ( f o r   s e r i e s )   w h i c h   m u s t   b e   f e t c h e d   d y n a m i c a l l y   v i a   ` u s e E p i s o d e s ` ,   o r   ` d i r e c t L i n k s `   ( f o r   m o v i e s )   w h i c h   c a n   b e   r e n d e r e d   i m m e d i a t e l y . 
  
 