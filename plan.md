# Vega Desktop Material 3 Redesign Plan

## Goal

Redesign the full Vega Desktop interface around the mobile app's Material 3 visual language while retaining all existing desktop and TV/controller workflows. The implementation will use Tailwind CSS and locally customized shadcn-style primitives, with one shared semantic token system for dark gray, OLED, and white themes plus dynamic artwork accents on content detail pages.

The redesign covers Home, Search, Catalog, Content Details, Player, Watchlist, Downloads, Download Series, Extensions, Settings, dialogs, empty/loading/error states, navigation, and TV focus states.

## Current Baseline

- The app is Vite + React 19 + TypeScript + Tauri with custom CSS and `react-icons`.
- Tailwind, shadcn configuration, Radix primitives, and `class-variance-authority` are not currently installed. The existing `react-icons` package remains the app's icon system.
- Material-like color variables already exist in `src/styles/variables.css`, and `themeStore` persists the primary accent and background theme.
- The left sidebar, top bar, custom select, settings controls, and many detail-page elements use page-specific CSS or inline styles.
- Desktop TV/controller support uses Norigin spatial navigation and must remain compatible with every new interactive primitive.
- The content detail page already owns season/direct-link selection, episode fetches, resume progress, playback navigation, downloads, and stream selection. Its logic should be retained while its UI is decomposed into focused components.

## Design Direction

- Use Material 3 semantic roles rather than literal colors: background, surface containers, on-surface text, outline, primary, primary container, secondary container, error, and inverse surface.
- Preserve the existing gray, OLED, and white backgrounds. Accent selection updates all related primary semantic tokens, not just `--primary`.
- Use a desktop navigation rail on wide windows, collapsing to an icon-only compact rail when space is constrained. Active destinations receive an animated Material 3 indicator behind the icon and label.
- Use low-elevation container surfaces, restrained 8px radii for repeated cards and tool surfaces, and compact density appropriate for a media library application.
- Use `react-icons` consistently for controls. Prefer the existing Lucide icon set exposed by `react-icons/lu`; icon-only controls must have accessible labels and tooltips.
- Skeletons, spinners, indeterminate indicators, and other loading surfaces must use semantic theme tokens. They must respond to gray, OLED, white, and scoped artwork-accent themes without fixed gray or white colors.
- Use purposeful motion: route-level content transitions, tab-indicator movement, card focus/hover elevation, skeletons, and dialog/menu entrances. Honor reduced-motion preferences.
- Keep the player as a functional fullscreen surface. Do not wrap it in generic app-shell cards.

## Phase 1: UI Foundation

1. Install and configure the desktop styling stack.
   - Add Tailwind CSS, PostCSS, and the Vite integration appropriate for the installed Tailwind version.
   - Add shadcn prerequisites: Radix UI primitives as needed, `class-variance-authority`, `clsx`, and `tailwind-merge`. Keep `react-icons`; do not add or migrate to `lucide-react`.
   - Create `components.json`, Tailwind configuration, and a `src/lib/utils.ts` `cn` helper.
   - Keep the existing app build and Tauri commands unchanged.

2. Create the Material 3 token bridge.
   - Move semantic color variables from `src/styles/variables.css` into Tailwind-compatible CSS custom properties.
   - Define tokens for every existing theme: gray, OLED, and white.
   - Expand `themeStore`/the root theme application so an accent seed derives primary, on-primary, primary-container, on-primary-container, and focus-ring values with accessible contrast in each background theme.
   - Replace hard-coded white, black, red, translucent gray, skeleton, spinner, and gradient colors in UI code with semantic tokens.
   - Keep font loading centralized and revise typography roles to mirror the mobile hierarchy without scaling text with viewport width.

3. Build shared, customizable primitives under `src/components/ui/`.
   - `Button`, `IconButton`, `Tooltip`, `Input`, `Dialog`, `DropdownMenu`, `Select`, `Switch`, `Tabs`, `Badge`, `Progress`, `Skeleton`, and `Separator` based on shadcn patterns while using icons from `react-icons`.
   - Build `Skeleton` and loading indicators from `--surface-container*`, `--outline-variant`, and accent tokens so every loading state follows the active theme automatically.
   - Add Vega-specific wrappers where behavior is shared: `FocusableButton`, `FocusableMenuItem`, `FocusableSelect`, and `FocusableSwitch` should preserve Norigin spatial navigation, Enter handling, and visible TV focus.
   - Establish one interactive state system for pointer hover, keyboard focus, TV focus, disabled, loading, and pressed states.
   - Replace `CustomSelect` only after its keyboard, pointer, outside-click, and TV focus behavior have parity coverage.

4. Add motion and accessibility rules.
   - Add shared motion tokens and reduced-motion styles.
   - Ensure dialogs trap focus and restore it on close.
   - Provide semantic labels, visible focus rings, tooltips for icon-only commands, and predictable keyboard behavior for menus, selects, switches, and dialogs.

## Phase 2: App Shell and Navigation

1. Refactor `Layout`, `Sidebar`, `Topbar`, `FocusableNavLink`, and `FocusableButton` into an M3 app shell.
   - Retain routing and TV focus boundaries.
   - Rebuild the sidebar as an animated navigation rail with a sliding active indicator, icon + optional label states, tooltips in compact mode, and a clearly separated utility area for Extensions and Settings.
   - Use route transitions that do not disturb playback or scroll restoration.
   - Make the rail responsive to window width without collapsing content into overlapping layouts.

2. Rebuild the top bar.
   - Present an M3 search affordance, provider switcher, contextual page title/breadcrumb where useful, and compact utility controls.
   - Preserve the current home search behavior, keyboard/TV input mechanics, and provider selection behavior.
   - Ensure search navigation enters `/search`, rather than retaining the existing ambiguous home-query path if that is no longer required by the home page.

## Phase 3: Content Discovery Pages

1. Home.
   - Refresh the hero into a full-width artwork surface with image-derived accent tint, readable contrast layer, title/logo, metadata, primary play action, and secondary watchlist action.
   - Rebuild content rails with consistent poster cards, loading skeletons, hover/focus overlays, and provider-aware navigation.
   - Keep all existing homepage data queries and slider behaviors.

2. Search and Catalog.
   - Build a shared search field with clear, submit, loading, empty, and keyboard-focus states.
   - Redesign provider result groups as compact titled rails and catalog results as an adaptive poster grid.
   - Add proper no-results, provider-loading, network-error, and pagination sentinel visuals.
   - Preserve URL query synchronization and infinite-query behavior.

3. Watchlist and Downloads.
   - Redesign saved media and downloads into scan-friendly list/grid views with progress, status, inline actions, filters where data supports them, and meaningful empty states.
   - Use M3 progress indicators and status chips for queued, downloading, paused, completed, and failed downloads.
   - Redesign the series-download drilldown without changing its stored download identifiers or playback paths.

4. Extensions.
   - Use a dense extension list with provider identity, enable/update/error state, install/update/remove actions, and clear empty/error states.
   - Preserve extension lifecycle functions and WAF handling.

## Phase 4: Dynamic Content Detail Page

1. Introduce an artwork color system.
   - Add a desktop image-color utility/hook that extracts a stable palette from `meta.background`, `meta.poster`, or `info.image`.
   - Cache colors by image URL and use a deterministic fallback when extraction fails.
   - Apply the result as scoped CSS variables on the detail page only: hero scrim, primary action container, selected season/episode state, progress indicator, and subtle surface tint.
   - Enforce contrast against the active gray/OLED/white theme and do not let artwork colors replace global accessibility tokens.

2. Split `MetaPage.tsx` into focused feature components while preserving its data and event contracts.
   - `ContentHero`: artwork, back control, logo/title, metadata, watchlist command.
   - `ContentOverview`: synopsis, cast, genres, and metadata.
   - `SeasonSelector`: shadcn/Radix select with pointer, keyboard, and TV focus support.
   - `EpisodeList` and `EpisodeRow`: episode/direct-link rows, watched state, resume progress, play command, and download action.
   - `DownloadAction`: queued/downloading/completed/error visuals and action semantics.
   - `ContentDetailSkeleton` and scoped error/empty states.
   - Keep `useContentDetails`, `useEpisodes`, provider URLs, local season storage, navigation state, resume keys, and download payload fields unchanged.

3. Improve episode links.
   - Make each row clearly communicate episode number/title, watched/resume state, duration/metadata when available, and primary playback affordance.
   - Use a consistent selected/hover/TV-focus state with artwork accent color.
   - Replace generic play/download controls with labeled `react-icons` icon buttons, tooltips, disabled states, and visible extraction/download progress.
   - Ensure direct links and fetched episodes use the same visual component and action model.

## Phase 5: Player and Supporting Dialogs

1. Player.
   - Redesign desktop player controls as a layered M3 media control surface: transport, timeline, stream/server selector, subtitle and audio controls, episode navigation, and error/retry states.
   - Keep the MPV lifecycle, route state, external player paths, desktop/TV branching, media keys, and progress persistence intact.
   - Preserve fullscreen and pointer/keyboard/TV operation.

2. Dialogs and menus.
   - Rebuild `DownloadServerDialog`, WAF dialog, subtitle search modal, provider switcher, and all confirmation/error dialogs using the shared dialog/menu primitives.
   - Make stream choices show server name, quality, codec/type, subtitles, and selection state when data is available.
   - Ensure each dialog handles loading, no-data, error, Escape, and spatial-navigation boundaries correctly.

## Phase 6: Settings Redesign

1. Rebuild `SettingsPage`, `PreferencesSettings`, and `SubtitleSettings` as a structured M3 settings experience.
   - Use grouped settings surfaces with title, description, trailing control, divider, and compact responsive stacking.
   - Use M3 `Switch` controls for booleans rather than `ON`/`OFF` text buttons.
   - Use segmented controls for background theme choices and an accent swatch selector with selection indicators.
   - Use a stepper/input for download concurrency, a proper select for DNS provider, and an input with validation for custom DNS URLs.
   - Keep all existing `settingsStorage` reads/writes and restart-required messaging.

2. Include desktop-specific appearance behavior.
   - Retain gray/OLED/white themes.
   - Add a clearly scoped content-artwork accent behavior for the detail page, with an option to disable it if visual testing shows a meaningful performance or readability cost.
   - Keep selected accent and theme persistent across launches.

## Migration Order

1. Add Tailwind/shadcn prerequisites and token bridge without redesigning routes.
2. Build shared interactive/focusable UI components and test them in isolation.
3. Rebuild the app shell and navigation rail.
4. Redesign Home, Search, Catalog, Watchlist, Downloads, Extensions, and their states.
5. Implement artwork palette extraction and refactor the Content Detail page into components.
6. Redesign player controls and dialogs.
7. Redesign Settings and replace remaining legacy switches/selects/buttons.
8. Remove superseded page CSS and dead custom control CSS only after every route has migrated.

## File Targets

- Foundation: `package.json`, Tailwind/PostCSS configuration, `components.json`, `src/styles/index.css`, `src/styles/variables.css`, `src/lib/utils.ts`, `src/lib/zustand/themeStore.ts`, `src/App.tsx`.
- Shared UI: new `src/components/ui/*` primitives plus focused TV wrappers near `src/components/layout/`.
- Shell: `src/components/layout/Layout.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `FocusableNavLink.tsx`, `FocusableButton.tsx`, and legacy layout CSS.
- Detail and dynamic color: `src/pages/MetaPage.tsx`, new `src/components/content/*`, `src/lib/hooks/*` or `src/lib/utils/*` for palette extraction, `src/pages/MetaPage.css`.
- Other routes: `src/pages/HomePage.tsx`, `SearchPage.tsx`, `CatalogPage.tsx`, `WatchlistPage.tsx`, `DownloadsPage.tsx`, `DownloadsSeriesPage.tsx`, `ExtensionsPage.tsx`, `SettingsPage.tsx`, and their companion CSS.
- Legacy controls: `src/components/CustomSelect.tsx`, download/WAF/subtitle dialogs, provider switcher, and settings components.

## Validation and Acceptance Criteria

- `npm run build` passes after each phase that changes TypeScript or styles.
- Existing behavior remains functional: provider switching, search URL sync, content and episode fetches, season persistence, play navigation, downloads, resume progress, watchlist, extensions, app updates, settings persistence, WAF flows, and mobile/TV branches in the desktop bundle.
- Test keyboard, mouse, touchpad, and TV/controller navigation for every shared control and dialog.
- Verify gray, OLED, and white themes for contrast, selected state visibility, and readability.
- Verify artwork accent extraction is cached, never blocks first content render, and has a correct fallback for missing/failed images.
- Verify every skeleton, spinner, shimmer, and loading overlay in gray, OLED, white, and artwork-accent contexts; no loading UI may rely on fixed light/dark colors.
- Verify desktop widths from compact to ultrawide, including no content overlap, no clipped navigation labels, and stable grids/episode rows.
- Validate reduced motion, focus restoration after dialogs, Escape behavior, and ARIA labels/tooltips for icon-only controls.
- Capture desktop screenshots for Home, Search, Content Detail, Player, Downloads, Extensions, and Settings in at least one dark theme and the white theme before removing legacy CSS.

## Non-Goals

- Do not rewrite provider, download, synchronization, MPV, Tauri, or storage business logic as part of the visual migration.
- Do not remove TV/controller support in favor of pointer-only shadcn behavior.
- Do not introduce a generic marketing landing page or replace media artwork with decorative placeholder visuals.
- Do not perform a single large rewrite; each phase should be independently buildable and visually reviewable.
