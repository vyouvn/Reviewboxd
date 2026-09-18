import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as cheerio from 'cheerio'

const app = express()
app.use(cors())

const fetchOptions = {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StoryBot/1.0)' },
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

async function fetchPosterUrl(tmdbId: string): Promise<string | null> {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`,
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null
}

app.get('/api/scrape', async (req, res) => {
  const reviewUrl = req.query.url as string
  const filmUrl = reviewUrl ? getFilmPageUrl(reviewUrl) : null

  if (!filmUrl) {
    return res.status(400).json({ error: 'Invalid Letterboxd review URL' })
  }

  try {
    const [reviewHtml, filmHtml] = await Promise.all([
      fetch(reviewUrl, fetchOptions).then((r) => r.text()),
      fetch(filmUrl, fetchOptions).then((r) => r.text()),
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
    const posterUrl = tmdbIdMatch ? await fetchPosterUrl(tmdbIdMatch[1]) : null

    res.json({ username, rating, reviewText, director, filmTitle, releaseYear, posterUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to scrape Letterboxd' })
  }
})

app.listen(3001, () => console.log('Scrape server running on http://localhost:3001'))