const { chromium } = require("playwright");

const webhookUrl = process.env.TRMNL_WEBHOOK_URL;

const sourceUrl =
  process.env.SHOWTIME_SOURCE_URL ||
  "https://www.imdb.com/showtimes/cinema/US/ci0010728/US/10027/?ref_=sh_thtr";

async function fetchPageData(url) {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await page.waitForTimeout(6000);

    const html = await page.content();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    // console.log("HTML length:", html.length);
    // console.log("Body text length:", bodyText.length);
    // console.log("Contains AMC?", bodyText.includes("AMC Magic Johnson Harlem"));
    // console.log("Contains showtime?", /showtime/i.test(bodyText));
    // console.log("Contains robot check?", /not a robot|JavaScript is disabled/i.test(bodyText));
    console.log("Body preview:", bodyText);

    return { html, bodyText };
  } finally {
    await browser.close();
  }
}


function parseEmbeddedJson(html) {
  const movies = [];

  const jsonCandidates = [
    ...extractNextDataJson(html),
    ...extractScriptJsonBlobs(html),
  ];

  for (const candidate of jsonCandidates) {
    collectMoviesFromJson(candidate, movies);
  }

  return dedupeMovies(movies);
}

function extractNextDataJson(html) {
  const match = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match) return [];

  try {
    return [JSON.parse(unescapeHtml(match[1]))];
  } catch (error) {
    console.log("Could not parse __NEXT_DATA__:", error.message);
    return [];
  }
}

function extractScriptJsonBlobs(html) {
  const candidates = [];
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const scriptTag of scripts) {
    const scriptText = scriptTag.replace(/<script[^>]*>|<\/script>/gi, "");

    if (!/showtime|showtimes|movieTitle|displayTitle|AMC Magic Johnson/i.test(scriptText)) {
      continue;
    }

    const cleaned = unescapeHtml(scriptText);

    // Look for obvious JSON object/array assignment patterns.
    const possibleJsons = [
      ...cleaned.matchAll(/=\s*({[\s\S]*?})\s*;?\s*$/gm),
      ...cleaned.matchAll(/=\s*(\[[\s\S]*?\])\s*;?\s*$/gm),
    ];

    for (const match of possibleJsons) {
      try {
        candidates.push(JSON.parse(match[1]));
      } catch {
        // Ignore non-JSON JavaScript objects.
      }
    }
  }

  return candidates;
}

function collectMoviesFromJson(value, movies) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) collectMoviesFromJson(item, movies);
    return;
  }

  if (typeof value !== "object") return;

  const title =
    value.title ||
    value.movieTitle ||
    value.displayTitle ||
    value.originalTitle ||
    value.name;

  const text = JSON.stringify(value);
  const times = extractTimes(text);

  if (isProbablyMovieTitle(title) && times.length > 0) {
    movies.push({
      title: cleanText(title),
      times,
    });
  }

  for (const child of Object.values(value)) {
    collectMoviesFromJson(child, movies);
  }
}

function parseShowtimes({ bodyText }) {
  return parseBodyText(bodyText);
}

function parseBodyText(bodyText) {
  const lines = bodyText
    .split("\n")
    .map(cleanText)
    .filter(Boolean);

  const movies = [];
  let currentMovie = null;

  for (const line of lines) {
    // Stop before nearby theaters / footer content.
    if (/^Movie showtimes data provided by/i.test(line)) break;
    if (/^More to explore$/i.test(line)) break;
    if (/^Theaters near you$/i.test(line)) break;

    // Ignore page chrome before the theater title.
    if (
      [
        "Menu",
        "All",
        "Watchlist",
        "Sign in",
        "Back",
        "Selected date",
        "Current location",
        "Sponsored",
        "Rate",
        "Mark as watched",
        "Standard:",
      ].includes(line)
    ) {
      continue;
    }

    // Times attach to the most recent movie.
    if (isShowtime(line)) {
      if (currentMovie) {
        currentMovie.times.push(normalizeTime(line));
      }
      continue;
    }

    // Skip metadata lines like year/runtime/rating/votes.
    if (isMovieMetadataLine(line)) continue;
    if (isTheaterOrAddressLine(line)) continue;

    // Anything left in the showtimes block is probably a movie title.
    if (isProbablyMovieTitle(line)) {
      currentMovie = {
        title: line,
        times: [],
      };
      movies.push(currentMovie);
    }
  }

  return dedupeMovies(movies);
}

function isMovieMetadataLine(line) {
  return (
    /^\d{4}/.test(line) || // 20262h 7mPG-13
    /^\d+(\.\d+)?$/.test(line) || // 7.7
    /^\(?[\d.KM]+\)?$/.test(line) || // (78K)
    /^\([^)]+\)$/.test(line)
  );
}

function isTheaterOrAddressLine(line) {
  return (
    /AMC Magic Johnson Harlem 9/i.test(line) ||
    /Frederick Douglass Blvd/i.test(line) ||
    /New York NY/i.test(line) ||
    /^\d+(\.\d+)? miles$/i.test(line) ||
    /^\(\d{3}\)\s?\d{3}-\d{4}$/.test(line) ||
    /^\d{5}, US$/i.test(line) ||
    /^May \d{1,2}$/i.test(line)
  );
}

function isShowtime(value) {
  return /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(cleanText(value));
}


function extractTimes(text) {
  const matches = String(text).match(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/gi) || [];
  return [...new Set(matches.map(normalizeTime))];
}

function normalizeTime(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/am/i, "AM")
    .replace(/pm/i, "PM")
    .trim();
}

function isProbablyMovieTitle(value) {
  const title = cleanText(value);

  if (!title || title.length < 2 || title.length > 140) return false;
  if (title === "[object Object]") return false;

  if (extractTimes(title).length > 0) return false;

  const badPatterns = [
    /showtime/i,
    /ticket/i,
    /trailer/i,
    /cinema/i,
    /theater/i,
    /privacy/i,
    /terms/i,
    /sign in/i,
    /loading/i,
    /advertisement/i,
    /imdb/i,
    /fandango/i,
    /amc magic johnson harlem/i,
    /today/i,
    /tomorrow/i,
    /nearby/i,
    /not a robot/i,
    /javascript is disabled/i,
    /^standard:?$/i,
    /^rate$/i,
    /^mark as watched$/i,
  ];

  return !badPatterns.some((pattern) => pattern.test(title));
}

function dedupeMovies(movies) {
  const map = new Map();

  for (const movie of movies || []) {
    const title = cleanText(movie.title);
    const times = [...new Set((movie.times || []).map(normalizeTime))];

    if (!isProbablyMovieTitle(title) || times.length === 0) continue;

    const key = title.toLowerCase();
    const existing = map.get(key) || { title, times: [] };

    existing.times = [...new Set([...existing.times, ...times])];
    map.set(key, existing);
  }

  return [...map.values()].slice(0, 10);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unescapeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

async function pushToTrmnl(movies) {
  if (!webhookUrl) {
    throw new Error("Missing TRMNL_WEBHOOK_URL");
  }

  const payload = {
    merge_variables: {
      theater: "AMC Magic Johnson Harlem 9",
      date_label: "Today",
      updated_at: new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
      }),
      movie_count: movies.length,
      movies_json: JSON.stringify(movies),
      movies,
    },
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  console.log("TRMNL status:", response.status);
  console.log("TRMNL response:", text);

  if (!response.ok) {
    throw new Error(`TRMNL webhook failed: ${response.status} ${text}`);
  }
}

async function main() {
  const pageData = await fetchPageData(sourceUrl);
  const movies = parseShowtimes(pageData);

  console.log("Parsed movies:", JSON.stringify(movies, null, 2));

  if (movies.length === 0) {
    throw new Error(
      "No showtimes found. Playwright loaded the page, but parser needs tighter selectors."
    );
  }

  if (process.env.DRY_RUN === "true") {
    console.log("DRY_RUN=true, skipping TRMNL push.");
    return;
  }

  await pushToTrmnl(movies);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});