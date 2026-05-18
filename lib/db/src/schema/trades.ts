import { pgTable, bigserial, text, numeric, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Matches the actual Supabase trades table schema.
 * Key differences from a blank scaffold:
 *  - direction: DB CHECK allows CALL/PUT/BUY/SELL — map UP→CALL, DOWN→PUT in routes
 *  - outcome is stored as binary_result (WIN/LOSS/TIE/PUSH/VOID)
 *  - resolvedAt is stored as closed_at
 *  - createdAt maps to created_at (Drizzle snake_case conversion)
 */
export const tradesTable = pgTable("trades", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),                   // DB: CALL | PUT | BUY | SELL
  entryPrice: numeric("entry_price", { precision: 18, scale: 8 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 18, scale: 8 }),
  confidence: numeric("confidence", { precision: 18, scale: 4 }).notNull(),
  expirySeconds: integer("expiry_seconds").notNull().default(60),
  outcome: text("binary_result"),                           // DB column: binary_result (WIN|LOSS|TIE|PUSH|VOID)
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("closed_at", { withTimezone: true }),  // DB column: closed_at
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
