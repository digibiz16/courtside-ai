export const config = { runtime: 'edge' };
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
const rateLimits = new Map();
function isRateLimited(ip) {
  const today = new Date().toDateString();
  const rec = rateLimits.get(ip) || { date: today, count: 0 };
  if (rec.date !== today) { rateLimits.set(ip, { date: today, count: 1 }); return false; }
  if (rec.count >= 150) return true;
  rateLimits.set(ip, { ...rec, count: rec.count + 1 });
  return false;
}
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return new Response(JSON.stringify({ error: 'Daily limit reached.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...CORS } });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: CORS });
  let bodyText;
  try { bodyText = await req.text(); } catch { return new Response(JSON.stringify({ error: 'Could not read body' }), { status: 400, headers: CORS }); }
  let requestBody;
  try { requestBody = JSON.parse(bodyText); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }
  requestBody.model = 'claude-sonnet-4-6';
  if (!requestBody.max_tokens) requestBody.max_tokens = 1024;
  const isStreaming = requestBody.stream === true;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(requestBody),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(JSON.stringify({ error: `API error ${upstream.status}`, detail: errText }), { status: upstream.status, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    if (isStreaming && upstream.body) {
      return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
    }
    const data = await upstream.json();
    return new Response(JSON.stringify(data), { status: upstream.status, headers: { 'Content-Type': 'application/json', ...CORS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream failed', detail: err.message }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
  }
}
