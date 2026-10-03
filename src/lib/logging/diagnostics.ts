/**
 * What this WebView can decode and render, for bug reports. A black player
 * usually means the WebView claimed a codec it cannot actually play, so the
 * claims themselves are worth logging.
 */

const CODECS: Array<[label: string, mime: string]> = [
  ["H.264", 'video/mp4; codecs="avc1.640028"'],
  ["H.264 High 10", 'video/mp4; codecs="avc1.6e0028"'],
  ["HEVC hvc1", 'video/mp4; codecs="hvc1.1.6.L120.90"'],
  ["HEVC hev1", 'video/mp4; codecs="hev1.1.6.L120.90"'],
  ["HEVC Main10", 'video/mp4; codecs="hvc1.2.4.L150.90"'],
  ["AV1", 'video/mp4; codecs="av01.0.08M.08"'],
  ["VP9", 'video/webm; codecs="vp9"'],
  ["AAC", 'audio/mp4; codecs="mp4a.40.2"'],
  ["AC-3", 'audio/mp4; codecs="ac-3"'],
  ["E-AC-3", 'audio/mp4; codecs="ec-3"'],
  ["Opus", 'audio/webm; codecs="opus"'],
  ["FLAC", 'audio/mp4; codecs="flac"'],
];

function gpuInfo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | null;
    if (!gl) return "no WebGL";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const vendor = ext
      ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return `${vendor} / ${renderer}`;
  } catch (error) {
    return `unavailable (${String(error)})`;
  }
}

function codecSupport(): string {
  const video = document.createElement("video");
  const mse = typeof MediaSource !== "undefined";
  const rows = CODECS.map(([label, mime]) => {
    const direct = video.canPlayType(mime) || "no";
    const viaMse = mse ? (MediaSource.isTypeSupported(mime) ? "yes" : "no") : "n/a";
    return `${label}: play=${direct} mse=${viaMse}`;
  });
  return `MediaSource ${mse ? "available" : "missing"}\n${rows.join("\n")}`;
}

/** Multi-line report: GPU, screen, hardware and codec support. */
export function frontendDiagnostics(): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    `User agent ${navigator.userAgent}`,
    `GPU ${gpuInfo()}`,
    `Screen ${screen.width}x${screen.height} @${window.devicePixelRatio}x, window ${window.innerWidth}x${window.innerHeight}`,
    `CPU cores ${navigator.hardwareConcurrency || "?"}, memory ${nav.deviceMemory ?? "?"} GB`,
    codecSupport(),
  ].join("\n");
}
