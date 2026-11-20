import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../src/lib/player/HtmlVideoEngine.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const hlsModule = {exports: {}};
const hlsSourceCode = ts.transpileModule(readFileSync(new URL("../../src/lib/player/hlsSource.ts", import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText;
runInNewContext(hlsSourceCode, {module: hlsModule, exports: hlsModule.exports});

function fixture(userAgent = "", supportsHls = false, createDrmPlayer) {
  let probe = {
    duration: 120, format_name: "mov,mp4",
    video_tracks: [{ index: 0, codec_name: "h264", width: 1920, height: 1080 }],
    audio_tracks: [
      { index: 1, codec_name: "aac", language: "eng", title: "English", is_default: false },
      { index: 3, codec_name: "aac", language: "fra", title: "French", is_default: true },
    ],
    subtitle_tracks: [], chapters: [],
  };
  const module = { exports: {} };
  const mocks = {
    "@tauri-apps/api/core": { invoke: async (name) => name === "probe_media_info" ? probe : undefined },
    "hls.js": { __esModule: true, default: { isSupported: () => supportsHls } },
    "./hlsSource": hlsModule.exports,
    "./drmPlayback": { createDrmPlayer },
    "./jassubManager": { JassubManager: class {} },
    "./deviceProfile": { isLowEndDevice: () => false },
    "./mseCodec": { modernMseMime: () => null },
    "./mseBufferPump": {},
    "../services/torrentStreamService": {
      isTorrentUrl: () => false, getInfoHashFromStreamUrl: () => null,
    },
  };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    AbortController, setTimeout, clearTimeout,
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent },
    window: { MediaSource: {} }, MediaSource: { isTypeSupported: () => true },
    document: { createElement: () => ({ canPlayType: () => "probably" }) },
  });
  const Engine = module.exports.HtmlVideoEngine;
  // Keep the real load, metadata listener and track-selection behavior. Only
  // replace platform I/O, subtitle rendering and stream transport.
  Engine.prototype.setupSubtitleListener = () => {};
  Engine.prototype.setupStreamInfoListener = () => {};
  Engine.prototype.cleanupMse = () => {};
  Engine.prototype.queueSubtitleRender = async () => {};
  const events = new Map();
  const video = {
    paused: true, duration: 120, videoHeight: 1080, videoWidth: 1920,
    currentTime: 0, playbackRate: 1,
    audioTracks: [{ label: "Decoded audio", language: "", enabled: true }],
    addEventListener: (name, handler) => events.set(name, handler),
    pause() {}, removeAttribute() {}, load() {}, play: async () => {},
  };
  const engine = new Engine(video);
  engine.jassub = null;
  const starts = [];
  const hlsStarts = [];
  engine.startStream = async (time, resume) => starts.push({ time, resume, audio: engine.selectedAudioIndex });
  engine.startHlsStream = async (source, options) => hlsStarts.push({source, options});
  return { engine, video, starts, hlsStarts, metadata: () => events.get("loadedmetadata")(), setProbe: (value) => { probe = value; } };
}

test("protected streams use the DRM player and release it when switching to clear video", async () => {
  const source = "https://media.example.com/signed";
  const drm = { type: "clearkey", clearKeys: {} };
  const headers = { Authorization: "Bearer media" };
  const calls = [];
  const player = {
    addEventListener() {},
    attach: async (video) => calls.push(["attach", video]),
    load: async (...args) => calls.push(["load", ...args]),
    destroy: async () => calls.push(["destroy"]),
  };
  const { engine, video, starts, hlsStarts } = fixture("", true, async (...args) => {
    calls.push(["create", ...args]);
    return player;
  });

  await engine.load(source, { drm, headers, streamType: "dash", startTime: 12, autoPlay: false });
  assert.deepEqual(calls, [
    ["create", drm, source, headers],
    ["attach", video],
    ["load", source, 12, "application/dash+xml"],
  ]);
  assert.equal(starts.length, 0);
  assert.equal(hlsStarts.length, 0);
  await engine.load("https://media.example.com/clear.m3u8", { autoPlay: false });
  assert.deepEqual(calls.at(-1), ["destroy"]);
  assert.equal(hlsStarts.length, 1);
});

test("provider-declared HLS with an opaque URL goes straight to HLS even when probing would fail", async () => {
  for (const streamType of ["m3u8", "hls", "HLS", "application/vnd.apple.mpegurl"]) {
    const {engine, starts, hlsStarts, setProbe} = fixture("", true);
    setProbe(null);
    const source = "https://worker.test/playlist/signed-token";
    await engine.load(source, {streamType, autoPlay: false});
    assert.equal(hlsStarts.length, 1);
    assert.equal(hlsStarts[0].source, source);
    assert.equal(hlsStarts[0].options.autoPlay, false);
    assert.equal(starts.length, 0, "must not open the playlist as a progressive/remux video");
  }
});

test("HLS hints handle response-type header casing and URL casing", () => {
  assert.equal(hlsModule.exports.hasHlsHint("https://cdn.test/signed", undefined, {"Content-Type": "Application/X-MPEGURL"}), true);
  assert.equal(hlsModule.exports.hasHlsHint("https://cdn.test/VIDEO.M3U8"), true);
  assert.equal(hlsModule.exports.hasHlsHint("/media/episode.mkv", "mkv"), false);
});

test("a probe that identifies HLS also selects HLS for an undeclared extensionless URL", async () => {
  const {engine, starts, hlsStarts, setProbe} = fixture("", true);
  setProbe({format_name: "hls", duration: 0, audio_tracks: [], video_tracks: [], subtitle_tracks: [], chapters: []});
  await engine.load("https://cdn.test/signed", {autoPlay: false});
  assert.equal(hlsStarts.length, 1);
  assert.equal(starts.length, 0);
});

function hevcProbe({ profile = "Main 10", bitDepth = 10 } = {}) {
  return {
    duration: 120, format_name: "matroska,webm",
    video_tracks: [{ index: 0, codec_name: "hevc", profile, bit_depth: bitDepth, width: 1920, height: 1080 }],
    audio_tracks: [{ index: 1, codec_name: "aac", is_default: true }],
    subtitle_tracks: [], chapters: [],
  };
}

test("Linux Main 10 keeps native playback when MediaSource advertises support", async () => {
  const { engine, setProbe } = fixture("Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15");
  setProbe(hevcProbe());
  await engine.load("/media/show/episode.mkv", { autoPlay: false });
  assert.equal(engine.playbackMode, "remux");
});

test("Linux does not force a transcode based on HEVC profile or bit depth alone", async () => {
  for (const metadata of [{ profile: "Main 10", bitDepth: undefined }, { profile: "", bitDepth: 10 }]) {
    const { engine, setProbe } = fixture("Linux x86_64");
    const probe = hevcProbe(metadata);
    if (metadata.bitDepth === undefined) delete probe.video_tracks[0].bit_depth;
    setProbe(probe);
    await engine.load("/media/show/episode.mkv", { autoPlay: false });
    assert.equal(engine.playbackMode, "remux");
  }
});

test("Linux 8-bit HEVC and H.264 retain the remux path", async () => {
  const { engine, setProbe } = fixture("Linux x86_64");
  setProbe(hevcProbe({ profile: "Main", bitDepth: 8 }));
  await engine.load("/media/show/episode.mkv", { autoPlay: false });
  assert.equal(engine.playbackMode, "remux");
  const probe = hevcProbe({ profile: "High", bitDepth: 8 });
  probe.video_tracks[0].codec_name = "h264";
  setProbe(probe);
  await engine.load("/media/show/episode2.mkv", { autoPlay: false });
  assert.equal(engine.playbackMode, "remux");
});

test("Windows, macOS and Android keep their existing Main 10 capability decisions", async () => {
  for (const userAgent of ["Windows NT 10.0", "Macintosh; Intel Mac OS X", "Linux; Android 14"]) {
    const { engine, setProbe } = fixture(userAgent);
    setProbe(hevcProbe());
    await engine.load("episode.mkv", { autoPlay: false });
    assert.equal(engine.playbackMode, "remux");
  }
});

test("local MP4 keeps both container audio tracks when WebKit exposes one", async () => {
  const { engine, metadata } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  assert.equal(engine.playbackMode, "remux");
  metadata();
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.id), [1, 3]);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.selected), [false, true]);
});

test("switching remux audio retains container IDs and selection after metadata reload", async () => {
  const { engine, video, starts, metadata } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  engine.updateState({ currentTime: 42 });
  await engine.selectTrack("aid", 1);
  metadata();
  assert.equal(starts.at(-1).audio, 1);
  assert.equal(starts.at(-1).time, 42);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.id), [1, 3]);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.selected), [true, false]);
  assert.equal(video.audioTracks[0].enabled, true, "container IDs must not toggle native track indexes");
  const count = starts.length;
  await engine.selectTrack("aid", 1);
  assert.equal(starts.length, count, "selecting the active track must not restart playback");
});

test("restoring an audio preference during startup retains the pending autoplay request", async () => {
  const {engine, video} = fixture("Linux x86_64");
  const starts = [];
  let releaseInitialStream;
  const initialStream = new Promise(resolve => { releaseInitialStream = resolve; });
  engine.startStream = async (_time, resume) => {
    starts.push(resume);
    if (starts.length === 1) await initialStream;
  };
  const loading = engine.load("/media/dual-audio.mkv", {autoPlay: true});
  while (!starts.length) await Promise.resolve();
  assert.equal(video.paused, true, "the element has not started yet");
  await engine.selectTrack("aid", 1);
  assert.deepEqual(starts, [true, true], "restoring the saved track must preserve autoplay");
  assert.equal(engine.state.isPaused, false);
  releaseInitialStream();
  await loading;
});

test("a user pause during preparation cancels pending autoplay for an audio restart", async () => {
  const {engine} = fixture("Linux x86_64");
  const starts = [];
  let releaseInitialStream;
  const initialStream = new Promise(resolve => { releaseInitialStream = resolve; });
  engine.startStream = async (_time, resume) => {
    starts.push(resume);
    if (starts.length === 1) await initialStream;
  };
  const loading = engine.load("/media/dual-audio.mkv", {autoPlay: true});
  while (!starts.length) await Promise.resolve();
  engine.pause();
  await engine.selectTrack("aid", 1);
  assert.deepEqual(starts, [true, false]);
  releaseInitialStream();
  await loading;
  assert.equal(engine.state.isPaused, true);
});

test("restoring a resume position during startup preserves autoplay and respects a user pause", async () => {
  for (const paused of [false, true]) {
    const {engine} = fixture("Linux x86_64");
    const starts = [];
    let release;
    const preparing = new Promise(resolve => { release = resolve; });
    engine.startStream = async (time, resume) => {
      starts.push({time, resume});
      if (starts.length === 1) await preparing;
    };
    const loading = engine.load("/media/dual-audio.mkv", {autoPlay: true});
    while (!starts.length) await Promise.resolve();
    if (paused) engine.pause();
    await engine.seek(25);
    assert.deepEqual(starts[1], {time:25, resume:!paused});
    assert.equal(engine.state.isPaused, paused);
    release();
    await loading;
  }
});

test("a later unprobed source can still discover native audio tracks", async () => {
  const { engine, metadata, setProbe } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  setProbe(null);
  await engine.load("/home/user/other.mp4", { autoPlay: false });
  metadata();
  assert.equal(engine.state.audioTracks.length, 1);
  assert.equal(engine.state.audioTracks[0].title, "Decoded audio");
});

test("a GStreamer push failure after decoding retries remux once without video transcoding", async () => {
  const {engine,video,starts} = fixture("Linux x86_64");
  await engine.load("/media/movie.mkv", {autoPlay:false});
  video.getVideoPlaybackQuality = () => ({totalVideoFrames:339,droppedVideoFrames:1});
  engine.updateState({currentTime:18});
  assert.equal(engine.tryPlaybackRecovery("Video error code 4: Failed to push buffer"),true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(engine.playbackMode,"remux");
  assert.equal(starts.at(-1).time,18);
  assert.equal(engine.tryPlaybackRecovery("Video error code 4: Failed to push buffer"),false);
  assert.equal(engine.playbackMode,"remux","repeated pipeline errors must not switch to CPU video transcoding");
});

test("a source rejected before any frames still uses the existing codec fallback", async () => {
  const {engine,video} = fixture("Linux x86_64");
  await engine.load("/media/movie.mkv", {autoPlay:false});
  video.getVideoPlaybackQuality = () => ({totalVideoFrames:0,droppedVideoFrames:0});
  assert.equal(engine.tryPlaybackRecovery("Video error code 4: unsupported codec"),true);
  assert.equal(engine.playbackMode,"transcode");
});

test("a pipeline push failure before preroll is retried without assuming the codec is missing", async () => {
  const {engine,video} = fixture("Linux x86_64");
  await engine.load("/media/movie.mkv", {autoPlay:false});
  video.getVideoPlaybackQuality = () => ({totalVideoFrames:0,droppedVideoFrames:0});
  assert.equal(engine.tryPlaybackRecovery("Video error code 4: Failed to push buffer"),true);
  assert.equal(engine.playbackMode,"remux");
});
