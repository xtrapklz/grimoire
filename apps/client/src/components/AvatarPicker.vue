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
let stream: MediaStream | null = null;

function pickEmoji(e: string) {
  setAvatar(e);
  emit("chosen", e);
}

async function openCamera() {
  reviewImage.value = null;
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

/** Center-crop a square from a source and return a token-sized JPEG. */
function cropToAvatar(
  source: HTMLVideoElement | HTMLImageElement,
  w: number,
  h: number,
  mirror: boolean,
): string {
  const side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(192, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 192, 192);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function snap() {
  const v = videoEl.value;
  if (!v || !v.videoWidth) return;
  // Mirrored, matching the preview — a selfie should look like the mirror did.
  const data = cropToAvatar(v, v.videoWidth, v.videoHeight, true);
  closeCamera();
  reviewImage.value = data;
}

async function onFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    reviewImage.value = cropToAvatar(img, img.width, img.height, false);
  } finally {
    URL.revokeObjectURL(url);
    if (fileInput.value) fileInput.value.value = "";
  }
}

function usePhoto() {
  if (!reviewImage.value) return;
  setAvatar(reviewImage.value);
  emit("chosen", reviewImage.value);
  reviewImage.value = null;
}

function retake() {
  reviewImage.value = null;
  openCamera();
}

function cancelReview() {
  reviewImage.value = null;
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

    <!-- Live camera modal (secure contexts) -->
    <div v-if="cameraOpen" class="camera-modal" @click.self="closeCamera">
      <div class="camera-frame">
        <video ref="videoEl" autoplay playsinline muted class="preview" />
        <div class="camera-controls">
          <button class="primary snap" @click="snap">
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
        <div class="camera-controls">
          <button class="primary snap" @click="usePhoto">
            <Icon name="check" :size="20" /> Use this photo
          </button>
          <button @click="retake"><Icon name="retake" :size="18" /> Retake</button>
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
