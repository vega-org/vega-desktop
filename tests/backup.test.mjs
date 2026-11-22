import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function compileModule(relative, imports = {}) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  for (const [name, value] of Object.entries(imports)) {
    js = js
      .replaceAll(`'${name}'`, JSON.stringify(value))
      .replaceAll(`"${name}"`, JSON.stringify(value));
  }
  return moduleUrl(js);
}

const store = new Map();
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  key: (index) => Array.from(store.keys())[index] ?? null,
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const contentState = {
  provider: { value: "" },
  installedProviders: [],
  setProvider(provider) {
    contentState.provider = provider;
  },
  setInstalledProviders(providers) {
    contentState.installedProviders = providers;
  },
};
const themeUpdates = [];
const watchListUpdates = [];
const historyUpdates = [];

const storageUrl = await compileModule("../src/platform/storage.ts");
const storageFacadeUrl = moduleUrl(`
  export * from ${JSON.stringify(storageUrl)};
`);

const settingsStorageUrl = moduleUrl(`
  import { mainStorage } from ${JSON.stringify(storageUrl)};
  export const SettingsKeys = {
    PRIMARY_COLOR: "primaryColor",
    IS_CUSTOM_THEME: "isCustomTheme",
    SHOW_TAB_BAR_LABELS: "showTabBarLabels",
    SHOW_CONTINUE_WATCHING: "showContinueWatching",
    CUSTOM_COLOR: "customColor",
    UI_SCALE: "uiScale",
    VERIFICATION_WINDOWS: "verificationWindows",
    AUTO_UPDATE_PROVIDERS: "autoUpdateProviders",
    HAPTIC_FEEDBACK: "hapticFeedback",
    NOTIFICATIONS_ENABLED: "notificationsEnabled",
    AUTO_CHECK_UPDATE: "autoCheckUpdate",
    AUTO_DOWNLOAD: "autoDownload",
    SHOW_MEDIA_CONTROLS: "showMediaControls",
    SHOW_HAMBURGER_MENU: "showHamburgerMenu",
    HIDE_SEEK_BUTTONS: "hideSeekButtons",
    SHOW_PLAYER_EPISODE_SIDEBAR: "showPlayerEpisodeSidebar",
    ENABLE_2X_GESTURE: "enable2xGesture",
    ENABLE_SWIPE_GESTURE: "enableSwipeGesture",
    EXCLUDED_QUALITIES: "excludedQualities",
    DOWNLOAD_CONCURRENCY: "downloadConcurrency",
    DOWNLOAD_CONNECTIONS: "downloadConnections",
    SUBTITLE_FONT_SIZE: "subtitleFontSize",
    SUBTITLE_BOTTOM_PADDING: "subtitleBottomPadding",
    SUBTITLE_TEXT_COLOR: "subtitleTextColor",
    SUBTITLE_FONT_FAMILY: "subtitleFontFamily",
    LIST_VIEW_TYPE: "viewType",
    TELEMETRY_OPT_IN: "telemetryOptIn",
    TMDB_API_KEY: "tmdbApiKey",
    TMDB_API_KEY_REVISION: "tmdbApiKeyRevision",
    WARP_ENABLED: "warpEnabled",
    BYEDPI_ENABLED: "byedpiEnabled",
    BYEDPI_CMD_ARGS: "byedpiCmdArgs",
    TV_MODE_ENABLED: "tvModeEnabled",
    INFO_PAGE_DYNAMIC_THEME: "infoPageDynamicTheme",
    SUBTITLE_FONT_WEIGHT: "subtitleFontWeight",
    SUBTITLE_OUTLINE_SIZE: "subtitleOutlineSize",
    SUBTITLE_OUTLINE_COLOR: "subtitleOutlineColor",
    SUBTITLE_SHADOW_COLOR: "subtitleShadowColor",
    SUBTITLE_SHADOW_SIZE: "subtitleShadowSize",
    SUBTITLE_SHADOW_STYLE: "subtitleShadowStyle",
    HARDWARE_ACCELERATION: "hardwareAcceleration",
    DEVTOOLS_SHORTCUTS_ENABLED: "devtoolsShortcutsEnabled",
    EXTERNAL_PLAYER_ENABLED: "externalPlayerEnabled",
    VLC_ENABLED: "vlcEnabled",
    PLAYER_ZOOM: "playerZoom",
    PLAYER_ENGINE: "playerEngine",
  };
  export const settingsStorage = {
    getPrimaryColor: () => mainStorage.getString("primaryColor") || "#FFFFFF",
    isCustomTheme: () => mainStorage.getBool("isCustomTheme", false),
  };
`);

const providersStorageUrl = moduleUrl(`
  export const ProvidersKeys = { DISABLED_PROVIDERS: "disabledProviders" };
`);

const extensionStorageUrl = moduleUrl(`
  export const ExtensionKeys = {
    INSTALLED_PROVIDERS: "installedProviders",
    PROVIDER_SOURCES: "providerSources",
    PROVIDER_MODULES: "providerModules",
  };
`);

const watchHistoryStorageUrl = await compileModule(
  "../src/lib/storage/WatchHistoryStorage.ts",
  { "./StorageService": storageFacadeUrl },
);

const watchListStorageUrl = await compileModule(
  "../src/lib/storage/WatchListStorage.ts",
  { "./StorageService": storageFacadeUrl },
);

const contentStoreUrl = moduleUrl(`
  globalThis.__vegaTestContentState ??= {
    provider: { value: "" },
    installedProviders: [],
    setProvider(p) { this.provider = p; },
    setInstalledProviders(ps) { this.installedProviders = ps; },
  };
  export default { getState: () => globalThis.__vegaTestContentState };
`);

const themeStoreUrl = moduleUrl(`
  globalThis.__vegaTestThemeUpdates ??= [];
  export default { setState: (s) => globalThis.__vegaTestThemeUpdates.push(s) };
`);

const watchListStoreUrl = moduleUrl(`
  globalThis.__vegaTestWatchListUpdates ??= [];
  export default { setState: (s) => globalThis.__vegaTestWatchListUpdates.push(s) };
`);

const watchHistoryStoreUrl = moduleUrl(`
  globalThis.__vegaTestHistoryUpdates ??= [];
  export default { setState: (s) => globalThis.__vegaTestHistoryUpdates.push(s) };
`);

globalThis.__vegaTestContentState = contentState;
globalThis.__vegaTestThemeUpdates = themeUpdates;
globalThis.__vegaTestWatchListUpdates = watchListUpdates;
globalThis.__vegaTestHistoryUpdates = historyUpdates;

const libraryBackupUrl = await compileModule("../src/lib/libraryBackup.ts", {
  "./storage/StorageService": storageFacadeUrl,
  "./storage/WatchListStorage": watchListStorageUrl,
  "./zustand/watchListStore": watchListStoreUrl,
});

const backupUrl = await compileModule("../src/lib/backup.ts", {
  "./storage/StorageService": storageFacadeUrl,
  "./storage/SettingsStorage": settingsStorageUrl,
  "./storage/ProvidersStorage": providersStorageUrl,
  "./storage/extensionStorage": extensionStorageUrl,
  "./storage/WatchHistoryStorage": watchHistoryStorageUrl,
  "./zustand/contentStore": contentStoreUrl,
  "./zustand/themeStore": themeStoreUrl,
  "./zustand/watchHistrory": watchHistoryStoreUrl,
  "./libraryBackup": libraryBackupUrl,
});

const { mainStorage, cacheStorage } = await import(storageUrl);
const { watchHistoryStorage } = await import(watchHistoryStorageUrl);
const {
  BACKUP_VERSION,
  createBackup,
  describeBackupSections,
  parseBackup,
  restoreBackup,
} = await import(backupUrl);

// Exact validation logic from vega-mobile/src/lib/backup.ts
function assertValidMobileBackup(rawJson) {
  const data = JSON.parse(rawJson);
  assert.equal(data?.app, "vega");
  assert.equal(typeof data.version, "number");
  assert.ok(data.version <= 2, "version must be <= mobile BACKUP_VERSION (2)");
  const { settings, providers, library, history, progress } = data;
  const settingsValid =
    settings !== undefined &&
    settings !== null &&
    typeof settings === "object" &&
    !Array.isArray(settings);
  const providersValid =
    providers !== undefined &&
    providers !== null &&
    typeof providers === "object" &&
    !Array.isArray(providers) &&
    Array.isArray(providers.installed) &&
    Array.isArray(providers.sources) &&
    Array.isArray(providers.modules);
  assert.ok(
    !(settings !== undefined && !settingsValid) &&
      !(providers !== undefined && !providersValid) &&
      !(data.version < 2 && (!settingsValid || !providersValid)) &&
      !(
        settings === undefined &&
        providers === undefined &&
        library === undefined &&
        history === undefined &&
        progress === undefined
      ),
  );
  if (history !== undefined) {
    assert.ok(Array.isArray(history));
    for (const item of history) {
      assert.equal(typeof item.id, "string");
      assert.equal(typeof item.title, "string");
      if (item.episodeTitle !== undefined) assert.equal(typeof item.episodeTitle, "string");
      if (item.seasonTitle !== undefined) assert.equal(typeof item.seasonTitle, "string");
      assert.ok(item.episode && typeof item.episode === "object");
      assert.equal(typeof item.episode.title, "string");
      assert.equal(typeof item.episode.link, "string");
      assert.equal(typeof item.type, "string");
      if (item.poster !== undefined) assert.equal(typeof item.poster, "string");
      if (item.background !== undefined) assert.equal(typeof item.background, "string");
      assert.equal(typeof item.providerValue, "string");
      assert.equal(typeof item.infoUrl, "string");
      assert.equal(typeof item.position, "number");
      assert.ok(Number.isFinite(item.position));
      assert.equal(typeof item.duration, "number");
      assert.ok(Number.isFinite(item.duration));
      assert.equal(typeof item.updatedAt, "number");
      assert.ok(Number.isFinite(item.updatedAt));
    }
  }
  if (progress !== undefined) {
    assert.ok(progress && typeof progress === "object" && !Array.isArray(progress));
    for (const [key, entry] of Object.entries(progress)) {
      assert.equal(typeof key, "string");
      assert.ok(key.length > 0);
      assert.ok(entry && typeof entry === "object" && !Array.isArray(entry));
      assert.equal(typeof entry.position, "number");
      assert.ok(Number.isFinite(entry.position));
      assert.equal(typeof entry.duration, "number");
      assert.ok(Number.isFinite(entry.duration));
    }
  }
  return data;
}

const sampleProvider = {
  value: "vega",
  display_name: "Vega",
  type: "global",
  installed: true,
  disabled: false,
  version: "1.0.0",
  icon: "",
  source: { author: "vega", url: "https://example.com" },
};

beforeEach(() => {
  store.clear();
  contentState.provider = { value: "" };
  contentState.installedProviders = [];
  themeUpdates.length = 0;
  watchListUpdates.length = 0;
  historyUpdates.length = 0;
});

test("exports only selected sections and rejects empty selection", () => {
  assert.throws(
    () =>
      createBackup({
        settings: false,
        library: false,
        providers: false,
        history: false,
        progress: false,
      }),
    /Select at least one/,
  );

  mainStorage.setBool("hapticFeedback", false);
  const partial = parseBackup(
    JSON.stringify(
      createBackup({
        settings: true,
        library: false,
        providers: false,
        history: false,
        progress: false,
      }),
    ),
  );
  assert.equal(partial.version, BACKUP_VERSION);
  assert.equal("settings" in partial, true);
  assert.equal("library" in partial, false);
  assert.equal("providers" in partial, false);
  assert.equal("history" in partial, false);
  assert.equal("progress" in partial, false);
  assert.equal(describeBackupSections(partial), "settings");

  mainStorage.setArray("installedProviders", [sampleProvider]);
  restoreBackup(partial);
  assert.deepEqual(mainStorage.getArray("installedProviders"), [sampleProvider]);
  assert.equal(themeUpdates.length, 1);
});

test("accepts v1 full backups and rejects malformed v2 payloads atomically", () => {
  const v1 = {
    app: "vega",
    version: 1,
    createdAt: "",
    settings: { hapticFeedback: true },
    providers: { installed: [], sources: [], modules: [] },
  };
  assert.equal(parseBackup(JSON.stringify(v1)).version, 1);

  assert.throws(() => parseBackup("not json"), /not a Vega backup/);
  assert.throws(
    () => parseBackup(JSON.stringify({ app: "vega", version: BACKUP_VERSION + 1 })),
    /newer version/,
  );
  assert.throws(
    () => parseBackup(JSON.stringify({ app: "vega", version: BACKUP_VERSION })),
    /incomplete/,
  );
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          app: "vega",
          version: 1,
          createdAt: "",
          settings: { hapticFeedback: true },
        }),
      ),
    /incomplete/,
  );
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          app: "vega",
          version: 2,
          createdAt: "",
          history: [{ id: "bad" }],
        }),
      ),
    /invalid watch history/,
  );
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          app: "vega",
          version: 2,
          createdAt: "",
          progress: { ep1: { position: "x", duration: 100 } },
        }),
      ),
    /invalid watch progress/,
  );

  assert.throws(() =>
    restoreBackup({
      app: "vega",
      version: 2,
      createdAt: "",
      settings: { hapticFeedback: true },
      progress: { ep1: { position: Number.NaN, duration: 100 } },
    }),
  );
  assert.equal(mainStorage.contains("hapticFeedback"), false);
});

test("Mobile -> Desktop import restores mobile v2 backups cleanly", () => {
  const mobileBackup = {
    app: "vega",
    version: 2,
    createdAt: "2026-11-22T00:00:00.000Z",
    library: {
      items: [
        {
          title: "Andor",
          poster: "https://img.example/andor.jpg",
          link: "https://provider.example/andor",
          provider: "vega",
          collections: ["watchlist"],
        },
      ],
      collections: [
        {
          id: "watchlist",
          name: "Watchlist",
          icon: "bookmark",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    },
    settings: {
      primaryColor: "#FF5500",
      isCustomTheme: true,
      dynamicInfoAccent: false,
      launcherIcon: "ignored",
      alwaysCastMode: true,
    },
    providers: {
      installed: [sampleProvider],
      sources: [{ author: "vega", url: "https://example.com" }],
      modules: [
        {
          value: "vega",
          version: "1.0.0",
          modules: { posts: "exports.getPosts=[]" },
          cachedAt: 10,
        },
      ],
    },
    history: [
      {
        id: "https://provider.example/andor",
        title: "Andor",
        episodeTitle: "Episode 3",
        seasonTitle: "Season 1",
        episode: {
          title: "Episode 3",
          link: "https://provider.example/andor/ep3",
          sourceLink: "https://provider.example/andor/ep3",
        },
        type: "series",
        poster: "https://img.example/andor.jpg",
        providerValue: "vega",
        infoUrl: "https://provider.example/andor",
        position: 420,
        duration: 2400,
        updatedAt: 5000,
      },
    ],
    progress: {
      "https://provider.example/andor/ep3": { position: 420, duration: 2400 },
      "https://provider.example/andor/ep2": { position: 2400, duration: 2400 },
    },
  };

  const parsed = parseBackup(JSON.stringify(mobileBackup));
  assert.equal(
    describeBackupSections(parsed),
    "settings, library, providers, watch history, watch progress",
  );
  restoreBackup(parsed);

  assert.equal(mainStorage.getString("primaryColor"), "#FF5500");
  assert.equal(mainStorage.getBool("isCustomTheme"), true);
  assert.equal(mainStorage.getBool("infoPageDynamicTheme"), false);
  assert.equal(mainStorage.contains("alwaysCastMode"), false);

  const history = watchHistoryStorage.getWatchHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].link, "https://provider.example/andor");
  assert.equal(history[0].provider, "vega");
  assert.equal(history[0].progress, 420);
  assert.equal(history[0].duration, 2400);
  assert.equal(history[0].timestamp, 5000);
  assert.equal(historyUpdates.length, 1);
  assert.deepEqual(JSON.parse(cacheStorage.getString("https://provider.example/andor/ep3")), {
    position: 420,
    duration: 2400,
  });
  assert.deepEqual(JSON.parse(cacheStorage.getString("https://provider.example/andor/ep2")), {
    position: 2400,
    duration: 2400,
  });
});

test("Desktop -> Mobile export passes mobile validation and filters device-local entries", () => {
  mainStorage.setBool("infoPageDynamicTheme", true);
  mainStorage.setNumber("uiScale", 110);
  mainStorage.setArray("installedProviders", [sampleProvider]);
  mainStorage.setArray("providerSources", [{ author: "vega", url: "https://example.com" }]);
  mainStorage.setArray("providerModules", []);

  watchHistoryStorage.addToWatchHistory({
    id: "C:\\Downloads\\Andor_E01.mkv",
    title: "Andor",
    link: "https://provider.example/andor",
    provider: "vega",
    timestamp: 2000,
    progress: 300,
    duration: 1800,
    episodeTitle: "Episode 1",
    seasonTitle: "Season 1",
    isSeries: true,
    poster: undefined,
    episode: {
      title: "Episode 1",
      link: "C:\\Downloads\\Andor_E01.mkv",
      sourceLink: "https://provider.example/andor/ep1",
    },
  });
  watchHistoryStorage.addToWatchHistory({
    id: "local-1",
    title: "Local Film",
    link: "local://film",
    provider: "local",
    timestamp: 3000,
    progress: 50,
    duration: 1000,
  });
  watchHistoryStorage.addToWatchHistory({
    id: "marked-watched",
    title: "Marked Show",
    link: "https://provider.example/marked",
    provider: "vega",
    timestamp: 4000,
    progress: 1,
    duration: 1,
  });

  cacheStorage.setString("https://provider.example/andor/ep1", JSON.stringify({ position: 310, duration: 1800 }));
  cacheStorage.setString("C:\\Downloads\\Andor_E01.mkv", JSON.stringify({ position: 310, duration: 1800 }));
  cacheStorage.setString("/tmp/movie.mkv", JSON.stringify({ position: 10, duration: 100 }));
  cacheStorage.setString("file:///storage/emulated/0/x.mp4", JSON.stringify({ position: 10, duration: 100 }));
  cacheStorage.setString("unrelated-cache-key", JSON.stringify({ title: "Cached Info" }));

  const serialized = JSON.stringify(createBackup());
  const mobileValidated = assertValidMobileBackup(serialized);

  assert.equal(mobileValidated.settings.infoPageDynamicTheme, true);
  assert.equal(mobileValidated.settings.dynamicInfoAccent, true);
  assert.equal(mobileValidated.settings.uiScale, 110);
  assert.equal(mobileValidated.history.length, 1);
  assert.equal(mobileValidated.history[0].id, "https://provider.example/andor");
  assert.equal(mobileValidated.history[0].episode.link, "https://provider.example/andor/ep1");
  assert.equal(mobileValidated.history[0].providerValue, "vega");
  assert.equal("poster" in mobileValidated.history[0], false);
  assert.deepEqual(mobileValidated.progress, {
    "https://provider.example/andor/ep1": { position: 310, duration: 1800 },
  });
});

test("merges history by keeping newer entries and progress by keeping higher watched ratio", () => {
  watchHistoryStorage.addToWatchHistory({
    id: "ep-a",
    title: "Show A",
    link: "https://example.com/a",
    provider: "demo",
    timestamp: 500,
    progress: 50,
    duration: 1000,
  });
  watchHistoryStorage.addToWatchHistory({
    id: "ep-b",
    title: "Show B",
    link: "https://example.com/b",
    provider: "demo",
    timestamp: 100,
    progress: 10,
    duration: 1000,
  });
  cacheStorage.setString("kept", JSON.stringify({ position: 900, duration: 1000 }));
  cacheStorage.setString("raised", JSON.stringify({ position: 100, duration: 1000 }));

  restoreBackup({
    app: "vega",
    version: 2,
    createdAt: "",
    history: [
      {
        id: "https://example.com/a",
        title: "Show A",
        episode: { id: "ep-a", title: "Ep 1", link: "ep-a" },
        type: "series",
        providerValue: "demo",
        infoUrl: "https://example.com/a",
        position: 20,
        duration: 1000,
        updatedAt: 200,
      },
      {
        id: "https://example.com/b",
        title: "Show B",
        episode: { id: "ep-b", title: "Ep 1", link: "ep-b" },
        type: "series",
        providerValue: "demo",
        infoUrl: "https://example.com/b",
        position: 800,
        duration: 1000,
        updatedAt: 900,
      },
    ],
    progress: {
      kept: { position: 100, duration: 1000 },
      raised: { position: 950, duration: 1000 },
      added: { position: 50, duration: 100 },
    },
  });

  const history = watchHistoryStorage.getWatchHistory();
  assert.deepEqual(
    history.map((item) => [item.id, item.timestamp]),
    [
      ["ep-b", 900],
      ["ep-a", 500],
    ],
  );
  assert.deepEqual(JSON.parse(cacheStorage.getString("kept")), { position: 900, duration: 1000 });
  assert.deepEqual(JSON.parse(cacheStorage.getString("raised")), { position: 950, duration: 1000 });
  assert.deepEqual(JSON.parse(cacheStorage.getString("added")), { position: 50, duration: 100 });
});
