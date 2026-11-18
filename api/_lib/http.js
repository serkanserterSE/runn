/** JSON yanıtı. cache: Cache-Control değeri (CDN/edge önbelleği sunucu yükünü düşürür). */
export function send(res, code, body, cache = 'no-store') {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

export const query = (req) => new URL(req.url, 'http://x').searchParams;

/** POST gövdesi (JSON, en fazla `limit` bayt). Vercel gövdeyi önceden ayrıştırabilir; yerel sunucuda akıştan okunur. */
export async function readJson(req, limit = 8192) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    try { return JSON.parse(req.body); } catch { return null; }
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) return null;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}
