import type { StreamDrm } from "../providers/types";
import { publicHttpUrl } from "../../platform/publicNetworkPolicy";

const keySystems = {
  clearkey: "org.w3.clearkey",
  widevine: "com.widevine.alpha",
  playready: "com.microsoft.playready",
  fairplay: "com.apple.fps",
};

export async function createDrmPlayer(
  drm: StreamDrm,
  source: string,
  headers: Record<string, string>,
) {
  if (!Object.prototype.hasOwnProperty.call(keySystems, drm.type)) throw new Error("Unsupported DRM type.");
  const keySystem = keySystems[drm.type];
  const sourceOrigin = publicHttpUrl(source).origin;
  const license = drm.licenseServer ? publicHttpUrl(drm.licenseServer) : undefined;
  const clearKeys = drm.clearKeys;
  if (clearKeys !== undefined) {
    const entries = Object.entries(clearKeys);
    if (drm.type !== "clearkey" || license || !entries.length ||
      entries.some(([id, key]) => !/^[0-9a-f]{32}$/i.test(id) ||
        typeof key !== "string" || !/^[0-9a-f]{32}$/i.test(key))) {
      throw new Error("Invalid inline ClearKey configuration.");
    }
  } else if (!license) {
    throw new Error("DRM requires a license server or inline ClearKey keys.");
  }

  const certificate = drm.certificateUrl ? publicHttpUrl(drm.certificateUrl).href : undefined;
  const contentId = drm.contentId;
  const amazonWidevine = import.meta.env.VITE_TV_HOST === "amazon-vega" && drm.type === "widevine";

  const { default: shaka } = await import("shaka-player");
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported() || !navigator.requestMediaKeySystemAccess) {
    throw new Error("Protected playback is unavailable in this WebView.");
  }
  const player = new shaka.Player();
  player.configure({
    drm: {
      preferredKeySystems: [keySystem],
      servers: license ? { [keySystem]: license.href } : {},
      clearKeys: clearKeys ?? {},
      advanced: {
        [keySystem]: {
          ...(certificate && { serverCertificateUri: certificate }),
          ...(amazonWidevine && {
            audioRobustness: ["SW_SECURE_CRYPTO"],
            videoRobustness: ["HW_SECURE_ALL", "SW_SECURE_CRYPTO"],
          }),
        },
      },
      ...(drm.type === "fairplay" && contentId && {
        initDataTransform: (data: Uint8Array, type: string, info: { serverCertificate: Uint8Array | null } | null) => type === "skd"
          ? shaka.drm.FairPlay.initDataTransform(data, contentId, info?.serverCertificate ?? null)
          : data,
      }),
    },
  });
  const requestTypes = shaka.net.NetworkingEngine.RequestType;
  player.getNetworkingEngine()?.registerRequestFilter((type, request) => {
    if (type === requestTypes.LICENSE && clearKeys) return;
    const destinations = request.uris.map(publicHttpUrl);
    if (type === requestTypes.LICENSE) {
      if (!license || destinations.some((url) => url.origin !== license.origin)) {
        throw new Error("Unexpected DRM license destination.");
      }
      Object.assign(request.headers, drm.headers);
    }
    if ((type === requestTypes.MANIFEST || type === requestTypes.SEGMENT) &&
        destinations.every((url) => url.origin === sourceOrigin)) {
      Object.assign(request.headers, headers);
    }
  });
  if (drm.base64Certificate) {
    player.getNetworkingEngine()?.registerResponseFilter((type, response) => {
      if (type !== requestTypes.SERVER_CERTIFICATE) return;
      const encoded = new TextDecoder().decode(response.data);
      response.data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    });
  }
  return player;
}
