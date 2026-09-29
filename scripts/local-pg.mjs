// Dev-only: a Postgres-wire-compatible server backed by PGlite, for running locally without Docker.
// DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create({ dataDir: "./.pglite" });
const server = new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1" });
await server.start();
console.log("PGlite listening on 127.0.0.1:5433");
process.on("SIGINT", async () => { await server.stop(); await db.close(); process.exit(0); });
