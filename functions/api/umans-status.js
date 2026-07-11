// Cloudflare Pages Function — proxy to Umans AI status API.
// The UMANS_API_KEY lives in the Cloudflare Pages dashboard (Settings → Environment variables).
// This function reads it from context.env and strips the key before returning data,
// so the public-facing endpoint never leaks credentials.
//
// Called by: scripts/fetch-performance.mjs
// Public URL: https://tokenwatch.wyrdwerk.com/api/umans-status

export async function onRequestGet(context) {
  const key = context.env.UMANS_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'UMANS_API_KEY not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const upstream = await fetch('https://api.code.umans.ai/v1/status', {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Umans API returned ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
