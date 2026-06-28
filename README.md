![vega-high-resolution-logo-transparent](https://github.com/Zenda-Cross/vega-app/assets/143804558/b2eb446f-8e7f-4800-81e1-3320c82f33de)

# Vega-Desktop
Native Desktop app for streaming media (Windows, macOS, Linux).
### Features
- Bring your own sources.
- Stream and Download Ad-Free.
- Multi Audio and external Subs support.
- WatchList.
- Desktop-native, hardware-accelerated video player (MPV).
- Background Provider Auto-Update.
<br>

[![Discord](https://custom-icon-badges.demolab.com/badge/-Join_Discord-6567a5?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/cr42m6maWy)

___

## Download ![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/vega-org/vega-desktop/total?link=https%3A%2F%2Fgithub.com%2Fvega-org%2Fvega-desktop%2Freleases&label=Github%20Downloads)

[![Download Installers](https://custom-icon-badges.demolab.com/badge/-Download_From_Github-black?style=for-the-badge&logo=download&logoColor=white)](https://github.com/vega-org/vega-desktop/releases/latest)

[![Download From Website](https://custom-icon-badges.demolab.com/badge/-Download_From_Website-tomato?style=for-the-badge&logo=download&logoColor=white)](https://vega.8man.in/#desktop)


## Vega for Mobile
https://github.com/vega-org/vega-app


<br>

## Add Provider source
> [!TIP]
> Follow the guide here https://vega.8man.in/guide/adding-providers/



### Sreenshots
<img width="2047" height="1077" alt="Screenshot 2026-06-26 112125" src="https://github.com/user-attachments/assets/ade6354c-cc1c-448a-a353-dc6912246471" />
<details>
  <summary>More</summary>
  <img width="853" height="445" alt="Screenshot 2026-06-26 113245" src="https://github.com/user-attachments/assets/28e7a630-a822-4dc5-9a26-f102ac3b0240" />
  <img width="853" height="444" alt="Screenshot 2026-06-26 113101" src="https://github.com/user-attachments/assets/43f2119a-b61c-498e-8421-00cd9ca8f3da" />
  <img width="2042" height="1087" alt="Screenshot 2026-06-26 112352" src="https://github.com/user-attachments/assets/ad8692ac-d9ed-4784-b4e1-3243cd16d966" />

</details>


___

## Stack
<p align="left">
     
[![Tauri](https://custom-icon-badges.demolab.com/badge/-Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://custom-icon-badges.demolab.com/badge/-React-287aad?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://custom-icon-badges.demolab.com/badge/Typescript-3078C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://custom-icon-badges.demolab.com/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Zustand](https://custom-icon-badges.demolab.com/badge/Zustand-443E38?style=for-the-badge&logo=react&logoColor=white)](https://zustand-demo.pmnd.rs/)

</p>

## Build and Dev
0. Set up Tauri environment if you haven't already. [Guide](https://tauri.app/v1/guides/getting-started/prerequisites)

1. clone
     ```bash
     git clone https://github.com/vega-org/vega-desktop.git
     cd vega-desktop
     ```
2. Install
     ```bash
     npm install
     ```
3. Open dev server & desktop app
     ```bash
     npm run tauri dev
     ```
4. Build production installers (.exe, .dmg, .AppImage)
     ```bash
     npm run tauri build
     ```
# Linux Playback Architecture

## Why this fork exists

The upstream Vega Desktop uses embedded libmpv for playback.

On Linux, especially inside Docker/X11 or lightweight desktop environments, embedded libmpv may initialize successfully but never render video (player remains at 00:00).

This fork keeps the upstream UI and provider system unchanged while replacing only the Linux playback backend.

---

## Design Goals

* Stay as close to upstream as possible.
* Keep Linux-specific code isolated.
* Make future upstream merges simple.
* Do not modify Windows or macOS playback.

---

## Linux Playback Flow

PlayerPage

↓

useMpvPlayer

↓

useExternalMpv (Linux only)

↓

Tauri invoke

↓

external_mpv.rs

↓

mpv (external process)

---

## Files Added

```
src/lib/hooks/useExternalMpv.ts
src-tauri/src/external_mpv.rs
```

---

## Files With Minimal Changes

```
src/lib/hooks/useMpvPlayer.ts
src-tauri/src/lib.rs
```

These files should only contain routing logic.

All Linux playback implementation belongs inside the new files.

---

## Updating From Upstream

```
git fetch upstream

git merge upstream/main
```

Normally only these files need attention:

```
useMpvPlayer.ts
lib.rs
```

The Linux backend files should remain reusable across releases.

---

## Philosophy

The upstream project remains the source of truth.

This fork only replaces the Linux playback backend.

Everything else should stay upstream-compatible whenever possible.

---
> [!IMPORTANT]
> Vega Desktop does not host, store, or provide any media content. It is not affiliated with or connected to any external providers or extensions. All content accessed through the app is managed and sourced directly by the user via third-party tools or integrations. Vega Desktop has no control over it.


## Stars
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=vega-org/vega-desktop&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=vega-org/vega-desktop&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=vega-org/vega-desktop&type=Date" />
 </picture>
