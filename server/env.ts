import dotenv from "dotenv";

// Imported first by server/index.ts so every other module sees the environment.
dotenv.config({ path: process.env.ENV_FILE || ".env", quiet: true });
