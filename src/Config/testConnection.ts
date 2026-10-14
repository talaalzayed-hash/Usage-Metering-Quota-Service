import { pool } from "./database.js";

async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    console.log("PostgreSQL connected successfully!");
    console.log("Database time:", result.rows[0].current_time);
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
  } finally {
    await pool.end();
  }
}

testConnection();