import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as cheerio from 'cheerio'

const app = express()
app.use(cors())

if (!process.env.TMDB_API_KEY) console.warn('TMDB_API_KEY is not set: posters, backdrops and runtime will be empty')

const fetchOptions = {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StoryBot/1.0)' },
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, fetchOptions)
  if (!res.ok) throw new Error(`Letterboxd returned HTTP ${res.status} for ${url}`)
  return res.text()
}

function getFilmPageUrl(reviewUrl: string): string | null {
  const match = reviewUrl.match(/^https:\/\/letterboxd\.com\/[^/]+\/film\/([^/]+)\/?/)
  return match ? `https://letterboxd.com/film/${match[1]}/` : null
}

function parseRating(raw: string | undefined): number | null {
  if (!raw) return null
  const fullStars = (raw.match(/★/g) || []).length
  return fullStars + (raw.includes('½') ? 0.5 : 0)
}

function parseNameAndYear(raw: string | undefined) {
  if (!raw) return { filmTitle: null, releaseYear: null }
  const yearMatch = raw.match(/\((\d{4})\)/)
  return {
    filmTitle: raw.replace(/\s*\(\d{4}\)\s*$/, '').trim(),
    releaseYear: yearMatch ? Number(yearMatch[1]) : null,
  }
}

async function fetchTmdbDetails(tmdbId: string): Promise<{
  posterUrl: string | null
  backdropUrl: string | null
  runtimeMinutes: number | null
}> {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`,
  )
  if (!res.ok) {
    console.error(`TMDB details failed for movie ${tmdbId}: HTTP ${res.status}`)
    return { posterUrl: null, backdropUrl: null, runtimeMinutes: null }
  }
  const data = await res.json()
  return {
    posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null,
    backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
    runtimeMinutes: data.runtime ?? null,
  }
}

// Generic TMDB GET. The API key stays on the server.
async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://api.themoviedb.org/3${path}`)
  url.searchParams.set('api_key', process.env.TMDB_API_KEY ?? '')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`)
  return (await res.json()) as T
}

app.get('/api/scrape', async (req, res) => {
  const reviewUrl = req.query.url as string
  const filmUrl = reviewUrl ? getFilmPageUrl(reviewUrl) : null

  if (!filmUrl) {
    return res.status(400).json({ error: 'Invalid Letterboxd review URL' })
  }

  try {
    const [reviewHtml, filmHtml] = await Promise.all([
      fetchHtml(reviewUrl),
      fetchHtml(filmUrl),
    ])

    const $review = cheerio.load(reviewHtml)
    const $film = cheerio.load(filmHtml)

    const username = $review('meta[name="twitter:data1"]').attr('content') ?? null
    const rating = parseRating($review('meta[name="twitter:data2"]').attr('content'))
    const reviewText = $review('meta[property="og:description"]').attr('content') ?? null
    const director = $film('meta[name="twitter:data1"]').attr('content') ?? null

    const nameAndYearRaw =
      $film('meta[property="production:name-and-year"]').attr('content') ||
      $film('meta[name="production:name-and-year"]').attr('content') ||
      $film('meta[property="og:title"]').attr('content')
    const { filmTitle, releaseYear } = parseNameAndYear(nameAndYearRaw)

  const tmdbHref = $film('a[href*="themoviedb.org/movie/"]').attr('href')
  const tmdbIdMatch = tmdbHref?.match(/movie\/(\d+)/)
  if (!tmdbIdMatch) console.warn('No TMDB link found on', filmUrl)
  const { posterUrl, backdropUrl, runtimeMinutes } = tmdbIdMatch
    ? await fetchTmdbDetails(tmdbIdMatch[1])
    : { posterUrl: null, backdropUrl: null, runtimeMinutes: null }

  // tmdbId lets the poster/backdrop picker skip the title search and go straight to the right film.
  const tmdbId = tmdbIdMatch ? Number(tmdbIdMatch[1]) : null

  res.json({ username, rating, reviewText, director, filmTitle, releaseYear, posterUrl, backdropUrl, runtimeMinutes, tmdbId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to scrape Letterboxd' })
  }
})

// Posters + backdrops for the image picker. Pass ?tmdbId=123, or ?title=...&year=... as a fallback.
app.get('/api/images', async (req, res) => {
  try {
    let tmdbId = Number(req.query.tmdbId) || null

    if (!tmdbId) {
      const title = typeof req.query.title === 'string' ? req.query.title : ''
      if (!title) {
        return res.status(400).json({ error: 'tmdbId or title is required' })
      }
      const params: Record<string, string> = { query: title }
      if (typeof req.query.year === 'string') params.year = req.query.year

      const search = await tmdbGet<{ results: { id: number }[] }>('/search/movie', params)
      tmdbId = search.results[0]?.id ?? null
      if (!tmdbId) {
        return res.status(404).json({ error: 'Film not found on TMDB' })
      }
    }

    // English + textless images. Add more language codes if needed, e.g. 'en,id,null'.
    const { posters, backdrops } = await tmdbGet<{ posters: unknown[]; backdrops: unknown[] }>(
      `/movie/${tmdbId}/images`,
      { include_image_language: 'en,null' },
    )
    res.json({ posters, backdrops })
  } catch (err) {
    console.error(err)
    res.status(502).json({ error: 'TMDB request failed' })
  }
})

// Vercel runs the exported app as a serverless function, so only listen when running locally.
export default app

if (!process.env.VERCEL) {
  app.listen(3001, () => console.log('Scrape server running on http://localhost:3001'))
}
