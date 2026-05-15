/**
 * CMDA-NAUTH Sync API — Vercel Serverless Function
 * Uses Upstash Redis REST API directly (no npm install needed).
 * Environment variables auto-injected by Vercel when you connect Upstash:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const memStore = {}; // fallback if Redis not connected yet

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Upstash Redis via plain HTTP (no SDK needed) ──────────────────────────
async function redisGet(key) {
    const url  = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.result === null || json.result === undefined) return null;
    try { return JSON.parse(json.result); } catch(e) { return json.result; }
}

async function redisSet(key, value) {
    const url  = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return false;
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(JSON.stringify(value)) // double-stringify: Upstash stores as string
    });
    return res.ok;
}

// ── Storage wrappers with in-memory fallback ──────────────────────────────
async function storeGet(id) {
    const val = await redisGet('store:' + id);
    if (val !== null) return val;
    return memStore[id] || null;
}

async function storeSet(id, data) {
    const saved = await redisSet('store:' + id, data);
    if (!saved) memStore[id] = data; // fallback
}

// ── Vercel handler ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // GET /api/sync?id=xxx  — read store
        if (req.method === 'GET') {
            const id = req.query && req.query.id;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const data = await storeGet(id);
            if (!data) return res.status(404).json({ error: 'Store not found' });
            return res.status(200).json({ id, data });
        }

        // POST /api/sync  — create new store
        if (req.method === 'POST') {
            const body = req.body || {};
            if (body.action !== 'create') return res.status(400).json({ error: 'Invalid action' });
            const id = generateId();
            await storeSet(id, body.data || {});
            return res.status(201).json({ id, created: true });
        }

        // PUT /api/sync  — update store
        if (req.method === 'PUT') {
            const body = req.body || {};
            const { id, data } = body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const existing = await storeGet(id);
            if (!existing) return res.status(404).json({ error: 'Store not found' });
            await storeSet(id, data);
            return res.status(200).json({ id, updated: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[sync] error:', err);
        return res.status(500).json({ error: 'Server error', detail: err.message });
    }
};
