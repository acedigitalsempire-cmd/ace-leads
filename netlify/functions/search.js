// netlify/functions/search.js
// Proxy for SerpApi — runs on Netlify's servers, not the browser.
// This is what solves the CORS problem. Your API key never touches the browser.

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const SERP_KEY = process.env.SERP_API_KEY;
  if (!SERP_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "SERP_API_KEY not set in Netlify environment variables." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { service, location } = body;
  if (!service || !location) {
    return { statusCode: 400, body: JSON.stringify({ error: "service and location are required." }) };
  }

  // --- Step 1: Google Maps search ---
  const mapsUrl = new URL("https://serpapi.com/search.json");
  mapsUrl.searchParams.set("engine", "google_maps");
  mapsUrl.searchParams.set("q", `${service} in ${location}`);
  mapsUrl.searchParams.set("api_key", SERP_KEY);
  mapsUrl.searchParams.set("hl", "en");

  let mapResults = [];
  try {
    const mapsRes = await fetch(mapsUrl.toString());
    const mapsData = await mapsRes.json();
    mapResults = mapsData.local_results || [];
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "SerpApi Maps request failed: " + err.message }) };
  }

  // --- Step 2: For each result with NO website, try to find an email ---
  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-z]{2,}/gi;
  const BLACKLIST = ["sentry.io","example.com","noreply","no-reply","wixpress.com",
    "squarespace.com","google.com","yelp.com","facebook.com","placeholder","test.com"];

  function isValidEmail(email) {
    if (!email || email.length < 7) return false;
    const domain = email.split("@")[1]?.toLowerCase() || "";
    for (const b of BLACKLIST) {
      if (domain.includes(b) || email.toLowerCase().includes(b)) return false;
    }
    return /\.[a-z]{2,}$/.test(domain);
  }

  const leads = [];
  const seen = new Set();

  for (const place of mapResults) {
    // CORE RULE: skip if has website
    if (place.website || place.links?.website) continue;

    // Deduplicate
    const key = place.place_id || (place.title + "|" + place.address);
    if (seen.has(key)) continue;
    seen.add(key);

    // Search for email via Google organic search
    let email = null;
    const queries = [
      `"${place.title}" "${location}" email contact`,
      `${place.title} ${location} email`,
    ];

    for (const q of queries) {
      if (email) break;
      try {
        const searchUrl = new URL("https://serpapi.com/search.json");
        searchUrl.searchParams.set("engine", "google");
        searchUrl.searchParams.set("q", q);
        searchUrl.searchParams.set("api_key", SERP_KEY);
        searchUrl.searchParams.set("num", "5");

        const sRes = await fetch(searchUrl.toString());
        const sData = await sRes.json();

        // Check knowledge graph first
        const kgText = JSON.stringify(sData.knowledge_graph || {});
        for (const e of (kgText.match(EMAIL_REGEX) || [])) {
          if (isValidEmail(e)) { email = e.toLowerCase(); break; }
        }

        // Then organic snippets
        if (!email) {
          const blob = (sData.organic_results || [])
            .map(r => [r.snippet || "", r.title || ""].join(" ")).join(" ");
          for (const e of (blob.match(EMAIL_REGEX) || [])) {
            if (isValidEmail(e)) { email = e.toLowerCase(); break; }
          }
        }
      } catch { /* skip failed query, try next */ }
    }

    // CORE RULE: skip if no email found
    if (!email) continue;

    // Score (0-35): starts at 35, reduce if rating/reviews are decent
    const reviews = parseInt(place.reviews || 0, 10);
    const rating = parseFloat(place.rating || 0);
    let score = 35;
    if (rating >= 4.2) score -= 10;
    if (reviews >= 10) score -= 5;
    score = Math.max(0, Math.min(35, score));

    leads.push({
      id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: place.title || "Unknown Business",
      email,
      phone: place.phone || null,
      address: place.address || location,
      location,
      rating,
      reviews,
      score,
      category: place.type || service,
      date: new Date().toISOString(),
    });
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, count: leads.length, leads }),
  };
};
