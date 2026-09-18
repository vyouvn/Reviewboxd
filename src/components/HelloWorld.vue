<script setup lang="ts">
import { ref } from 'vue'

interface ReviewData {
  username: string | null
  rating: number | null
  reviewText: string | null
  director: string | null
  filmTitle: string | null
  releaseYear: number | null
  posterUrl: string | null
}

const reviewUrl = ref('')
const reviewData = ref<ReviewData | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const storyCanvasRef = ref<HTMLElement | null>(null)

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
}

function starString(rating: number | null): string {
  if (rating === null) return ''
  return '★'.repeat(Math.floor(rating)) + (rating % 1 !== 0 ? '½' : '')
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
  } catch {
    errorMessage.value = 'Could not fetch that review. Check the URL and try again.'
    reviewData.value = null
  } finally {
    isLoading.value = false
  }
}

// Export template as image
import html2canvas from 'html2canvas-pro'
async function exportAsImage() {
  if (!storyCanvasRef.value) return

  const canvas = await html2canvas(storyCanvasRef.value, {
    useCORS: true,
    scale: 2, // sharper output than the on-screen CSS size
  })

  const link = document.createElement('a')
  link.download = `${reviewData.value?.filmTitle ?? 'story'}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

</script>

<template>
  <section id="center">
    <section id="spacer"></section>
    <div class="mb-8">
      <div class="mb-4 text-6xl font-extrabold font-serif">Reviewboxd</div>
      <p>Create Instagram story template from your Letterboxd film review.</p>
    </div>

    <!-- Review URL input -->
    <div class="text-xs">Paste your Letterboxd review URL</div>
    <div class="join w-xl">
      <input
        v-model="reviewUrl"
        class="input text-sm join-item"
        placeholder="e.g.letterboxd.com/username/film/film-title/"
      />
      <button
        class="btn btn-gradient btn-primary bg-primary text-primary-content text-sm join-item"
        :disabled="isLoading"
        @click="fetchReview"
      >
        {{ isLoading ? 'Loading...' : 'CREATE' }}
      </button>
    </div>
    <p v-if="errorMessage" class="text-error text-sm">{{ errorMessage }}</p>

    <!-- Story template (1080x1920) -->
    <div class="story-canvas-wrapper">
      <div v-if="reviewData" ref="storyCanvasRef" class="story-canvas card text-left rounded-none">
        <div class="card-body pt-30">
          <div class="grid grid-cols-3 gap-3 mb-2.5">
            <figure><img :src="reviewData?.posterUrl ?? 'https://cdn.flyonui.com/fy-assets/components/card/image-9.png'" crossorigin="anonymous" alt="Watch" class="border border-[#99aabb]/30 rounded-md h-50"/></figure>
            <div class="m-2 w-full col-span-2">
              <p class="card-title mb-2.5 font-thin text-xs">Review by <span class="font-bold">{{ reviewData?.username ?? 'Username' }}</span></p>
              <div class="divider mt-2 mb-4"></div>
              <div class="flex items-center gap-2">
                <div class="font-custom font-extrabold card-title mb-2.5 text-2xl text-primary-content">{{ reviewData?.filmTitle ?? 'Title' }} <span class="text-xl text-[#99aabb] font-thin font-sans">{{ reviewData?.releaseYear ?? 'Year' }}</span></div>
                <!-- <div class="card-title mb-2.5 text-sm opacity-60 text-primary-content">{{ reviewData?.releaseYear ?? 'Year' }}</div> -->
              </div>
              <div class="card-title mb-2.5 font-medium text-[#99aabb] text-sm">Directed by {{ reviewData?.director ?? 'Director' }}</div>
              <div class="flex text-3xl text-primary">{{ starString(reviewData?.rating ?? null) }}</div>
            </div>
          </div>
          <p class="noto-serif font-serif pt-4">{{ reviewData?.reviewText ?? 'Lorem ipsum dolor sit amet consectetur adipiscing elit.' }}</p>
        </div>
      </div>
    </div>

    <button v-if="reviewData" @click="exportAsImage" class="btn btn-gradient btn-primary"> <span class="shrink-0"></span>Export as image</button>
  </section>

  <section id="spacer"></section>
</template>
