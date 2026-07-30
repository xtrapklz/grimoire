// Lets the browser read music/SFX straight from a folder on this computer's
// disk — nothing is uploaded, nothing touches the server. Only this browser
// tab, on this machine, ever sees the files; they're played via local Blob
// URLs. Built on the File System Access API, so it's Chrome/Edge only (not
// Firefox or Safari as of writing) — callers must check `isSupported()` and
// offer the existing server-hosted audio as a fallback.

const DB_NAME = "grimoire-local-folder";
const STORE = "handles";
const KEY = "assets-dir";

export function isSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSavedFolder(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * The remembered handle, if any browser permission is still needed before
 * it can actually be read — the browser never lets a page silently reuse
 * filesystem access across a reload without either a persisted "granted"
 * state or a fresh user gesture.
 */
export async function loadSavedFolder(): Promise<{
  handle: FileSystemDirectoryHandle;
  granted: boolean;
} | null> {
  const db = await openDb();
  const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!handle) return null;
  const granted = (await handle.queryPermission({ mode: "read" })) === "granted";
  return { handle, granted };
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}

const AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|m4a|aac|flac)$/i;

async function subdir(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function audioFilesIn(dir: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && AUDIO_EXTENSIONS.test(entry.name)) {
      out.push(await (entry as FileSystemFileHandle).getFile());
    }
  }
  return out;
}

/** Every music/<folder> and sfx/<folder> read as real Files, keyed by folder name. */
export async function readFolderContents(
  handle: FileSystemDirectoryHandle,
): Promise<{ music: Record<string, File[]>; sfx: Record<string, File[]> }> {
  const music: Record<string, File[]> = {};
  const sfx: Record<string, File[]> = {};

  const musicDir = await subdir(handle, "music");
  if (musicDir) {
    for await (const entry of musicDir.values()) {
      if (entry.kind === "directory") {
        music[entry.name] = await audioFilesIn(entry as FileSystemDirectoryHandle);
      }
    }
  }
  const sfxDir = await subdir(handle, "sfx");
  if (sfxDir) {
    for await (const entry of sfxDir.values()) {
      if (entry.kind === "directory") {
        sfx[entry.name] = await audioFilesIn(entry as FileSystemDirectoryHandle);
      }
    }
  }
  return { music, sfx };
}

/** Converts a File map to Object URLs, returning the URLs to revoke later. */
export function filesToObjectUrls(files: Record<string, File[]>): {
  urls: Record<string, string[]>;
  allUrls: string[];
} {
  const urls: Record<string, string[]> = {};
  const allUrls: string[] = [];
  for (const [folder, list] of Object.entries(files)) {
    urls[folder] = list.map((f) => {
      const u = URL.createObjectURL(f);
      allUrls.push(u);
      return u;
    });
  }
  return { urls, allUrls };
}
