import {getCurrent, onOpenUrl} from '@tauri-apps/plugin-deep-link';

// Two ways in, same payload:
// - Android: intent vega.intent.action.ADD_SOURCE with a "url" extra and an
//   optional "token" extra (GitHub token for a private repo). MainActivity.kt
//   exposes it through window.VegaSourceIntent and fires "vega-add-source"
//   when a new intent arrives while the app is open.
// - Windows, macOS, Linux: vega://add-source?url=<source>&token=<token>
//   through the deep-link plugin. A second launch hands the link to the
//   running app (single-instance plugin).

declare global {
  interface Window {
    VegaSourceIntent?: {take(): string | null};
  }
}

export interface SourceIntentPayload {
  url: string;
  token?: string;
}

export const takeSourceIntent = (): SourceIntentPayload | null => {
  try {
    const raw = window.VegaSourceIntent?.take();
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as Partial<SourceIntentPayload>;
    if (typeof payload.url !== 'string' || !payload.url) {
      return null;
    }
    return {
      url: payload.url,
      token: typeof payload.token === 'string' ? payload.token : undefined,
    };
  } catch {
    return null;
  }
};

const isAndroid = () =>
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes('android');

const MAX_URL_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 255;

export const parseSourceLink = (link: string): SourceIntentPayload | null => {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  // Windows may add a trailing slash: vega://add-source/?url=...
  const target = (parsed.host + parsed.pathname).replace(/\/+$/, '');
  if (parsed.protocol !== 'vega:' || target !== 'add-source') {
    return null;
  }
  const url = parsed.searchParams.get('url')?.trim();
  const token = parsed.searchParams.get('token')?.trim();
  if (!url || url.length > MAX_URL_LENGTH) {
    return null;
  }
  return {
    url,
    token: token && token.length <= MAX_TOKEN_LENGTH ? token : undefined,
  };
};

// getCurrent() keeps returning the launch link, so read it once per session.
let launchLinkChecked = false;

export const subscribeSourceIntent = (
  listener: (payload: SourceIntentPayload) => void,
): (() => void) => {
  if (isAndroid()) {
    const handleIntent = () => {
      const payload = takeSourceIntent();
      if (payload) {
        listener(payload);
      }
    };
    window.addEventListener('vega-add-source', handleIntent);
    // Launch intent, waiting before the page loaded.
    handleIntent();
    return () => window.removeEventListener('vega-add-source', handleIntent);
  }

  let disposed = false;
  let unlisten: (() => void) | undefined;
  const deliver = (links: string[] | null) => {
    for (const link of links ?? []) {
      const payload = parseSourceLink(link);
      if (payload) {
        listener(payload);
      }
    }
  };

  if (!launchLinkChecked) {
    launchLinkChecked = true;
    // Deliver even if this subscription was already disposed: the launch
    // link is read only once, so dropping it here would lose it.
    getCurrent().then(deliver).catch(() => {});
  }
  onOpenUrl((links) => {
    if (!disposed) {
      deliver(links);
    }
  })
    .then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    })
    .catch(() => {});

  return () => {
    disposed = true;
    unlisten?.();
  };
};

// The token goes from the intent to the add source dialog through this
// in-memory slot, not through router state, so it never lands in history.
let pendingToken: {requestId: number; token: string} | undefined;

export const setPendingSourceToken = (
  requestId: number,
  token: string | undefined,
): void => {
  pendingToken = token ? {requestId, token} : undefined;
};

export const getPendingSourceToken = (
  requestId: number | undefined,
): string | undefined =>
  pendingToken && pendingToken.requestId === requestId
    ? pendingToken.token
    : undefined;

export const clearPendingSourceToken = (): void => {
  pendingToken = undefined;
};
