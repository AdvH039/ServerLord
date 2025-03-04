import "./otel.js";
import dotenv from "dotenv";
dotenv.config();

import { metrics } from "@opentelemetry/api";
import pkg from 'pg';
const { Pool } = pkg;

import Fastify from "fastify";

const fastifyApp = Fastify({
	logger: true,
});

const meter = metrics.getMeter("nodejs-metrics-demo");

const requestDurHistogram = meter.createHistogram(
    "http.client.request.duration",
    {
        description: "The duration of an outgoing HTTP request.",
        unit: "s",
        advice: {
            explicitBucketBoundaries: [
                0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
            ],
        },
    },
);


const dbConfig = {
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "postgres-db",
    database: process.env.DB_NAME || "server-lord-db",
    password: process.env.DB_PASSWORD || "1234",
    port: process.env.DB_PORT || 5432,
};

const pool = new Pool(dbConfig);

pool.connect()
    .then(() => console.log("Connected to the database"))
    .catch(err => console.error("Database connection error:", err.stack));



fastifyApp.addHook("onRequest", async (req, res) => {
    
    req.startTime = process.hrtime();
});

fastifyApp.addHook("onResponse", async (req, res) => {
    if (!req.startTime) return;

    const duration = process.hrtime(req.startTime);
    const durationInSeconds = duration[0] + duration[1] / 1e9;
    requestDurHistogram.record(durationInSeconds, {
        route: req.routerPath || req.url,
        method: req.method,
        status_code: res.statusCode,
    });
    console.log(`Request ${req.method} ${req.url} took ${durationInSeconds.toFixed(3)}s`);
});


async function measureQueryLatency(query, params = []) {
    const start = process.hrtime();
    try {
        const result = await pool.query(query, params);
        const duration = process.hrtime(start);
        const totalLatencyMs = duration[0] * 1000 + duration[1] / 1e6;
        console.log(`Query executed in ${totalLatencyMs.toFixed(3)}ms: ${query}`);
        return result;
    } catch (err) {
        console.error(`Database error: ${err}`);
        throw err;
    }
}


fastifyApp.get("/", (req, reply) => {
	reply.send("Server is running");
});


fastifyApp.get("/posts", async (_request, reply) => {
    const response = await fetch("https://jsonplaceholder.typicode.com/posts");
    reply.send(await response.json());
});

fastifyApp.post("/cron_jobs", async (req, reply) => {
    const { name } = req.body;
    if (!name) {
        return reply.status(400).send({ error: "Job name is required" });
    }
    try {
        const result = await measureQueryLatency(
            `INSERT INTO cron_jobs (name) VALUES ($1) RETURNING *`,
            [name]
        );
        reply.status(201).send({ message: "Job added successfully", job: result.rows[0] });
    } catch (err) {
        reply.status(500).send({ error: "Database error" });
    }
});

fastifyApp.get("/cron_jobs", async (req, reply) => {
    try {
        const result = await measureQueryLatency(
            "SELECT * FROM cron_jobs ORDER BY last_ping DESC"
        );
        reply.send(result.rows);
    } catch (err) {
        reply.status(500).send({ error: "Database error" });
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

fastifyApp.post("/ping", async (req, reply) => {
    const { name } = req.body;
    if (!name) {
        return reply.status(400).send("Missing job name");
    }
    try {
        const result = await measureQueryLatency(
            `INSERT INTO cron_jobs (name, last_ping, status) VALUES ($1, CURRENT_TIMESTAMP, 'active') RETURNING id, last_ping;`,
            [name]
        );
        reply.send({
            message: "Ping received",
            jobId: result.rows[0].id,
            lastPing: result.rows[0].last_ping,
        });
    } catch (err) {
        reply.status(500).send("Failed to process ping");
    }
});

async function startServer() {
    try {
        await initDB();
        fastifyApp.listen({ port: 8000, host: "0.0.0.0" }, (err, address) => {
            if (err) {
                console.error(err);
                process.exit(1);
            }
            console.log(`Server running at ${address}`);
        });
    } catch (error) {
        console.error("Failed to start server due to database initialization error:", error);
    }
}

startServer();

