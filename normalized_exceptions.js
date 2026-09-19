#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, i) => [header, (values[i] || "").trim()])
    );
  });
}

function normalizeTerminal(value) {
  const raw = value.trim();
  const map = { "t3": "Terminal 3", "terminal 3": "Terminal 3" };
  return map[raw.toLowerCase()] || raw;
}

function normalizeCarrier(value) {
  return value.trim().toUpperCase();
}

function normalizeTimestamp(value) {
  const raw = value.trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) return raw;

  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }

  m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (m) {
    const [, mo, d, y, h, mi] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:00`;
  }

  return null;
}

function escapeCSV(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(records) {
  const headers = ["exception_id", "terminal", "event_type", "carrier_code", "event_ts"];
  return [
    headers.join(","),
    ...records.map(r => headers.map(h => escapeCSV(r[h])).join(","))
  ].join("\n") + "\n";
}

function normalizeExceptions(csvText) {
  const records = parseCSV(csvText);
  const cleanedRecords = [];
  const issues = [];
  const eventCounts = {};

  for (const record of records) {
    const terminal = normalizeTerminal(record.terminal || "");
    const carrier = normalizeCarrier(record.carrier_code || "");
    const eventType = (record.event_type || "").trim().toLowerCase();
    const normalizedTs = normalizeTimestamp(record.event_ts || "");
    const recordIssues = [];

    if (!terminal) recordIssues.push("missing terminal");
    if (!carrier) recordIssues.push("missing carrier_code");
    if (!normalizedTs) {
      recordIssues.push(`unrecognized timestamp format: "${record.event_ts || ""}"`);
    }

    cleanedRecords.push({
      exception_id: (record.exception_id || "").trim(),
      terminal,
      event_type: eventType,
      carrier_code: carrier,
      event_ts: normalizedTs || (record.event_ts || "").trim()
    });

    if (recordIssues.length) {
      issues.push({ exception_id: record.exception_id, issues: recordIssues });
    }

    if (eventType) eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
  }

  const summary = [
    "CLEANED EXCEPTION SUMMARY",
    "=========================",
    ...Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${type}: ${count}`),
    "",
    "RECORD NOTES",
    "============",
    ...(issues.length
      ? issues.map(x => `${x.exception_id}: ${x.issues.join("; ")}`)
      : ["All records were confidently cleaned."])
  ].join("\n") + "\n";

  return {
    cleanedRecords,
    normalizedCsv: toCSV(cleanedRecords),
    summary,
    issues,
    eventCounts
  };
}

function runCLI(inputFile) {
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const { normalizedCsv, summary } = normalizeExceptions(fs.readFileSync(inputFile, "utf8"));
  const outputDir = path.dirname(path.resolve(inputFile));
  const normalizedFile = path.join(outputDir, "normalized_exceptions.csv");
  const summaryFile = path.join(outputDir, "summary.txt");

  fs.writeFileSync(normalizedFile, normalizedCsv, "utf8");
  fs.writeFileSync(summaryFile, summary, "utf8");

  console.log(summary);
  console.log(`Output files:\n- ${normalizedFile}\n- ${summaryFile}`);
}

function startWebServer(port = 3000) {
  const publicDir = path.join(__dirname, "public");

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const htmlPath = path.join(publicDir, "index.html");
      if (!fs.existsSync(htmlPath)) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Missing public/index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }

    if (req.method === "POST" && req.url === "/normalize") {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        try {
          const csvText = Buffer.concat(chunks).toString("utf8");
          if (!csvText.trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No CSV content received." }));
            return;
          }

          const { normalizedCsv, summary } = normalizeExceptions(csvText);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ normalizedCsv, summary }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Failed to process CSV." }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`Exception normalizer running at http://localhost:${port}`);
    console.log("Upload a CSV file in your browser to clean it.");
  });
}

module.exports = { normalizeExceptions, parseCSV, toCSV };

if (require.main === module) {
  const inputFile = process.argv[2];

  if (!inputFile) {
    const port = Number(process.env.PORT) || 3000;
    startWebServer(port);
  } else if (inputFile === "--help" || inputFile === "-h") {
    console.log("Usage:");
    console.log("  node normalize_exceptions.js              Start web upload UI");
    console.log("  node normalize_exceptions.js exceptions.csv Process a file from the command line");
  } else {
    runCLI(inputFile);
  }
}
