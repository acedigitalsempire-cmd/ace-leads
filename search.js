// functions/search.js
// Cloudflare Pages Function — runs on Cloudflare's edge servers worldwide
// Proxies SerpApi so your API key is never exposed in the browser
// Export: onRequestPost (Cloudflare syntax, NOT exports.handler)

export async function onRequestPost(context) {
  const { request, env } = context;

  const SERP_KEY = env.SERP_API_KEY;
  if (!SERP_KEY) {
    return Response.json({ error: "SERP_API_KEY not set in Cloudflare environment variables." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { service, location } = body;
  if (!service || !location) {
    return Response.json({ error: "service and location are required." }, { status: 400 });
  }

  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-z]{2,}/gi;
  const BLACKLIST = [
    "sentry.io","example.com","noreply","no-reply","wixpress.com",
    "squarespace.com","google.com","yelp.com","facebook.com",
    "placeholder","test.com","domain.com","wordpress.com"
  ];

  function isValidEmail(email) {
    if (!email || email.length < 7) return false;
    const domain = email.split("@")[1]?.toLowerCase() || "";
    for (const b of BLACKLIST) {
      if (domain.includes(b) || email.toLowerCase().includes(b)) return false;
    }
    return /\.[a-z]{2,}$/.test(domain);
  }

  // Step 1: Search Google Maps
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
    return Response.json({ error: "SerpApi Maps request failed: " + err.message }, { status: 502 });
  }

  const leads = [];
  const seen = new Set();

  for (const place of mapResults) {
    // CORE RULE: skip if has website
    if (place.website || place.links?.website) continue;

    const key = place.place_id || (place.title + "|" + place.address);
    if (seen.has(key)) continue;
    seen.add(key);

    // Search for email via Google organic results
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

        // Check knowledge graph
        const kgText = JSON.stringify(sData.knowledge_graph || {});
        for (const e of (kgText.match(EMAIL_REGEX) || [])) {
          if (isValidEmail(e)) { email = e.toLowerCase(); break; }
        }

        // Check organic snippets
        if (!email) {
          const blob = (sData.organic_results || [])
            .map(r => [r.snippet || "", r.title || ""].join(" ")).join(" ");
          for (const e of (blob.match(EMAIL_REGEX) || [])) {
            if (isValidEmail(e)) { email = e.toLowerCase(); break; }
          }
        }
      } catch { /* skip failed query */ }
    }

    // CORE RULE: skip if no email found
    if (!email) continue;

    const reviews = parseInt(place.reviews || 0, 10);
    const rating  = parseFloat(place.rating || 0);
    let score = 35;
    if (rating >= 4.2) score -= 10;
    if (reviews >= 10) score -= 5;
    score = Math.max(0, Math.min(35, score));

    leads.push({
      id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name:     place.title || "Unknown Business",
      email,
      phone:    place.phone || null,
      address:  place.address || location,
      location,
      rating,
      reviews,
      score,
      category: place.type || service,
      date:     new Date().toISOString(),
    });
  }

  return Response.json({ success: true, count: leads.length, leads });
}
