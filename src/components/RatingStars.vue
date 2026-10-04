<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import Raty from 'raty-js'
import 'raty-js/src/raty.css'

const props = defineProps({
  score: { type: Number, required: true }
})

const ratingEl = ref(null)
let ratyInstance = null

onMounted(() => {
  ratyInstance = new Raty(ratingEl.value, {
    starType: 'i',
    score: props.score,
    readOnly: true,
    starOff: 'icon-[tabler--star-filled] opacity-20 size-7',
    starOn: 'icon-[tabler--star-filled] size-7 text-warning'
  })
  ratyInstance.init()
})

// re-render the stars if the score prop changes later
watch(() => props.score, (val) => {
  ratyInstance?.set({ score: val })
})

onBeforeUnmount(() => {
  ratingEl.value = null
  ratyInstance = null
})
</script>

<template>
  <div ref="ratingEl" class="flex"></div>
</template>