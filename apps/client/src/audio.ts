// The audio director: phase-driven music playlists with crossfades, one-shot
// SFX, and banner ducking. Everything is optional — whatever files exist in
// user-assets/ play; anything missing is silence. No external dependencies:
// plain HTMLAudio elements with volume ramps.

import type { AudioManifest } from "@grimoire/shared";
import {
  clearSavedFolder,
  filesToObjectUrls,
  isSupported,
  loadSavedFolder,
  readFolderContents,
  requestPermission,
  saveFolderHandle,
} from "./local-folder";

const CROSSFADE_MS = 2000;
const DUCK_LEVEL = 0.3;

class AudioDirector {
  manifest: AudioManifest = { music: {}, sfx: {} };
  enabled = false;
  muted = false;
  musicVolume = Number(
    (typeof localStorage !== "undefined" && localStorage.getItem("grimoire-music-volume")) || 0.55,
  );
  sfxVolume = Number(
    (typeof localStorage !== "undefined" && localStorage.getItem("grimoire-sfx-volume")) || 0.9,
  );

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    localStorage.setItem("grimoire-music-volume", String(v));
    if (this.current) this.fadeTo(this.current, this.targetVolume(), 200);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    localStorage.setItem("grimoire-sfx-volume", String(v));
  }

  private current: HTMLAudioElement | null = null;
  private currentGroup: string | null = null;
  private queue: string[] = [];
  private ducked = 0; // count of active duck requests
  private fadeTimers = new Set<ReturnType<typeof setInterval>>();
  private switchTimer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    try {
      const resp = await fetch("/api/audio");
      if (resp.ok) this.manifest = await resp.json();
    } catch {
      // no audio available — stay silent
    }
  }

  // ── Local folder (browser reads straight from disk, nothing uploaded) ──────
  // When active, a group/event present in the local folder takes priority over
  // the server-hosted manifest — lets someone use their own library without
  // ever sending it anywhere, while still falling back to server-hosted audio
  // for anything the local folder doesn't have.

  localFolderName: string | null = null;
  /** A remembered folder exists but the browser needs a fresh click to re-grant read access. */
  localFolderNeedsReconnect = false;
  private localMusicUrls: Record<string, string[]> = {};
  private localSfxUrls: Record<string, string[]> = {};
  private localObjectUrls: string[] = [];
  private pendingHandle: FileSystemDirectoryHandle | null = null;

  get localFolderSupported(): boolean {
    return isSupported();
  }

  get localFolderActive(): boolean {
    return this.localFolderName !== null && !this.localFolderNeedsReconnect;
  }

  /** Opens the OS folder picker — must be called from a click handler. */
  async pickLocalFolder(): Promise<boolean> {
    if (!isSupported()) return false;
    try {
      const handle = await window.showDirectoryPicker({ id: "grimoire-audio", mode: "read" });
      await this.useLocalHandle(handle);
      await saveFolderHandle(handle);
      return true;
    } catch {
      return false; // user cancelled the picker
    }
  }

  /** Call on startup: silently resumes a previously-picked folder if still permitted. */
  async tryRestoreLocalFolder(): Promise<void> {
    if (!isSupported()) return;
    const saved = await loadSavedFolder();
    if (!saved) return;
    if (saved.granted) {
      await this.useLocalHandle(saved.handle);
    } else {
      // Browsers won't silently re-grant filesystem access after a reload —
      // surface it so the UI can offer a one-click "Reconnect" instead of
      // just quietly losing the folder every time the page loads.
      this.pendingHandle = saved.handle;
      this.localFolderName = saved.handle.name;
      this.localFolderNeedsReconnect = true;
    }
  }

  /** Re-grants access to the remembered folder — must be called from a click handler. */
  async reconnectLocalFolder(): Promise<boolean> {
    if (!this.pendingHandle) return false;
    const ok = await requestPermission(this.pendingHandle);
    if (!ok) return false;
    await this.useLocalHandle(this.pendingHandle);
    return true;
  }

  async disconnectLocalFolder(): Promise<void> {
    this.revokeLocalUrls();
    this.localMusicUrls = {};
    this.localSfxUrls = {};
    this.localFolderName = null;
    this.localFolderNeedsReconnect = false;
    this.pendingHandle = null;
    await clearSavedFolder();
  }

  private async useLocalHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    this.revokeLocalUrls();
    const contents = await readFolderContents(handle);
    const music = filesToObjectUrls(contents.music);
    const sfx = filesToObjectUrls(contents.sfx);
    this.localMusicUrls = music.urls;
    this.localSfxUrls = sfx.urls;
    this.localObjectUrls = [...music.allUrls, ...sfx.allUrls];
    this.localFolderName = handle.name;
    this.localFolderNeedsReconnect = false;
    this.pendingHandle = null;
    // A folder picked mid-game should take effect immediately, not just on
    // the next natural phase change.
    if (this.currentGroup) {
      const g = this.currentGroup;
      this.currentGroup = null;
      this.playMusic(g);
    }
  }

  private revokeLocalUrls(): void {
    for (const u of this.localObjectUrls) URL.revokeObjectURL(u);
    this.localObjectUrls = [];
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    if (this.currentGroup) {
      const g = this.currentGroup;
      this.currentGroup = null;
      this.playMusic(g);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.current) this.current.volume = this.muted ? 0 : this.targetVolume();
    return this.muted;
  }

  private targetVolume(): number {
    return this.muted ? 0 : this.musicVolume * (this.ducked > 0 ? DUCK_LEVEL : 1);
  }

  /**
   * Switch to a music group (folder name). `once` plays a single track without
   * looping. `delayMs` postpones the crossfade so phase stings and the
   * storyteller's voice land first. Unknown/empty groups fade out to silence.
   */
  playMusic(group: string, opts: { once?: boolean; delayMs?: number } = {}): void {
    if (group === this.currentGroup) return;
    this.currentGroup = group; // commit intent now (dedupes repeat calls)
    if (this.switchTimer) clearTimeout(this.switchTimer);
    this.switchTimer = null;
    if (!this.enabled) return;

    const doSwitch = () => {
      this.switchTimer = null;
      const local = this.localFolderActive ? this.localMusicUrls[group] : undefined;
      const tracks = local && local.length > 0 ? local : (this.manifest.music[group] ?? []);
      this.fadeOutCurrent();
      if (tracks.length === 0) return;
      this.queue = tracks.slice();
      this.startTrack(this.randomTrack(null), opts.once ?? false);
    };
    if (opts.delayMs && opts.delayMs > 0) {
      this.switchTimer = setTimeout(doSwitch, opts.delayMs);
    } else {
      doSwitch();
    }
  }

  /** A uniformly random track, never the one that just played (when avoidable). */
  private randomTrack(lastUrl: string | null): string {
    const pool =
      this.queue.length > 1 && lastUrl !== null
        ? this.queue.filter((u) => u !== lastUrl)
        : this.queue;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  private startTrack(url: string, once: boolean): void {
    const el = new Audio(url);
    el.volume = 0;
    el.play().catch(() => undefined);
    this.current = el;
    this.fadeTo(el, this.targetVolume(), CROSSFADE_MS);
    el.onended = () => {
      if (this.current !== el || once) return;
      this.startTrack(this.randomTrack(url), false);
    };
  }

  private fadeOutCurrent(): void {
    const el = this.current;
    this.current = null;
    if (!el) return;
    this.fadeTo(el, 0, CROSSFADE_MS, () => {
      el.pause();
      el.src = "";
    });
  }

  private fadeTo(el: HTMLAudioElement, target: number, ms: number, done?: () => void): void {
    const start = el.volume;
    const t0 = performance.now();
    const timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = start + (target - start) * k;
      if (k >= 1) {
        clearInterval(timer);
        this.fadeTimers.delete(timer);
        done?.();
      }
    }, 50);
    this.fadeTimers.add(timer);
  }

  /**
   * Play a one-shot event sound ("death" → a random file from sfx/death/).
   * Multiple files in an event folder give natural variety.
   */
  sfx(name: string | undefined): void {
    if (!name || !this.enabled || this.muted) return;
    const key = name.toLowerCase();
    const local = this.localFolderActive ? this.localSfxUrls[key] : undefined;
    const urls = local && local.length > 0 ? local : (this.manifest.sfx[key] ?? []);
    if (urls.length === 0) return;
    const el = new Audio(urls[Math.floor(Math.random() * urls.length)]!);
    el.volume = this.sfxVolume;
    el.play().catch(() => undefined);
  }

  /** Fade all music out (game over — the victory sting carries the moment). */
  stopMusic(): void {
    this.currentGroup = "__stopped__";
    if (this.switchTimer) clearTimeout(this.switchTimer);
    this.switchTimer = null;
    this.fadeOutCurrent();
  }

  /** Lower the music while a banner/sting plays; call undock when it ends. */
  duck(): void {
    this.ducked++;
    if (this.current) this.fadeTo(this.current, this.targetVolume(), 300);
  }

  unduck(): void {
    this.ducked = Math.max(0, this.ducked - 1);
    if (this.current) this.fadeTo(this.current, this.targetVolume(), 800);
  }

  // ── Storyteller voice (browser TTS) ────────────────────────────────────────

  speechEnabled = true;
  /** Chosen system voice (voiceURI); null = browser default. Persisted. */
  voiceURI: string | null =
    typeof localStorage !== "undefined" ? localStorage.getItem("grimoire-voice") : null;
  speechRate = Number(
    (typeof localStorage !== "undefined" && localStorage.getItem("grimoire-voice-rate")) || 0.92,
  );
  speechVolume = Number(
    (typeof localStorage !== "undefined" && localStorage.getItem("grimoire-voice-volume")) || 1,
  );

  toggleSpeech(): boolean {
    this.speechEnabled = !this.speechEnabled;
    if (!this.speechEnabled) window.speechSynthesis?.cancel();
    return this.speechEnabled;
  }

  /** All voices the system offers (may fill in asynchronously). */
  getVoices(): SpeechSynthesisVoice[] {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices();
  }

  setVoice(uri: string | null): void {
    this.voiceURI = uri;
    if (uri) localStorage.setItem("grimoire-voice", uri);
    else localStorage.removeItem("grimoire-voice");
  }

  setSpeechRate(rate: number): void {
    this.speechRate = rate;
    localStorage.setItem("grimoire-voice-rate", String(rate));
  }

  setSpeechVolume(volume: number): void {
    this.speechVolume = volume;
    localStorage.setItem("grimoire-voice-volume", String(volume));
  }

  /**
   * Speak an announcement over ducked music. Resolves when the utterance ends
   * (or after a safety timeout) so banners can hold for the voice.
   */
  speak(text: string): Promise<void> {
    if (
      !this.enabled ||
      this.muted ||
      !this.speechEnabled ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = this.speechRate;
      utter.pitch = 0.85;
      utter.volume = this.speechVolume;
      const voice = this.getVoices().find((v) => v.voiceURI === this.voiceURI);
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      }
      this.duck();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.unduck();
        resolve();
      };
      utter.onend = finish;
      utter.onerror = finish;
      setTimeout(finish, 15_000); // never wedge the banner queue
      window.speechSynthesis.speak(utter);
    });
  }
}

export const audio = new AudioDirector();
