# Shared browser application

The browser build uses Desktop's React UI, provider runtime and common Libmedia
engine. It is separate from the Cast receiver in `vega-site/packages/web-cast`.

## Run and build

From `vega-desktop`, with dependencies already installed:

```powershell
npm run dev:web
```

Open `http://localhost:5173`. To check the production application:

```powershell
npm run build:web
npm run preview:web
```

For the hosted proxy, deploy the Worker and assets together with `npm run deploy:web`; see [hosted proxy setup](hosted-proxy.md). Static-only hosting supports extension networking but does not supply the proxy.

Deploy the contents of `dist-web` at the origin root. Configure your static server
to serve `index.html` for application routes such as `/settings` and `/extensions`,
while serving real asset files normally. Subdirectory hosting has not been tested.
Existing `dev`, `build` and Tauri commands keep their Desktop behavior and `dist`
output. The browser build targets ES2022; older TV browsers need device validation.

## Current behavior

- Fresh browser storage has no provider sources or installed providers. Users add
  a source through Extensions, then explicitly install a provider from that source.
  Adding a source alone does not install its providers.
- Home, Search, details, saved Library items, Extensions, Settings and Player use
  the shared frontend and browser storage. Browser storage belongs to this origin;
  this does not automatically share Desktop's existing profile.
- Playback selects Libmedia without changing a saved Desktop player preference.
  Browser fullscreen and local subtitle file selection use browser APIs.
- Episode downloads open the selected source URL in a new browser tab instead of
  starting the native downloader. The source server and browser decide whether
  that link downloads a file or opens media. Subtitle download links work the same
  way. The source picker requires a click, including for quick-download providers,
  so opening the new tab stays attached to a user action.
- Native window controls, updates, download management, local-folder imports, backup/log
  export and external player controls are hidden. Native sync and startup services
  do not run in the browser. Torrent playback reports an unsupported capability.
- Provider verification windows default to **Ask every time**, with **Block** and
  **Allow** available in Preferences. The same consent gate applies to Desktop's
  private WebView. Browser verification uses extension 0.3.0's fresh incognito
  window and requires Chrome's **Allow in Incognito** setting. Upgrade to extension
  **0.4.0** for provider destination checks. See the extension
  README for its clearance-only limits and cookie-isolation checks.
- TV mode retains the shared focus system. Arrow/Enter sidebar navigation is
  checked in Chrome; full remote/back/focus restoration still needs work and TV
  hardware verification.

## Networking limits

The provider setup dialog recommends the extension for better playback and offers **Skip and use proxy**. Skipping persists the proxy preference and resumes setup. The proxy requires its Worker secret and Cloudflare WAF configuration; all public HTTPS domains are supported; see [hosted proxy setup](hosted-proxy.md).

Public servers permitting browser CORS can be used directly without an extension.
Provider requests requiring restricted headers, isolated cookies or protected
media delivery need a platform host. Missing capabilities produce explicit errors.
An initial optional [Chrome extension adapter](../browser-extension/README.md)
now implements the host contract for metadata, protected files and finite HLS
VOD. With extension 0.5.0, open its popup and choose **Allow all websites**, then approve ChromeÃ¢â‚¬â„¢s permission request before using provider networking. Access can be revoked from the same popup. Once approved, it activates automatically on `vega-app.in` and localhost
(including the `127.0.0.1` development alias); see its
installation instructions and current limits. Installed LG/Amazon TV builds use
their own [native host projects](tv-apps.md) and do not need this extension.
Real-provider compatibility still requires validation on each host.

The shared app accepts the same host contract for an optional browser extension
and installed TV apps. See [platform networking](platform-networking.md) for the
HTTP and media-delivery contracts. An installed WebView still needs its host
implementation; packaging the page alone does not supply these capabilities.

## Validation

```powershell
npm run test:platform
npm run test:libmedia
npm run test:libmedia:browser
npm run test:web
npm run test:extension
npm run build
```

The browser suite checks startup/navigation, fresh storage, explicit source and
provider installation, metadata, episodes, actual advancing Libmedia playback,
fullscreen, subtitles/seek/cleanup, and basic TV keyboard navigation. Its provider
exists only in intercepted test responses and is never included in the app.
Synthetic video generation uses the existing Desktop FFmpeg test tool; browser
playback runs entirely through Libmedia. Playback checks skip if that fixture tool
is unavailable, so check the reported pass/skip counts.

`test:web` builds `dist-web` and checks production startup, route reloads and
unsupported native controls. These Chrome checks do not establish Tauri WebView
or TV runtime compatibility. Packaging and device checks remain in the workspace
root `plan.md`.
