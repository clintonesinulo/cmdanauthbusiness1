/**
 * CMDA-NAUTH Sync API — Vercel Serverless Function
 * Upstash Redis via REST (no packages needed).
 * Vercel auto-injects: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */

const memStore = {};

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Parse raw request body (Vercel does NOT auto-parse JSON) ──────────────
function parseBody(req) {
    return new Promise((resolve) => {
        if (req.method === 'GET' || req.method === 'OPTIONS') return resolve({});
        // If Vercel already parsed it (happens sometimes)
        if (req.body && typeof req.body === 'object') return resolve(req.body);
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
        });
        req.on('error', () => resolve({}));
    });
}

// ── Upstash REST helpers ──────────────────────────────────────────────────
function upstashHeaders() {
    return { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` };
}

async function redisGet(key) {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const tok  = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !tok) return null;
    try {
        const res = await fetch(`${base}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${tok}` }
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json.result) return null;
        return JSON.parse(json.result);
    } catch(e) { return null; }
}

async function redisSet(key, value) {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const tok  = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !tok) return false;
    try {
        const res = await fetch(`${base}/set/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(JSON.stringify(value))
        });
        return res.ok;
    } catch(e) { return false; }
}

async function storeGet(id) {
    const val = await redisGet('cmda:' + id);
    return val !== null ? val : (memStore[id] || null);
}

async function storeSet(id, data) {
    const ok = await redisSet('cmda:' + id, data);
    memStore[id] = data; // always keep in-memory copy too
}

// ── Main handler ──────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Parse body for all non-GET requests
    const body = await parseBody(req);

    try {
        // ── GET: read store ──────────────────────────────────────────────
        if (req.method === 'GET') {
            const id = (req.query || {}).id;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const data = await storeGet(id);
            if (!data) return res.status(404).json({ error: 'Store not found' });
            return res.status(200).json({ id, data });
        }

        // ── POST: create store ───────────────────────────────────────────
        if (req.method === 'POST') {
            const id = generateId();
            await storeSet(id, body.data || {});
            return res.status(201).json({ id, created: true });
        }

        // ── PUT: update store ────────────────────────────────────────────
        if (req.method === 'PUT') {
            const { id, data } = body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            await storeSet(id, data || {});
            return res.status(200).json({ id, updated: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('[sync]', err);
        return res.status(500).json({ error: 'Server error', detail: err.message });
    }
};
