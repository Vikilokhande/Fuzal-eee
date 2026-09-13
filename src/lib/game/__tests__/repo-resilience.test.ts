import { describe, it, expect, vi } from "vitest";
import { withDbRetry, isTransientDbError } from "../repo";

describe("Database Resilience & Gateway Timeout Recovery", () => {
  it("isTransientDbError detects Gateway Timeout and transient codes", () => {
    expect(isTransientDbError({ message: "Gateway Timeout" })).toBe(true);
    expect(isTransientDbError({ message: "504 Gateway Time-out" })).toBe(true);
    expect(isTransientDbError({ message: "Bad Gateway" })).toBe(true);
    expect(isTransientDbError({ message: "Service Unavailable" })).toBe(true);
    expect(isTransientDbError({ message: "fetch failed" })).toBe(true);
    expect(isTransientDbError({ message: "connect ETIMEDOUT" })).toBe(true);
    expect(isTransientDbError({ code: "504" })).toBe(true);

    // Permanent errors must not be flagged as transient
    expect(isTransientDbError({ message: "violates foreign key constraint" })).toBe(false);
    expect(isTransientDbError({ message: "duplicate key value" })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it("withDbRetry retries on Gateway Timeout and succeeds on subsequent attempt", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { data: null, error: { message: "Gateway Timeout" } };
      }
      return { data: { id: "lobby-123" }, error: null };
    });

    const result = await withDbRetry<{ id: string }>(
      "test_upsert_lobby",
      mockDbCall,
      3,
      10, // fast delay for test
    );

    expect(callCount).toBe(2);
    expect(result.data).toEqual({ id: "lobby-123" });
    expect(result.error).toBeNull();
  });

  it("withDbRetry retries on transient thrown exceptions and recovers", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("TypeError: fetch failed");
      }
      return { data: [{ id: "p1" }], error: null };
    });

    const result = await withDbRetry<any[]>(
      "test_get_players",
      mockDbCall,
      3,
      10,
    );

    expect(callCount).toBe(2);
    expect(result.data).toEqual([{ id: "p1" }]);
    expect(result.error).toBeNull();
  });

  it("withDbRetry does not retry permanent errors (fails immediately)", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      return { data: null, error: { message: "duplicate key value violates unique constraint" } };
    });

    const result = await withDbRetry<any>(
      "test_constraint_error",
      mockDbCall,
      3,
      10,
    );

    // Permanent error must NOT be retried 3 times
    expect(callCount).toBe(1);
    expect(result.error?.message).toContain("duplicate key");
  });
});
