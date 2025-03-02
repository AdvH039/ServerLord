require("./otel");
const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const { metrics } = require("@opentelemetry/api");
const { queryLatencyHistogram } = require("./otel"); 

const app = express();
const port = 3000;

app.use(bodyParser.json());

const dbConfig = {
  user: "postgres",
  host: "localhost",
  database: "server-lord-db",
  password: "1234",
  port: 5432,
};

const pool = new Pool(dbConfig);

pool.connect()
  .then(() => console.log("Connected to the database"))
  .catch(err => console.error("Database connection error:", err.stack));


const meter = metrics.getMeter("server-lord-meter");

// Histogram for HTTP Request Latency
const requestLatencyHistogram = meter.createHistogram("http.request.duration", {
  description: "HTTP request duration in seconds",
  unit: "s",
  boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
});

// Middleware to measure request duration
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const duration = process.hrtime(start);
    const durationInSeconds = duration[0] + duration[1] / 1e9;

    requestLatencyHistogram.record(durationInSeconds, {
      route: req.originalUrl,
      method: req.method,
      status_code: res.statusCode,
    });

    console.log(`Request ${req.method} ${req.originalUrl} took ${durationInSeconds.toFixed(3)}s`);
  });

  next();
});

// Function to measure query latency
async function measureQueryLatency(query, params = []) {
  const start = process.hrtime();

  try {
    const result = await pool.query(query, params);

    const duration = process.hrtime(start);
    const totalLatencyMs = duration[0] * 1000 + duration[1] / 1e6; // Convert to milliseconds

    queryLatencyHistogram.record(totalLatencyMs, { query });

    console.log(`Query executed in ${totalLatencyMs.toFixed(3)}ms: ${query}`);

    return result;
  } catch (err) {
    console.error(`Database error: ${err}`);
    throw err;
  }
}


app.get("/", (req, res) => {
  res.send("Server is running");
});


app.post("/cron_jobs", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Job name is required" });
  }

  try {
    const result = await measureQueryLatency(
      `INSERT INTO cron_jobs (name) VALUES ($1) RETURNING *`,
      [name]
    );

    res.status(201).json({ message: "Job added successfully", job: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/cron_jobs", async (req, res) => {
  try {
    const result = await measureQueryLatency(
      "SELECT * FROM cron_jobs ORDER BY last_ping DESC"
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});


async function initDB() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS cron_jobs (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(50) DEFAULT 'active'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cron_jobs_last_ping ON cron_jobs(last_ping)`
  ];

  for (const query of queries) {
    try {
      await measureQueryLatency(query);
      console.log(`Executed query: ${query}`);
    } catch (err) {
      console.error(`Error executing query: ${query}`, err);
      throw err;
    }
  }
}


app.post("/ping", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).send("Missing job name");
  }

  try {
    const {result, totalLatencyMs} = await measureQueryLatency(
      `INSERT INTO cron_jobs (name, last_ping, status) VALUES ($1, CURRENT_TIMESTAMP, 'active') RETURNING id, last_ping;`,
      [name]
    );

    res.json({
      message: "Ping received",
      jobId: result.rows[0].id,
      lastPing: result.rows[0].last_ping,
      latencyMs: totalLatencyMs.toFixed(3),
    });
  } catch (err) {
    res.status(500).send("Failed to process ping");
  }
});


async function startServer() {
  try {
    await initDB();
    app.listen(port, () => {
      console.log(`Server running on port: ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server due to database initialization error:", error);
  }
}

startServer();
