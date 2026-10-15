import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");
const dataPath = process.env.DB_PATH || path.join(projectRoot, "data", "campus-atlas.sqlite");
const port = Number(process.env.PORT || 3000);
const deviceToken = process.env.DEVICE_API_TOKEN || "";

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
const database = new Database(dataPath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS measurements (
    record_id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    timestamp_source TEXT NOT NULL DEFAULT 'device',
    uptime_ms INTEGER,
    co2_ppm INTEGER NOT NULL,
    scd_temp_c REAL,
    scd_humidity_pct REAL,
    sht_temp_c REAL,
    sht_humidity_pct REAL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS measurements_location_captured_idx
    ON measurements(location_id, captured_at DESC);
  CREATE INDEX IF NOT EXISTS measurements_location_cursor_idx
    ON measurements(location_id, captured_at DESC, record_id DESC);
  CREATE INDEX IF NOT EXISTS measurements_device_received_idx
    ON measurements(device_id, received_at DESC);
  CREATE TABLE IF NOT EXISTS device_status (
    device_id TEXT PRIMARY KEY NOT NULL,
    location_id TEXT NOT NULL,
    last_handshake_at TEXT NOT NULL,
    firmware_version TEXT,
    uptime_ms INTEGER,
    sd_ready INTEGER,
    scd_ready INTEGER,
    sht_ready INTEGER,
    clock_ready INTEGER
  );
`);

const handshakeTimeoutMs = 300_000;
const saveHandshake = database.prepare(`
  INSERT INTO device_status (device_id, location_id, last_handshake_at, firmware_version,
    uptime_ms, sd_ready, scd_ready, sht_ready, clock_ready)
  VALUES (@device_id, @location_id, @last_handshake_at, @firmware_version,
    @uptime_ms, @sd_ready, @scd_ready, @sht_ready, @clock_ready)
  ON CONFLICT(device_id) DO UPDATE SET location_id=excluded.location_id,
    last_handshake_at=excluded.last_handshake_at, firmware_version=excluded.firmware_version,
    uptime_ms=excluded.uptime_ms, sd_ready=excluded.sd_ready, scd_ready=excluded.scd_ready,
    sht_ready=excluded.sht_ready, clock_ready=excluded.clock_ready
`);

const insertReading = database.prepare(`
  INSERT INTO measurements (
    record_id, device_id, location_id, captured_at, timestamp_source, uptime_ms,
    co2_ppm, scd_temp_c, scd_humidity_pct, sht_temp_c, sht_humidity_pct, received_at
  ) VALUES (
    @record_id, @device_id, @location_id, @captured_at, @timestamp_source, @uptime_ms,
    @co2_ppm, @scd_temp_c, @scd_humidity_pct, @sht_temp_c, @sht_humidity_pct, @received_at
  ) ON CONFLICT(record_id) DO NOTHING
`);

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json({ limit: "48kb", type: "application/json" }));

function sendJson(response, status, data) {
  response.status(status).json(data);
}

function equalSecrets(supplied, expected) {
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function isAuthorized(request) {
  if (!deviceToken) return false;
  const authorization = request.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  return equalSecrets(authorization.slice(7), deviceToken);
}

function validIdentifier(value, maxLength = 64) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && /^[a-zA-Z0-9._:-]+$/.test(value);
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return undefined;
  return value;
}

function normalizeReading(input, receivedAt) {
  if (!input || typeof input !== "object") return null;
  if (!validIdentifier(input.record_id, 96)) return null;
  if (!validIdentifier(input.device_id, 64)) return null;
  if (!validIdentifier(input.location_id, 32)) return null;

  const co2 = optionalNumber(input.co2_ppm, 250, 40000);
  const scdTemperature = optionalNumber(input.scd_temp_c, -40, 125);
  const scdHumidity = optionalNumber(input.scd_humidity_pct, 0, 100);
  const shtTemperature = optionalNumber(input.sht_temp_c, -40, 125);
  const shtHumidity = optionalNumber(input.sht_humidity_pct, 0, 100);
  if (
    co2 === undefined || !Number.isInteger(co2) ||
    scdTemperature === undefined || scdHumidity === undefined ||
    shtTemperature === undefined || shtHumidity === undefined
  ) return null;

  const parsed = typeof input.captured_at === "string" ? Date.parse(input.captured_at) : NaN;
  const hasDeviceTime = Number.isFinite(parsed);
  const uptimeMs = Number.isSafeInteger(input.uptime_ms) && input.uptime_ms >= 0 ? input.uptime_ms : null;

  return {
    record_id: input.record_id,
    device_id: input.device_id,
    location_id: input.location_id,
    captured_at: hasDeviceTime ? new Date(parsed).toISOString() : receivedAt,
    timestamp_source: hasDeviceTime ? "device" : "received",
    uptime_ms: uptimeMs,
    co2_ppm: co2,
    scd_temp_c: scdTemperature,
    scd_humidity_pct: scdHumidity,
    sht_temp_c: shtTemperature,
    sht_humidity_pct: shtHumidity,
    received_at: receivedAt,
  };
}

app.get("/api/health", (_request, response) => {
  try {
    database.prepare("SELECT 1").get();
    sendJson(response, 200, {
      ok: true,
      database: "ready",
      deviceWriteConfigured: Boolean(deviceToken),
      now: new Date().toISOString(),
    });
  } catch {
    sendJson(response, 503, { ok: false, error: "database_unavailable" });
  }
});

app.post("/api/device/handshake", (request, response) => {
  if (!isAuthorized(request)) {
    return sendJson(response, deviceToken ? 401 : 503, {
      ok: false,
      error: deviceToken ? "unauthorized" : "device_token_not_configured",
    });
  }
  const input = request.body;
  // Legacy firmware sends {}; keep its connectivity probe working without
  // attributing that anonymous request to an arbitrary device.
  const legacy = input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0;
  if (!legacy && (
    !input || !validIdentifier(input.device_id) || !validIdentifier(input.location_id, 32) ||
    (input.firmware_version !== undefined && !validIdentifier(input.firmware_version, 80)) ||
    (input.uptime_ms !== undefined && (!Number.isSafeInteger(input.uptime_ms) || input.uptime_ms < 0)) ||
    ["sd_ready", "scd_ready", "sht_ready", "clock_ready"].some(key => input[key] !== undefined && typeof input[key] !== "boolean")
  )) return sendJson(response, 400, { ok: false, error: "invalid_device_status" });
  try {
    database.prepare("SELECT 1").get();
    if (!legacy) {
      const flag = key => typeof input[key] === "boolean" ? Number(input[key]) : null;
      saveHandshake.run({
        device_id: input.device_id, location_id: input.location_id,
        last_handshake_at: new Date().toISOString(), firmware_version: input.firmware_version ?? null,
        uptime_ms: input.uptime_ms ?? null, sd_ready: flag("sd_ready"),
        scd_ready: flag("scd_ready"), sht_ready: flag("sht_ready"), clock_ready: flag("clock_ready"),
      });
    }
    return response.status(204).end();
  } catch {
    return sendJson(response, 503, { ok: false, error: "database_unavailable" });
  }
});

app.get("/api/devices", (_request, response) => {
  const now = Date.now();
  const devices = database.prepare(`
    WITH uploads AS (
      SELECT device_id, MAX(received_at) AS last_upload_at, COUNT(*) AS record_count
      FROM measurements GROUP BY device_id
    ), ids AS (
      SELECT device_id FROM device_status UNION SELECT device_id FROM uploads
    )
    SELECT ids.device_id,
      COALESCE(s.location_id, (SELECT location_id FROM measurements m WHERE m.device_id=ids.device_id ORDER BY received_at DESC LIMIT 1)) AS location_id,
      s.last_handshake_at, s.firmware_version, s.uptime_ms,
      s.sd_ready, s.scd_ready, s.sht_ready, s.clock_ready,
      u.last_upload_at, COALESCE(u.record_count, 0) AS record_count
    FROM ids LEFT JOIN device_status s ON s.device_id=ids.device_id
      LEFT JOIN uploads u ON u.device_id=ids.device_id ORDER BY ids.device_id
  `).all().map(row => ({
    ...row,
    handshake_status: !row.last_handshake_at ? "unknown"
      : now - Date.parse(row.last_handshake_at) < handshakeTimeoutMs ? "online" : "expired",
    ...Object.fromEntries(["sd_ready", "scd_ready", "sht_ready", "clock_ready"].map(key => [key, row[key] === null ? null : Boolean(row[key])])),
  }));
  sendJson(response, 200, { ok: true, devices, serverTime: new Date(now).toISOString(), handshakeTimeoutMs });
});

app.get("/api/readings", (request, response) => {
  const locationId = String(request.query.location || "M1");
  const hours = Number(request.query.hours || 24);
  const allowedHours = new Set([1, 6, 24, 168]);
  if (!validIdentifier(locationId, 32) || !allowedHours.has(hours)) {
    return sendJson(response, 400, { ok: false, error: "invalid_query" });
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const coverage = database.prepare(`
    SELECT MIN(captured_at) AS first_at, MAX(captured_at) AS last_at, COUNT(*) AS total
      FROM measurements WHERE location_id = ? AND captured_at >= ?
  `).get(locationId, since);
  const raw = coverage.total <= 480;
  const spanSeconds = Math.max(1, (Date.parse(coverage.last_at) - Date.parse(coverage.first_at)) / 1000 || 1);
  const bucketSeconds = raw ? 0 : [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 86400].find(value => value >= spanSeconds / 400) || 86400;
  const latest = database.prepare(`
    SELECT record_id, device_id, location_id, captured_at, timestamp_source,
           co2_ppm, scd_temp_c, scd_humidity_pct, sht_temp_c, sht_humidity_pct,
           received_at
      FROM measurements
     WHERE location_id = ?
     ORDER BY captured_at DESC, received_at DESC
     LIMIT 1
  `).get(locationId) || null;

  const readings = raw ? database.prepare(`
    SELECT record_id, device_id, location_id, captured_at, timestamp_source, uptime_ms,
           co2_ppm, scd_temp_c, scd_humidity_pct, sht_temp_c, sht_humidity_pct,
           received_at, 1 AS sample_count
      FROM measurements
     WHERE location_id = ? AND captured_at >= ?
     ORDER BY captured_at DESC, record_id DESC LIMIT 480
  `).all(locationId, since).reverse() : database.prepare(`
    SELECT MAX(captured_at) AS captured_at,
           AVG(co2_ppm) AS co2_ppm,
           AVG(scd_temp_c) AS scd_temp_c,
           AVG(scd_humidity_pct) AS scd_humidity_pct,
           AVG(sht_temp_c) AS sht_temp_c,
           AVG(sht_humidity_pct) AS sht_humidity_pct,
           COUNT(*) AS sample_count
      FROM measurements
     WHERE location_id = ? AND captured_at >= ?
     GROUP BY CAST(CAST(strftime('%s', captured_at) AS INTEGER) / ? AS INTEGER)
     ORDER BY MAX(captured_at) DESC
     LIMIT 480
  `).all(locationId, since, bucketSeconds).reverse();

  const sampleCount = database.prepare(
    "SELECT COUNT(*) AS total FROM measurements WHERE location_id = ?",
  ).get(locationId).total;

  sendJson(response, 200, {
    ok: true,
    locationId,
    hours,
    latest,
    readings,
    sampleCount,
    rangeSampleCount: coverage.total,
    aggregation: { mode: raw ? "raw" : "mean", bucketSeconds },
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/records", (request, response) => {
  const locationId = String(request.query.location || "M1");
  const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
  if (!validIdentifier(locationId, 32) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    return sendJson(response, 400, { ok: false, error: "invalid_query" });
  }

  let cursor = null;
  if (request.query.cursor !== undefined) {
    const encodedCursor = String(request.query.cursor);
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(encodedCursor)) {
      return sendJson(response, 400, { ok: false, error: "invalid_cursor" });
    }
    try {
      const decoded = JSON.parse(Buffer.from(encodedCursor, "base64url").toString("utf8"));
      if (
        !decoded || typeof decoded !== "object" ||
        typeof decoded.capturedAt !== "string" || !Number.isFinite(Date.parse(decoded.capturedAt)) ||
        !validIdentifier(decoded.recordId, 96)
      ) return sendJson(response, 400, { ok: false, error: "invalid_cursor" });
      cursor = { capturedAt: new Date(decoded.capturedAt).toISOString(), recordId: decoded.recordId };
    } catch {
      return sendJson(response, 400, { ok: false, error: "invalid_cursor" });
    }
  }

  const rows = cursor
    ? database.prepare(`
        SELECT record_id, device_id, location_id, captured_at, timestamp_source, uptime_ms,
               co2_ppm, scd_temp_c, scd_humidity_pct, sht_temp_c, sht_humidity_pct, received_at
          FROM measurements
         WHERE location_id = ?
           AND (captured_at < ? OR (captured_at = ? AND record_id < ?))
         ORDER BY captured_at DESC, record_id DESC
         LIMIT ?
      `).all(locationId, cursor.capturedAt, cursor.capturedAt, cursor.recordId, limit + 1)
    : database.prepare(`
        SELECT record_id, device_id, location_id, captured_at, timestamp_source, uptime_ms,
               co2_ppm, scd_temp_c, scd_humidity_pct, sht_temp_c, sht_humidity_pct, received_at
          FROM measurements
         WHERE location_id = ?
         ORDER BY captured_at DESC, record_id DESC
         LIMIT ?
      `).all(locationId, limit + 1);

  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit);
  const lastRecord = records.at(-1);
  const nextCursor = hasMore && lastRecord
    ? Buffer.from(JSON.stringify({ capturedAt: lastRecord.captured_at, recordId: lastRecord.record_id })).toString("base64url")
    : null;
  const totalCount = database.prepare(
    "SELECT COUNT(*) AS total FROM measurements WHERE location_id = ?",
  ).get(locationId).total;

  sendJson(response, 200, {
    ok: true,
    locationId,
    records,
    page: { limit, hasMore, nextCursor },
    totalCount,
    serverTime: new Date().toISOString(),
  });
});

app.post("/api/readings", (request, response) => {
  if (!isAuthorized(request)) {
    return sendJson(response, deviceToken ? 401 : 503, {
      ok: false,
      error: deviceToken ? "unauthorized" : "device_token_not_configured",
    });
  }
  if (!request.is("application/json")) {
    return sendJson(response, 415, { ok: false, error: "json_required" });
  }
  if (!Array.isArray(request.body?.readings) || request.body.readings.length < 1 || request.body.readings.length > 25) {
    return sendJson(response, 400, { ok: false, error: "batch_size_must_be_1_to_25" });
  }

  const receivedAt = new Date().toISOString();
  const readings = request.body.readings.map((input) => normalizeReading(input, receivedAt));
  if (readings.some((reading) => reading === null)) {
    return sendJson(response, 400, { ok: false, error: "invalid_reading" });
  }

  try {
    const saveBatch = database.transaction((rows) => {
      for (const row of rows) insertReading.run(row);
    });
    saveBatch(readings);
    return sendJson(response, 200, {
      ok: true,
      accepted: readings.length,
      recordIds: readings.map((reading) => reading.record_id),
      receivedAt,
    });
  } catch (error) {
    console.error("Unable to save sensor batch:", error.message);
    return sendJson(response, 503, { ok: false, error: "database_unavailable" });
  }
});

app.use(express.static(path.join(projectRoot, "dist"), { index: false, maxAge: "1h" }));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(projectRoot, "dist", "index.html"));
});

app.use((error, _request, response, _next) => {
  if (error?.type === "entity.too.large") {
    return sendJson(response, 413, { ok: false, error: "payload_too_large" });
  }
  if (error instanceof SyntaxError) {
    return sendJson(response, 400, { ok: false, error: "invalid_json" });
  }
  console.error("Request failed:", error?.message || "unknown error");
  return sendJson(response, 500, { ok: false, error: "internal_error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Campus Atlas listening on 0.0.0.0:${port}`);
  console.log(`Device write API: ${deviceToken ? "protected and configured" : "protected but DEVICE_API_TOKEN is missing"}`);
});
