import { pgTable, serial, text, numeric, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const candlesTable = pgTable(
  "candles",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    time: integer("time").notNull(),
    open: numeric("open", { precision: 18, scale: 8 }).notNull(),
    high: numeric("high", { precision: 18, scale: 8 }).notNull(),
    low: numeric("low", { precision: 18, scale: 8 }).notNull(),
    close: numeric("close", { precision: 18, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 18, scale: 8 }).notNull().default("1"),
    source: text("source").notNull().default("synthetic"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("candles_symbol_time_idx").on(t.symbol, t.time)],
);

export type Candle = typeof candlesTable.$inferSelect;
