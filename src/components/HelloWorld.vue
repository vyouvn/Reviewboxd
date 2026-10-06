<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import html2canvas from 'html2canvas-pro'

interface ReviewData {
  username: string | null
  rating: number | null
  reviewText: string | null
  director: string | null
  filmTitle: string | null
  releaseYear: number | null
  posterUrl: string | null
  backdropUrl: string | null
  runtimeMinutes: number | null
  tmdbId?: number | null
}

interface TmdbImage {
  file_path: string
  iso_639_1: string | null
  width: number
  height: number
  vote_average: number
}

interface TmdbImages {
  posters: TmdbImage[]
  backdrops: TmdbImage[]
}

const storyScale = ref(1)

function updateStoryScale() {
  const availableWidth = window.innerWidth - 40
  storyScale.value = Math.min(1, availableWidth / 540)
}

// --- TMDB ---------------------------------------------------------------
// Image CDN only (public, no key). TMDB API calls go through /api/images so the
// TMDB key stays on the server and never ships in the browser bundle.
const TMDB_IMG = 'https://image.tmdb.org/t/p'

// --- Image picker (one modal, used for both poster and backdrop) --------
type PickerKind = 'poster' | 'backdrop'

const PICKER_MODAL_ID = 'image-picker-modal'

const PICKERS = {
  poster: {
    title: 'Change poster',
    imagesKey: 'posters',
    urlKey: 'posterUrl',
    thumbSize: 'w342',
    applySize: 'w500',
    gridClass: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5',
    aspectClass: 'aspect-2/3',
  },
  backdrop: {
    title: 'Change backdrop',
    imagesKey: 'backdrops',
    urlKey: 'backdropUrl',
    thumbSize: 'w300',
    // The story is exported at 1080px wide, so use TMDB's 1280px backdrop.
    applySize: 'w1280',
    gridClass: 'grid-cols-2 sm:grid-cols-3',
    aspectClass: 'aspect-video',
  },
} as const

// --- FlyonUI overlay ----------------------------------------------------
type FlyonWindow = Window & {
  HSOverlay?: { open(target: string | HTMLElement): void; close(target: string | HTMLElement): void }
  HSStaticMethods?: { autoInit(components?: string[]): void }
}
const flyon = () => window as FlyonWindow

const reviewUrl = ref('')
const reviewData = ref<ReviewData | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const storyCanvasRef = ref<HTMLElement | null>(null)

// --- Export / share state -------------------------------------------------
const isExporting = ref(false)
const canShareFiles = ref(false)
const shareHint = ref('')
// The last rendered image, kept so a second tap on Share can open the share sheet instantly.
let preparedFile: File | null = null

// Any edit (new review, new poster or backdrop) makes the cached image stale.
watch(
  reviewData,
  () => {
    preparedFile = null
    shareHint.value = ''
  },
  { deep: true },
)

const activePicker = ref<PickerKind>('poster')
const picker = computed(() => PICKERS[activePicker.value])
const tmdbImages = ref<TmdbImages | null>(null)
const imageOptions = computed(() => tmdbImages.value?.[picker.value.imagesKey] ?? [])
const isLoadingImages = ref(false)
const imageError = ref('')

onMounted(async () => {
  await nextTick()
  flyon().HSStaticMethods?.autoInit(['overlay'])
  updateStoryScale()
  window.addEventListener('resize', updateStoryScale)

  // Only show the Share button where the browser can share image files (mostly phones).
  canShareFiles.value =
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File(['x'], 'test.png', { type: 'image/png' })] })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateStoryScale)
})

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('URL is required')
  }
  const url = new URL(
    trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
  )
  const hostname = url.hostname.toLowerCase()
  if (
    hostname !== 'letterboxd.com' &&
    hostname !== 'www.letterboxd.com' &&
    hostname !== 'boxd.it'
  ) {
    throw new Error('Not a Letterboxd URL')
  }
  return url.href
}

function starString(rating: number | null): string {
  if (rating === null) return ''
  return '★'.repeat(Math.floor(rating))
}

function hasHalfStar(rating: number | null): boolean {
  return rating !== null && rating % 1 !== 0
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

// html2canvas paints a copy of the page inside a hidden iframe. In production the CSS is a
// separate <link> file, and the iframe can start painting before it has loaded (common on
// phones), which exports an unstyled image. Copying the rules in as an inline <style> avoids that.
function inlineStyles(clonedDoc: Document) {
  const css = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')
      } catch {
        return '' // cross-origin stylesheet, cannot be read
      }
    })
    .join('\n')
  const style = clonedDoc.createElement('style')
  style.textContent = css
  clonedDoc.head.appendChild(style)
}

function storyFilename(): string {
  const title = reviewData.value?.filmTitle
    ? sanitizeFilename(reviewData.value.filmTitle)
    : 'story'
  return `${title}_review.png`
}

// Renders the story at full size (1080x1920). Shared by Save and Share.
async function renderStoryCanvas(): Promise<HTMLCanvasElement | null> {
  const story = storyCanvasRef.value
  if (!story) return null

  const previousTransform = story.style.transform

  try {
    story.style.transform = 'scale(1)'

    await nextTick()
    await document.fonts.ready

    return await html2canvas(story, {
      useCORS: true,
      scale: 2,
      // Render the clone at desktop width so phone and PC exports match.
      windowWidth: 1280,
      onclone: (clonedDoc) => inlineStyles(clonedDoc),
    })
  } finally {
    story.style.transform = previousTransform
  }
}

async function exportAsImage() {
  if (isExporting.value) return
  isExporting.value = true
  shareHint.value = ''

  try {
    const canvas = await renderStoryCanvas()
    if (!canvas) return

    const link = document.createElement('a')
    link.download = storyFilename()
    link.href = canvas.toDataURL('image/png')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (err) {
    console.error('Export failed:', err)
  } finally {
    isExporting.value = false
  }
}

// Opens the system share sheet with the image attached; Instagram shows up there as a target.
async function shareAsImage() {
  if (isExporting.value) return
  isExporting.value = true
  shareHint.value = ''

  try {
    let file = preparedFile

    if (!file) {
      const canvas = await renderStoryCanvas()
      if (!canvas) return

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not create the image')

      file = new File([blob], storyFilename(), { type: 'image/png' })
      preparedFile = file
    }

    await navigator.share({ files: [file] })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''

    // The user closed the share sheet. Not an error.
    if (name === 'AbortError') return

    // Browsers (iOS Safari especially) only allow sharing shortly after a tap, and rendering
    // can take longer than that. The image is cached now, so the next tap shares instantly.
    if (name === 'NotAllowedError' && preparedFile) {
      shareHint.value = 'Your image is ready. Tap Share again to send it.'
      return
    }

    console.error('Share failed:', err)
    shareHint.value = 'Sharing failed. Use Save template instead.'
  } finally {
    isExporting.value = false
  }
}

async function fetchReview() {
  if (!reviewUrl.value) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    const url = normalizeUrl(reviewUrl.value)
    const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error('Scrape request failed')
    reviewData.value = await res.json()
    tmdbImages.value = null
    imageError.value = ''
  } catch {
    errorMessage.value = 'Could not fetch that review. Check the URL and try again.'
    reviewData.value = null
  } finally {
    isLoading.value = false
  }
}

// --- Image picker logic -------------------------------------------------

// The server finds the film on TMDB (by id, or by title + year) and returns its posters and
// backdrops together. See /api/images in api/index.ts.
async function fetchImageOptions(data: ReviewData): Promise<TmdbImages> {
  const params = new URLSearchParams()
  if (data.tmdbId) {
    params.set('tmdbId', String(data.tmdbId))
  } else {
    if (!data.filmTitle) throw new Error('Missing film title')
    params.set('title', data.filmTitle)
    if (data.releaseYear) params.set('year', String(data.releaseYear))
  }
  const res = await fetch(`/api/images?${params}`)
  if (!res.ok) throw new Error(`Image request failed (${res.status})`)
  return res.json() as Promise<TmdbImages>
}

// One request returns both posters and backdrops, so it is fetched once per film.
async function loadImageOptions() {
  const film = reviewData.value
  if (!film || isLoadingImages.value || tmdbImages.value) return

  isLoadingImages.value = true
  imageError.value = ''
  try {
    const images = await fetchImageOptions(film)
    // Ignore the result if another review was loaded while this request was in flight.
    if (reviewData.value === film) tmdbImages.value = images
  } catch (err) {
    console.error('Image load failed:', err)
    imageError.value = 'Could not load images from TMDB. Try again in a moment.'
  } finally {
    isLoadingImages.value = false
  }
}

function openPicker(kind: PickerKind) {
  activePicker.value = kind
  flyon().HSOverlay?.open(`#${PICKER_MODAL_ID}`)
  loadImageOptions()
}

function closePicker() {
  flyon().HSOverlay?.close(`#${PICKER_MODAL_ID}`)
}

// "/t/p/w500/abc123.jpg" -> "/abc123.jpg"
function tmdbFilePath(url: string | null): string | null {
  return url?.match(/\/t\/p\/[^/]+(\/.+)$/)?.[1] ?? null
}

function isCurrentImage(image: TmdbImage): boolean {
  const current = reviewData.value?.[picker.value.urlKey] ?? null
  return tmdbFilePath(current) === image.file_path
}

function selectImage(image: TmdbImage) {
  if (!reviewData.value) return
  reviewData.value[picker.value.urlKey] = `${TMDB_IMG}/${picker.value.applySize}${image.file_path}`
  closePicker()
}
</script>

<template>
  <section id="center">
    <section id="spacer"></section>
    <div class="mb-8">
      <div class="mb-4 text-4xl md:text-5xl font-extrabold font-serif">
        Reviewboxd
      </div>
      <p class="text-sm md:text-md">Create Instagram story template from your Letterboxd film review.</p>
      <a href="https://letterboxd.com/stardzt/" target="_blank" class="btn btn-sm [--btn-color:#000000] text-white rounded-sm mt-4" >
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512">
          <path d="M0 0h512v512H0z" fill="none" />
          <path fill-rule="evenodd" d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256s256-114.6 256-256S397.4 0 256 0m-60.9 293.9c-6.9-11-10.9-24-10.9-37.9s4-26.9 10.9-37.9C202 229 206 242 206 256c0 13.9-4 26.9-10.9 37.9m121.8 0c-6.9-11-10.9-24-10.9-37.9s4-26.9 10.9-37.9c6.9 11 10.9 24 10.9 37.9s-4 26.9-10.9 37.9" />
          <path fill="#00e054" fill-rule="evenodd" d="M316.9 218.1c-12.7-20.3-35.2-33.7-60.9-33.7s-48.2 13.5-60.9 33.7C202 229 206 242 206 256c0 13.9-4 26.9-10.9 37.9c12.7 20.3 35.2 33.7 60.9 33.7s48.2-13.5 60.9-33.7c-6.9-11-10.9-24-10.9-37.9c0-14 4-27 10.9-37.9" />
          <path fill="#40bcf4" fill-rule="evenodd" d="M377.8 184.3c-25.7 0-48.2 13.5-60.9 33.7c6.9 11 10.9 24 10.9 37.9s-4 26.9-10.9 37.9c12.7 20.3 35.2 33.7 60.9 33.7c39.6 0 71.8-32.1 71.8-71.7c-.1-39.4-32.2-71.5-71.8-71.5" />
          <path fill="#ff8000" fill-rule="evenodd" d="M184.2 256c0-13.9 4-26.9 10.9-37.9c-12.7-20.3-35.2-33.7-60.9-33.7c-39.6 0-71.8 32.1-71.8 71.7s32.1 71.7 71.8 71.7c25.7 0 48.2-13.5 60.9-33.7c-6.9-11.2-10.9-24.2-10.9-38.1" />
        </svg>
        Follow me on Letterboxd
      </a>
    </div>

    <!-- Review URL input -->
    <div class="join w-full max-w-xl">
      <input
        v-model="reviewUrl"
        class="input flex-1 min-w-0 w-auto text-sm join-item rounded-l-md"
        placeholder="Paste your Letterboxd review URL"
      />

      <button
        class="btn btn-gradient btn-primary bg-primary text-primary-content text-sm join-item rounded-r-md shrink-0"
        :disabled="isLoading"
        @click="fetchReview"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16">
          <path d="M0 0h16v16H0z" fill="none" />
          <path fill="currentColor" d="M13 1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zM3 11v2h10v-2l-2-2l-2 2l-3-3zm8-8a2 2 0 1 0 0 4a2 2 0 0 0 0-4" />
        </svg>
        {{ isLoading ? 'Loading...' : 'Create' }}
      </button>
    </div>
    <p v-if="errorMessage" class="text-error text-sm">{{ errorMessage }}</p>

    <!-- Story template (1080x1920) -->
    <div
      class="story-canvas-wrapper rounded-md"
    >
      <div
        v-if="reviewData"
        class="story-canvas-stage"
        :style="{
          width: `${540 * storyScale}px`,
          height: `${960 * storyScale}px`
        }"
      >
        <div
          ref="storyCanvasRef"
          class="story-canvas card text-left rounded-none relative overflow-hidden border border-[#99aabb]/30"
          :style="{ transform: `scale(${storyScale})` }"
        >
          <div class="absolute top-0 left-0 w-full h-55">
            <img
              v-if="reviewData?.backdropUrl"
              :src="reviewData.backdropUrl"
              crossorigin="anonymous"
              alt=""
              class="w-full h-40 object-cover"
            />
            <div class="absolute -inset-x-1 top-0 bg-linear-to-b from-transparent to-[#14181c] h-41"></div>
            <button
              type="button"
              data-html2canvas-ignore
              aria-label="Change backdrop"
              class="absolute inset-x-0 top-0 flex h-40 cursor-pointer items-center justify-center bg-black/55 opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100"
              @click="openPicker('backdrop')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="size-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4L4 16v4" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </button>
          </div>
          <div class="card-body pointer-events-none pt-30 relative z-10">
            <div class="grid grid-cols-3 gap-3 mb-2.5">
              <figure class="group relative w-fit self-start pointer-events-auto">
                <img :src="reviewData?.posterUrl ?? 'https://cdn.flyonui.com/fy-assets/components/card/image-9.png'" crossorigin="anonymous" alt="Watch" class="border border-[#99aabb]/30 rounded-md h-50"/>
                <!-- Edit overlay: editor-only, skipped by html2canvas so it never lands in the exported image -->
                <button
                  type="button"
                  data-html2canvas-ignore
                  aria-label="Change poster"
                  class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
                  @click="openPicker('poster')"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4L4 16v4" />
                    <path d="M13.5 6.5l4 4" />
                  </svg>
                </button>
              </figure>
              <div class="m-2 w-full col-span-2">
                <p class="card-title mb-2.5 font-thin text-xs">Review by <span class="font-bold">{{ reviewData?.username ?? 'Username' }}</span></p>
                <div class="mt-2 mb-4 h-px w-full bg-base-content/20"></div>
                <div class="flex items-center gap-2">
                  <div class="font-custom font-extrabold card-title mb-2.5 text-2xl text-primary-content">{{ reviewData?.filmTitle ?? 'Title' }} <span class="text-xl text-[#99aabb] font-thin font-sans">{{ reviewData?.releaseYear ?? 'Year' }}</span></div>
                  <!-- <div class="card-title mb-2.5 text-sm opacity-60 text-primary-content">{{ reviewData?.releaseYear ?? 'Year' }}</div> -->
                </div>
                <div class="card-title mb-2.5 font-thin text-[#99aabb] text-sm"><span v-if="reviewData?.runtimeMinutes">{{ formatRuntime(reviewData.runtimeMinutes) }}</span> • Directed by {{ reviewData?.director ?? 'Director' }}</div>
                <div class="flex items-baseline text-primary">
                  <span class="text-3xl">{{ starString(reviewData?.rating ?? null) }}</span>
                  <span v-if="hasHalfStar(reviewData?.rating ?? null)" class="text-2xl">½</span>
                </div>
              </div>
            </div>
            <p class="font-noto">{{ reviewData?.reviewText ?? 'No review available.' }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="reviewData" class="flex flex-wrap items-center justify-center gap-3">
      <button
        class="btn btn-gradient btn-primary rounded-md text-sm"
        :disabled="isExporting"
        @click="exportAsImage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
          <path d="M0 0h24v24H0z" fill="none" />
          <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 8zM4 19h16v2H4z" />
        </svg>
        Download
      </button>
      <button
        v-if="canShareFiles"
        class="btn btn-gradient btn-primary rounded-md text-sm"
        :disabled="isExporting"
        @click="shareAsImage"
      >
      <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
        <path d="M0 0h24v24H0z" fill="none" />
        <path fill="currentColor" d="M17.5 2.5a3 3 0 0 0-2.902 3.765a.8.8 0 0 0-.207.077l-2.757 1.503L8.128 9.85a1 1 0 0 0-.1.068a3 3 0 1 0 .682 4.612l2.926 1.627l2.954 1.611q-.09.353-.09.733a3 3 0 1 0 .81-2.05l-2.948-1.607l-2.946-1.636a3 3 0 0 0-.308-2.19l3.258-1.862l2.743-1.497a.8.8 0 0 0 .177-.133A3 3 0 1 0 17.5 2.5" />
      </svg>
        Share
      </button>
    </div>
    <p v-if="shareHint" class="text-sm">{{ shareHint }}</p>
  </section>

  <section id="spacer"></section>

  <div
    :id="PICKER_MODAL_ID"
    class="overlay modal overlay-open:opacity-100 overlay-open:duration-300 modal-middle hidden"
    role="dialog"
    tabindex="-1"
  >
    <div class="modal-dialog modal-dialog-lg rounded-sm border border-base-content/20">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title font-custom font-extrabold">{{ picker.title }}</h3>
          <button
            type="button"
            class="btn btn-text btn-circle btn-sm absolute end-3 top-3"
            aria-label="Close"
            :data-overlay="`#${PICKER_MODAL_ID}`"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6l-12 12" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div v-if="isLoadingImages" class="flex justify-center py-16">
            <span class="loading loading-spinner loading-lg text-primary" aria-label="Loading images"></span>
          </div>

          <p v-else-if="imageError" class="py-12 text-center text-sm text-error">{{ imageError }}</p>

          <p v-else-if="!imageOptions.length" class="py-12 text-center text-sm">TMDB has no {{ activePicker }}s for this film.</p>

          <div v-else class="grid max-h-[60vh] gap-3 overflow-y-auto" :class="picker.gridClass">
            <button
              v-for="image in imageOptions"
              :key="image.file_path"
              type="button"
              class="relative cursor-pointer overflow-hidden rounded-md border-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              :class="isCurrentImage(image) ? 'border-primary' : 'border-transparent hover:border-primary'"
              :aria-label="isCurrentImage(image) ? `Current ${activePicker}` : `Use this ${activePicker}`"
              @click="selectImage(image)"
            >
              <img
                :src="`${TMDB_IMG}/${picker.thumbSize}${image.file_path}`"
                alt=""
                loading="lazy"
                class="w-full object-cover"
                :class="picker.aspectClass"
              />
              <!-- <span class="badge badge-sm badge-neutral absolute bottom-1.5 start-1.5">
                {{ image.iso_639_1 ? image.iso_639_1.toUpperCase() : 'No text' }}
              </span> -->
              <span v-if="isCurrentImage(image)" class="badge badge-sm badge-primary absolute top-1.5 start-1.5">Current</span>
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-gradient btn-primary rounded-md" :data-overlay="`#${PICKER_MODAL_ID}`">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>