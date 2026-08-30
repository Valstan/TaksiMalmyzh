import { Pool } from "pg";

// Пул подключений к схеме `track`.
//
// Отдельно от Payload намеренно: точки и поездки живут сырым SQL (M0.A §4.1 — коллекция
// Payload стоит 199 Б/точку против 127), а адаптер Payload про схему `track` не знает и
// знать не должен.
//
// Пул один на процесс и создаётся лениво: модуль импортируется и там, где база не нужна.

let pool: Pool | null = null;

export function trackPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URI;
    if (!connectionString) throw new Error("DATABASE_URI не задан");
    pool = new Pool({
      connectionString,
      // Бокс маленький и общий: держать много соединений незачем, приём точек
      // короткий и редкий.
      max: 4,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}
