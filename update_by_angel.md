# Vega v1.4.3b — Update by Angel Mehul Singh

This document outlines the UI enhancements, visual overhauls, and build configuration changes implemented in **Vega Desktop v1.4.3b** by Angel Mehul Singh.


* **Author:** Angel Mehul Singh
* **UI Design & Aesthetics:** [@br31tech.in](https://br31tech.in)

---

> [!CAUTION]
> **Developer Machine Disclaimer**
>
> The build environment changes documented in this file (including the installation of **CMake**, **NASM**, and **LLVM/Clang**, and modifications to system `PATH` variables) were performed exclusively on **Angel's personal developer machine** to satisfy native compilation requirements of the `wreq` / `boring-sys2` dependency chain.
>
> These changes are **specific to his machine's setup and tech stack**. If you attempt to replicate the build on a different system, you are doing so **entirely at your own risk**. Angel Mehul Singh and the br31tech team are **not responsible** for any issues, conflicts, or breakage that may arise on third-party developer machines as a result of following this stack.
>
> If you encounter build failures, please refer to the official documentation for [wreq](https://crates.io/crates/wreq), [boring-sys2](https://crates.io/crates/boring-sys2), and [bindgen](https://crates.io/crates/bindgen) for platform-specific prerequisites.

---


## 🎨 Design System & Global Variables

### [variables.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/styles/variables.css)
* **Custom Themes:** Refined default themes and added variables for a brand-new **Deep Blue** theme (`[data-theme="deep-blue"]`).
* **Clean Light Theme:** Upgraded the **White** theme with cleaner, higher-contrast containers and outlines.
* **Glow Infrastructure:** Defined `--primary-rgb` color channel coordinates to support premium backdrop glows and shadows.

### [Sidebar.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/components/layout/Sidebar.css)
* **Active State Glow:** Styled active navigation items with a solid primary background and a matching colored shadow (`box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3)`).

---

## 🧭 Layout & Core Navigation

### [Topbar.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/components/layout/Topbar.tsx)
* **Query Syncing:** Implemented dynamic synchronization between the search input box and the URL parameters (`q`), ensuring state consistency when navigating or sharing queries.

---

## ⚙️ Settings Overhaul

### [SettingsPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/SettingsPage.tsx) & [SettingsPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/SettingsPage.css)
* **Group Reordering:** Repositioned the **Preferences** section to the top for faster access, followed by Appearance, Subtitles, and About.
* **Header Icons:** Configured Lucide icons (`LuSlidersHorizontal`, `LuMonitor`, `LuCaptions`, `LuInfo`) for group titles to look clean and modern.
* **Premium Cards:** Redesigned the settings group containers to use border shadows (`0 8px 32px rgba(0, 0, 0, 0.2)`), subtle outlines, and structured paddings.
* **Theme Controls:** Added explicit buttons to select the new **Deep Blue** and **White** themes in the Appearance tab.

### [PreferencesSettings.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/components/settings/PreferencesSettings.tsx)
* **Visual Icons:** Re-structured all preference rows to include Lucide icons representing categories (Folder, Layers, Download, Refresh, Gamepad, CPU, Terminal, Shield, Video).
* **Control Layouts:** Standardized toggles (like DNS over HTTPS) and converted resolution exclusion options into responsive toggle chips.

### [SubtitleSettings.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/components/settings/SubtitleSettings.tsx)
* **Live Preview Box:** Introduced a mock cinematic preview container at the bottom of the page. Subtitle font family, size, weight, outline width, and bottom padding update in real-time on a radial-gradient background screen to visualize changes before playback.

---

## 🏠 Pages & UX Enhancements

### [HomePage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/HomePage.tsx) & [HomePage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/HomePage.css)
* **Back Search Exit:** Added an elegant circular floating back button in search results to clear queries and exit the search mode instantly.

### [SearchPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/SearchPage.tsx) & [SearchPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/SearchPage.css)
* **Recommended Tags:** Created an attractive grid of "Recommended Searches" tag chips (Action, Comedy, Sci-Fi, etc.) for quick search activation.
* **Search Icon Glow:** Added a smooth radial backdrop glow effect behind the search icon in the empty page layout.
* **Provider Wrappers:** Surrounded content rows in bordered slider wraps (`.search-provider-slider-wrap`) featuring vertical accent colors.
* **Navigation Sync:** Added a dedicated back/clear button in the query header area.

### [WatchlistPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/WatchlistPage.tsx) & [WatchlistPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/WatchlistPage.css)
* **Visual Header:** Designed a clean page header with a container bookmark icon and a dynamic saved item counter.
* **Card Animations:** Programmed smooth hover effects on movie/show tiles (lift translate + subtle scale).
* **Hover Trash Button:** Styled the deletion button to fade in on card hover, transforming into an error-themed glowing red button on hover/focus.
* **Glow Empty State:** Created a matching bookmark icon glow for empty lists.

### [DownloadsPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/DownloadsPage.tsx) & [DownloadsPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/DownloadsPage.css)
* **Status Badges:** Replaced simple status strings with beautiful status badges:
  * 🔴 **Error** (translucent red)
  * 🔵 **Queued** (translucent blue)
  * 🟡 **Paused** (translucent yellow)
  * 🟢 **Downloading** (primary themed with an active pulse animation)
* **Visual Polish:** Added consistent container card layouts, action hover transitions, overlay states, and error highlight buttons.

### [ExtensionsPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/ExtensionsPage.tsx) & [ExtensionsPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/ExtensionsPage.css)
* **Tabbed Navigation:** Split extensions into "Installed" and "Discover" lists for a clean interface.
* **Category Filters:** Added text search and category type filtering (e.g. Movie, Anime) dynamically derived from provider metadata.
* **Grid vs List Views:** Integrated a view toggle allowing users to switch between a visual grid layout and a structured list list layout.
* **Focus States:** Handled arrow-key navigation borders and spacing.

### [MetaPage.tsx](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/MetaPage.tsx) & [MetaPage.css](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src/pages/MetaPage.css)
* **Smart Back Navigation:** Configured history index checks to safely step back in the application routing hierarchy without locking the page.
* **Glassmorphic Floating Arrow:** Styled the floating back arrow to behave like a glass panel with a blur filter, scaling transitions, and a colored glow.
* **Information Tags:** Standardized meta attributes (year, runtime, ratings, content type) into individual pill-shaped translucent tags.

---

## 📦 Core & Libraries

### [libmpv-2.dll](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src-tauri/lib/libmpv-2.dll)
* **Library Update:** Upgraded the primary rendering DLL binaries to support enhanced video playback stability.

### [package-lock.json](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/package-lock.json)
* **Dependencies:** Cleaned up unused dependency libraries (removed `@napi-rs/canvas`).

### [config.toml](file:///d:/SteamLibrary/Vega4UPDT/vega-desktop/src-tauri/.cargo/config.toml)
* **Cargo Config:** Created build environment configurations to enable `AWS_LC_SYS_PREBUILT_NASM=1` by default, resolving compilation errors due to missing `nasm` assembler tools on Windows host machines.

