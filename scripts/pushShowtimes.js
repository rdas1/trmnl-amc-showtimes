const cheerio = require("cheerio");

const webhookUrl = process.env.TRMNL_WEBHOOK_URL;

const sourceUrl =
  process.env.SHOWTIME_SOURCE_URL ||
  "https://www.fandango.com/amc-magic-johnson-harlem-9-aaovp/theater-page?format=all";

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const text = await response.text();

  console.log("Source status:", response.status);
  console.log("HTML length:", text.length);
  console.log("Contains AMC?", text.includes("AMC Magic Johnson Harlem"));
  console.log("Contains showtime?", /showtime/i.test(text));
  console.log("Preview:", text.slice(0, 1000));

  if (!response.ok) {
    throw new Error(`Failed to fetch source page: ${response.status}`);
  }

  return text;
}

function parseShowtimes(html, targetDate = getTodayNYCDate()) {
  const $ = cheerio.load(html);
  const movies = [];

  $(`article[data-date="${targetDate}"]`).each((_, article) => {
    const $article = $(article);

    const title = cleanText(
      $article.find("h3 a").first().text() ||
      $article.find("h3").first().text()
    );

    if (!title) return;

    const times = [];

    $article.find(".showtime-button").each((_, button) => {
      const $button = $(button);

      // Remove hidden ticket popup content, leaving only the visible time text.
      const visibleTime = cleanText(
        $button
          .clone()
          .children(".movie-ticket-urls")
          .remove()
          .end()
          .text()
      );

      if (isShowtime(visibleTime)) {
        times.push(normalizeTime(visibleTime));
      }
    });

    if (times.length > 0) {
      movies.push({
        title,
        times: [...new Set(times)],
      });
    }
  });

  return movies;
}

function getTodayNYCDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());

  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  const year = parts.find((p) => p.type === "year").value;

  return `${month}/${day}/${year}`;
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isShowtime(value) {
  return /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(value);
}

function normalizeTime(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/am/i, "AM")
    .replace(/pm/i, "PM")
    .trim();
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

      // Easiest debugging field:
      movie_count: movies.length,

      // Safer if TRMNL has trouble with arrays:
      movies_json: JSON.stringify(movies),

      // Try this too; Liquid may support looping over it:
      movies,
    },
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const html = await fetchHtml(sourceUrl);
  const movies = parseShowtimes(html);

  console.log("Parsed movies:", JSON.stringify(movies, null, 2));

  if (movies.length === 0) {
    throw new Error(
      "No showtimes found. The page may be client-rendered or the selectors need updating."
    );
  }

  await pushToTrmnl(movies);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});