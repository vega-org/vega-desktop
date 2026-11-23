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
  if (relative.endsWith("/appUpdater.ts")) {
    js = js.replaceAll("import.meta.env", "globalThis.__vegaUpdaterTest.env");
  }
  return moduleUrl(js);
}

const storeMap = new Map();
globalThis.localStorage = {
  get length() {
    return storeMap.size;
  },
  key: (index) => Array.from(storeMap.keys())[index] ?? null,
  getItem: (key) => (storeMap.has(key) ? storeMap.get(key) : null),
  setItem: (key, value) => storeMap.set(key, String(value)),
  removeItem: (key) => storeMap.delete(key),
  clear: () => storeMap.clear(),
};

globalThis.window = {
  __TAURI_INTERNALS__: {},
  dispatchEvent: () => true,
  open: (url) => {
    windowOpenedUrls.push(url);
  },
};
if (typeof globalThis.Event === "undefined") {
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
}
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  configurable: true,
});

const windowOpenedUrls = [];
const openedUrls = [];
const invokes = [];
const toasts = [];
let mockAppVersion = "2.3.0";
let mockUpdaterCheck = async () => null;
let mockInvokeHandler = async (cmd) => {
  invokes.push(cmd);
};

globalThis.__vegaUpdaterTest = {
  getAppVersion: async () => mockAppVersion,
  invoke: async (cmd, args) => mockInvokeHandler(cmd, args),
  check: async () => mockUpdaterCheck(),
  openUrl: async (url) => {
    openedUrls.push(url);
  },
  pushToast: (t) => {
    toasts.push(t);
  },
};

const zustandUrl = import.meta.resolve("zustand");
const storageUrl = await compileModule("../src/platform/storage.ts");
const storageFacadeUrl = moduleUrl(`export * from ${JSON.stringify(storageUrl)};`);
const hostMockUrl = moduleUrl(`
  export const isTauriRuntime = () => !globalThis.__vegaUpdaterTest.env?.VITE_TV_HOST;
`);
const deviceLayoutMockUrl = moduleUrl(`
  export const isTelevisionDevice = () => false;
`);
const tauriAppMockUrl = moduleUrl(`
  export const getVersion = (...args) => globalThis.__vegaUpdaterTest.getAppVersion(...args);
`);
const tauriCoreMockUrl = moduleUrl(`
  export const invoke = (...args) => globalThis.__vegaUpdaterTest.invoke(...args);
`);
const tauriUpdaterMockUrl = moduleUrl(`
  export const check = (...args) => globalThis.__vegaUpdaterTest.check(...args);
`);
const tauriOpenerMockUrl = moduleUrl(`
  export const openUrl = (...args) => globalThis.__vegaUpdaterTest.openUrl(...args);
`);
const toastMockUrl = moduleUrl(`
  export const toast = (input) => globalThis.__vegaUpdaterTest.pushToast(input);
`);

const settingsStorageUrl = await compileModule(
  "../src/lib/storage/SettingsStorage.ts",
  {
    "@tauri-apps/api/core": tauriCoreMockUrl,
    "../../platform/host": hostMockUrl,
    "../../platform/deviceLayout": deviceLayoutMockUrl,
    "./StorageService": storageFacadeUrl,
  },
);
const storageIndexMockUrl = moduleUrl(`
  export { mainStorage, cacheStorage } from ${JSON.stringify(storageUrl)};
  export { settingsStorage } from ${JSON.stringify(settingsStorageUrl)};
`);

const releaseNotesUrl = await compileModule("../src/lib/updater/releaseNotes.ts");
const appUpdateStoreUrl = await compileModule(
  "../src/lib/zustand/appUpdateStore.ts",
  { zustand: zustandUrl },
);
const appUpdaterUrl = await compileModule("../src/lib/updater/appUpdater.ts", {
  "@tauri-apps/api/app": tauriAppMockUrl,
  "@tauri-apps/api/core": tauriCoreMockUrl,
  "@tauri-apps/plugin-updater": tauriUpdaterMockUrl,
  "@tauri-apps/plugin-opener": tauriOpenerMockUrl,
  "../../platform/host": hostMockUrl,
  "../storage": storageIndexMockUrl,
  "../zustand/appUpdateStore": appUpdateStoreUrl,
  "../zustand/toastStore": toastMockUrl,
  "./releaseNotes": releaseNotesUrl,
});

const { settingsStorage } = await import(settingsStorageUrl);
const {
  formatBytes,
  formatReleaseNotes,
  formatVersionLabel,
  fetchGitHubReleaseInfo,
  isNewerVersion,
  parseInlineMarkdown,
  parseMarkdownBlocks,
} = await import(releaseNotesUrl);
const { useAppUpdateStore } = await import(appUpdateStoreUrl);
const {
  cancelOrDismissAppUpdate,
  checkAppUpdates,
  openExternalUrl,
  resetAppUpdaterForTest,
  restartAfterUpdate,
  retryAppUpdate,
  startAppUpdate,
} = await import(appUpdaterUrl);

beforeEach(async () => {
  storeMap.clear();
  windowOpenedUrls.length = 0;
  openedUrls.length = 0;
  invokes.length = 0;
  toasts.length = 0;
  mockAppVersion = "2.3.0";
  mockUpdaterCheck = async () => null;
  mockInvokeHandler = async (cmd) => {
    invokes.push(cmd);
  };
  await resetAppUpdaterForTest();
});

test("SettingsStorage defaults both auto-check and auto-download updates to true", () => {
  assert.equal(settingsStorage.isAutoCheckUpdateEnabled(), true);
  assert.equal(settingsStorage.isAutoDownloadEnabled(), true);

  settingsStorage.setAutoCheckUpdateEnabled(false);
  settingsStorage.setAutoDownloadEnabled(false);
  assert.equal(settingsStorage.isAutoCheckUpdateEnabled(), false);
  assert.equal(settingsStorage.isAutoDownloadEnabled(), false);
});

test("version comparison and byte formatting helpers handle prefixes cleanly", () => {
  assert.equal(formatVersionLabel("app-v2.4.0"), "v2.4.0");
  assert.equal(formatVersionLabel("2.4.0"), "v2.4.0");
  assert.equal(isNewerVersion("app-v2.4.0", "2.3.0"), true);
  assert.equal(isNewerVersion("2.3.0", "2.3.0"), false);
  assert.equal(isNewerVersion("2.2.9", "2.3.0"), false);
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024 * 42), "42 KB");
  assert.equal(formatBytes(1024 * 1024 * 12.5), "12.5 MB");
});

test("formatReleaseNotes removes CI placeholders and Downloads tables while keeping changelog notes", () => {
  assert.equal(formatReleaseNotes("Automated release of Vega."), "");
  assert.equal(formatReleaseNotes("  automated release of vega  "), "");

  const rawBody = [
    "- Web app https://web.vega-app.in",
    "- New player engine libmedia",
    "",
    "### Vega v2.3.0 â€” Downloads",
    "",
    "| Platform | Architecture | Download |",
    "| --- | --- | --- |",
    "| Windows | x64 | [EXE installer](https://example.com/setup.exe) |",
    "",
    "**Full Changelog**: [app-v2.2.0...app-v2.3.0](https://github.com/vega-org/vega-desktop/compare/app-v2.2.0...app-v2.3.0)",
  ].join("\n");

  const formatted = formatReleaseNotes(rawBody);
  assert.equal(formatted.includes("### Vega v2.3.0 â€” Downloads"), false);
  assert.equal(formatted.includes("| Windows |"), false);
  assert.equal(formatted.includes("- New player engine libmedia"), true);
  assert.equal(formatted.includes("**Full Changelog**"), true);
});

test("markdown parser handles headings, lists, inline styles, safe links, and blocks unsafe URLs", () => {
  const blocks = parseMarkdownBlocks(
    [
      "## What's Changed",
      "- Added **Auto Update** with `progress` bar and *markdown*",
      "1. Visit https://web.vega-app.in.",
      "Click [unsafe](javascript:alert(1)) or [release](https://github.com/vega-org/vega-desktop)",
    ].join("\n"),
  );

  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].type, "unordered-list");
  assert.equal(blocks[1].items.length, 1);
  assert.equal(blocks[2].type, "ordered-list");
  const autolinkItem = blocks[2].items[0];
  assert.equal(
    autolinkItem.some(
      (token) =>
        token.type === "link" && token.href === "https://web.vega-app.in",
    ),
    true,
  );

  const inlineLinks = parseInlineMarkdown(
    "[bad](javascript:alert(1)) and [good](https://example.com)",
  );
  assert.equal(
    inlineLinks.some((token) => token.type === "link" && token.href.startsWith("javascript:")),
    false,
  );
  assert.equal(
    inlineLinks.some((token) => token.type === "link" && token.href === "https://example.com"),
    true,
  );
});

test("fetchGitHubReleaseInfo prefers GitHub release body and falls back safely on 404 or rate limits", async () => {
  const realFetchResult = await fetchGitHubReleaseInfo(
    "2.4.0",
    "Automated release of Vega.",
    async (url) => {
      assert.ok(String(url).endsWith("/tags/app-v2.4.0"));
      return new Response(
        JSON.stringify({
          tag_name: "app-v2.4.0",
          html_url: "https://github.com/vega-org/vega-desktop/releases/tag/app-v2.4.0",
          body: "- Improved backup compatibility\n- Better desktop updater UI",
        }),
        { status: 200 },
      );
    },
  );
  assert.equal(
    realFetchResult.notes,
    "- Improved backup compatibility\n- Better desktop updater UI",
  );

  const fallback404Result = await fetchGitHubReleaseInfo(
    "2.4.0",
    "Automated release of Vega.",
    async (url) => {
      if (String(url).includes("/tags/")) {
        return new Response("", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          tag_name: "app-v2.4.0",
          html_url: "https://github.com/vega-org/vega-desktop/releases/tag/app-v2.4.0",
          body: "- Latest release notes",
        }),
        { status: 200 },
      );
    },
  );
  assert.equal(fallback404Result.notes, "- Latest release notes");

  const rateLimitedResult = await fetchGitHubReleaseInfo(
    "2.4.0",
    "- Bundled manifest notes",
    async () => new Response("rate limit", { status: 403 }),
  );
  assert.equal(rateLimitedResult.notes, "- Bundled manifest notes");
  assert.equal(
    rateLimitedResult.releaseUrl,
    "https://github.com/vega-org/vega-desktop/releases/tag/app-v2.4.0",
  );
});

test("appUpdater transitions from What's New dialog to download progress, install, and restart", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        tag_name: "app-v2.4.0",
        html_url: "https://github.com/vega-org/vega-desktop/releases/tag/app-v2.4.0",
        body: "- Added proper What's New dialog\n- Progress bar during update",
      }),
      { status: 200 },
    );

  const observedStages = [];
  const unsubscribe = useAppUpdateStore.subscribe((state) => {
    if (observedStages[observedStages.length - 1] !== state.stage) {
      observedStages.push(state.stage);
    }
  });

  let downloadCalls = 0;
  let installCalls = 0;
  let closeCalls = 0;
  let restartRejectedOnce = true;

  mockInvokeHandler = async (cmd) => {
    invokes.push(cmd);
    if (cmd === "restart_app" && restartRejectedOnce) {
      restartRejectedOnce = false;
      throw new Error("Simulated manual restart fallback");
    }
  };

  mockUpdaterCheck = async () => ({
    currentVersion: "2.3.0",
    version: "2.4.0",
    body: "Automated release of Vega.",
    download: async (onEvent) => {
      downloadCalls++;
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      assert.equal(useAppUpdateStore.getState().progress.percent, 40);
      onEvent({ event: "Progress", data: { chunkLength: 600 } });
      onEvent({ event: "Finished" });
      assert.equal(useAppUpdateStore.getState().progress.percent, 100);
    },
    install: async () => {
      installCalls++;
      assert.equal(useAppUpdateStore.getState().stage, "installing");
    },
    close: async () => {
      closeCalls++;
    },
  });

  try {
    await checkAppUpdates(false, { restoreFocusKey: "SETTINGS_CHECK_UPDATES" });
    const afterCheck = useAppUpdateStore.getState();
    assert.equal(afterCheck.stage, "available");
    assert.equal(afterCheck.currentVersion, "2.3.0");
    assert.equal(afterCheck.targetVersion, "2.4.0");
    assert.equal(
      afterCheck.releaseNotes,
      "- Added proper What's New dialog\n- Progress bar during update",
    );

    await startAppUpdate();
    assert.equal(downloadCalls, 1);
    assert.equal(installCalls, 1);
    assert.equal(closeCalls, 0);
    assert.deepEqual(invokes, ["restart_app"]);
    assert.equal(useAppUpdateStore.getState().stage, "installed");
    assert.deepEqual(observedStages, [
      "idle",
      "available",
      "downloading",
      "installing",
      "installed",
    ]);

    await restartAfterUpdate();
    assert.deepEqual(invokes, ["restart_app", "restart_app"]);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test("appUpdater opens release page when auto-download is turned off and handles cancel during download", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 403 });

  let installCalls = 0;
  let closeCalls = 0;
  let releaseDownload;
  const downloadWait = new Promise((resolve) => {
    releaseDownload = resolve;
  });

  mockUpdaterCheck = async () => ({
    currentVersion: "2.3.0",
    version: "2.4.0",
    body: "- Release notes fallback",
    download: async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      await downloadWait;
    },
    install: async () => {
      installCalls++;
    },
    close: async () => {
      closeCalls++;
    },
  });

  try {
    settingsStorage.setAutoDownloadEnabled(false);
    await checkAppUpdates(false);
    assert.equal(useAppUpdateStore.getState().stage, "available");

    await startAppUpdate();
    assert.deepEqual(openedUrls, [
      "https://github.com/vega-org/vega-desktop/releases/tag/app-v2.4.0",
    ]);
    assert.equal(closeCalls, 1);
    assert.equal(useAppUpdateStore.getState().stage, "idle");

    settingsStorage.setAutoDownloadEnabled(true);
    await checkAppUpdates(false);
    const activeDownload = startAppUpdate();
    assert.equal(useAppUpdateStore.getState().stage, "downloading");
    cancelOrDismissAppUpdate();
    assert.equal(useAppUpdateStore.getState().stage, "idle");

    releaseDownload();
    await activeDownload;
    assert.equal(installCalls, 0);
    assert.equal(closeCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("appUpdater supports retry after download failure and shows toast on up-to-date manual check", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 403 });

  let shouldFail = true;
  let installCalls = 0;
  mockUpdaterCheck = async () => ({
    currentVersion: "2.3.0",
    version: "2.4.0",
    body: "- Bug fixes",
    download: async (onEvent) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Connection reset during update download");
      }
      onEvent({ event: "Started", data: { contentLength: 500 } });
      onEvent({ event: "Progress", data: { chunkLength: 500 } });
      onEvent({ event: "Finished" });
    },
    install: async () => {
      installCalls++;
    },
    close: async () => {},
  });

  try {
    await checkAppUpdates(true);
    await startAppUpdate();
    assert.equal(useAppUpdateStore.getState().stage, "error");
    assert.match(useAppUpdateStore.getState().errorMessage, /Connection reset/);

    await retryAppUpdate();
    assert.equal(installCalls, 1);
    assert.equal(useAppUpdateStore.getState().stage, "installed");

    cancelOrDismissAppUpdate();
    mockUpdaterCheck = async () => null;
    await checkAppUpdates(true);
    assert.equal(useAppUpdateStore.getState().stage, "idle");
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].title, "Up to Date");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webOS shows a newer release and opens it in the TV browser", async () => {
  const releaseUrl = "https://github.com/vega-org/vega-desktop/releases/tag/v2.4.0";
  const originalFetch = globalThis.fetch;
  const launches = [];
  globalThis.__vegaUpdaterTest.env = { VITE_TV_HOST: "webos", VITE_APP_VERSION: "2.3.0" };
  globalThis.fetch = async () => Response.json({ tag_name: "v2.4.0", html_url: releaseUrl });
  globalThis.window.PalmServiceBridge = class {
    call(uri, params) {
      launches.push([uri, JSON.parse(params)]);
      this.onservicecallback('{"returnValue":true}');
    }
  };
  try {
    await checkAppUpdates(true);
    const update = useAppUpdateStore.getState();
    assert.equal(update.stage, "available");
    assert.equal(update.currentVersion, "2.3.0");
    assert.equal(update.canAutoDownload, false);
    await startAppUpdate();
    assert.deepEqual(launches, [[
      "luna://com.webos.applicationManager/launch",
      { id: "com.webos.app.browser", params: { target: releaseUrl } },
    ]]);
    assert.deepEqual(invokes, []);

    const assigned = [];
    globalThis.window.location = { assign: (u) => assigned.push(u) };
    globalThis.window.PalmServiceBridge = class {
      call() {
        this.onservicecallback('{"returnValue":false}');
      }
    };
    await openExternalUrl(releaseUrl);
    assert.deepEqual(assigned, [releaseUrl]);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__vegaUpdaterTest.env;
    delete globalThis.window.PalmServiceBridge;
    delete globalThis.window.location;
  }
});
