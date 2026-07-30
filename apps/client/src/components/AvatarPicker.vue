<script setup lang="ts">
// Phone-side avatar chooser: a selfie or an emoji.
//
// Camera strategy: when the in-page camera API is available (https or
// localhost) we open a live mirrored preview with a snap button — no picker,
// no camera app round-trip. On plain-HTTP LAN (the usual party setup) the
// browser blocks that API, so we fall back to a file input with
// capture="user", which phones open directly in the camera app (not a file
// picker).
import { onUnmounted, ref } from "vue";
import { setAvatar } from "@/socket";
import Icon from "@/components/Icon.vue";

const emit = defineEmits<{ chosen: [avatar: string] }>();

const EMOJI = [
  "🧙", "🧛", "👻", "🤠", "👑", "🎭", "🦊", "🐺", "🦉", "🐈‍⬛",
  "🍺", "🕯️", "🌙", "⚔️", "🛡️", "🔮", "🌹", "💀", "🎪", "🃏",
];

const fileInput = ref<HTMLInputElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const cameraOpen = ref(false);
// The just-captured/selected photo, held for review before it becomes your
// avatar — so you can see exactly what everyone else will see and retake it
// if you blinked, rather than it silently becoming final the instant you tap.
const reviewImage = ref<string | null>(null);
/** Visible feedback for every way this can fail — never silent. */
const pickerError = ref("");
const uploading = ref(false);
const cameraReady = ref(false);
let stream: MediaStream | null = null;

async function pickEmoji(e: string) {
  pickerError.value = "";
  const resp = await setAvatar(e);
  if (resp.ok) emit("chosen", e);
}

async function openCamera() {
  reviewImage.value = null;
  pickerError.value = "";
  cameraReady.value = false;
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 } },
        audio: false,
      });
      cameraOpen.value = true;
      requestAnimationFrame(() => {
        if (videoEl.value) {
          videoEl.value.srcObject = stream;
          videoEl.value.onloadedmetadata = () => {
            cameraReady.value = true;
          };
          void videoEl.value.play();
        }
      });
      return;
    } catch {
      // fall through to the capture input
    }
  }
  fileInput.value?.click();
}

function closeCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  cameraOpen.value = false;
}

onUnmounted(closeCamera);

// The server rejects anything over 160,000 chars; stay comfortably under that
// so a slow/flaky upload is never the reason a photo gets rejected.
const AVATAR_MAX_CHARS = 150_000;
/** [canvas size, JPEG quality] tried in order until the result fits. A 192px
 *  selfie is normally a few KB, but low-end devices can behave oddly (odd
 *  color profiles, huge source photos) — this is the belt-and-suspenders. */
const CROP_ATTEMPTS: Array<[number, number]> = [
  [192, 0.78],
  [160, 0.65],
  [128, 0.55],
  [96, 0.5],
];

function renderCrop(
  source: HTMLVideoElement | HTMLImageElement,
  w: number,
  h: number,
  mirror: boolean,
  size: number,
  quality: number,
): string {
  const side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Center-crop a square from a source, shrinking further if needed to stay under the upload cap. */
function cropToAvatar(
  source: HTMLVideoElement | HTMLImageElement,
  w: number,
  h: number,
  mirror: boolean,
): string {
  let result = "";
  for (const [size, quality] of CROP_ATTEMPTS) {
    result = renderCrop(source, w, h, mirror, size, quality);
    if (result.length <= AVATAR_MAX_CHARS) return result;
  }
  return result; // smallest attempt — the server has the final say
}

function snap() {
  const v = videoEl.value;
  if (!v || !v.videoWidth) {
    pickerError.value = "Camera isn't ready yet — give it a second and try again.";
    return;
  }
  // Mirrored, matching the preview — a selfie should look like the mirror did.
  const data = cropToAvatar(v, v.videoWidth, v.videoHeight, true);
  closeCamera();
  reviewImage.value = data;
}

async function onFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  pickerError.value = "";
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    reviewImage.value = cropToAvatar(img, img.width, img.height, false);
  } catch {
    pickerError.value = "Couldn't read that photo — try again or pick an icon instead.";
  } finally {
    URL.revokeObjectURL(url);
    if (fileInput.value) fileInput.value.value = "";
  }
}

async function usePhoto() {
  if (!reviewImage.value) return;
  pickerError.value = "";
  uploading.value = true;
  const resp = await setAvatar(reviewImage.value);
  uploading.value = false;
  if (resp.ok) {
    emit("chosen", reviewImage.value);
    reviewImage.value = null;
  } else {
    // Keep the review image up so they can just retry the send, or retake.
    pickerError.value = resp.error ?? "Couldn't save that photo — try again.";
  }
}

function retake() {
  reviewImage.value = null;
  pickerError.value = "";
  openCamera();
}

function cancelReview() {
  reviewImage.value = null;
  pickerError.value = "";
}
</script>

<template>
  <div class="picker">
    <button class="selfie primary" @click="openCamera">
      <Icon name="camera" :size="22" /> Take a photo
    </button>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="user"
      style="display: none"
      @change="onFile"
    />
    <p class="or">or pick an icon</p>
    <div class="grid">
      <button v-for="e in EMOJI" :key="e" class="emoji" @click="pickEmoji(e)">{{ e }}</button>
    </div>
    <p v-if="pickerError && !cameraOpen && !reviewImage" class="pickererror">{{ pickerError }}</p>

    <!-- Live camera modal (secure contexts) -->
    <div v-if="cameraOpen" class="camera-modal" @click.self="closeCamera">
      <div class="camera-frame">
        <video ref="videoEl" autoplay playsinline muted class="preview" />
        <p v-if="!cameraReady" class="hint">Starting camera…</p>
        <p v-if="pickerError" class="pickererror">{{ pickerError }}</p>
        <div class="camera-controls">
          <button class="primary snap" :disabled="!cameraReady" @click="snap">
            <Icon name="camera" :size="24" /> Snap
          </button>
          <button @click="closeCamera">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Review before it becomes your avatar -->
    <div v-if="reviewImage" class="camera-modal" @click.self="cancelReview">
      <div class="camera-frame">
        <img :src="reviewImage" class="preview reviewimg" alt="your photo" />
        <p v-if="pickerError" class="pickererror">{{ pickerError }}</p>
        <div class="camera-controls">
          <button class="primary snap" :disabled="uploading" @click="usePhoto">
            <Icon name="check" :size="20" />
            {{ uploading ? "Saving…" : pickerError ? "Try again" : "Use this photo" }}
          </button>
          <button :disabled="uploading" @click="retake"><Icon name="retake" :size="18" /> Retake</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.selfie {
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8em 1.2em;
}
.or {
  text-align: center;
  font-size: 0.78rem;
  opacity: 0.6;
}
.pickererror {
  color: var(--blood);
  font-size: 0.82rem;
  text-align: center;
  max-width: 20rem;
}
.hint {
  font-size: 0.82rem;
  opacity: 0.7;
  text-align: center;
}
.grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.4rem;
}
.emoji {
  font-size: 1.5rem;
  padding: 0.35em 0;
  line-height: 1;
}
.camera-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(10, 6, 16, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.camera-frame {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  align-items: center;
}
.preview {
  width: min(78vw, 340px);
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 50%;
  border: 3px solid var(--gold);
  transform: scaleX(-1); /* mirror like a mirror */
  background: #000;
}
.reviewimg {
  /* Already correctly oriented (baked into the cropped image) — don't mirror again. */
  transform: none;
}
.camera-controls {
  display: flex;
  gap: 0.8rem;
}
.snap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
}
</style>
