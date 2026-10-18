// Loaded first so every module sees the settings. In development the
// project's root .env provides ADMIN_API_KEY; Docker sets real variables.
import dotenv from "dotenv";

dotenv.config({ path: [".env", "../.env"], quiet: true });
