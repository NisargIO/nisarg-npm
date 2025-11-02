import { z } from "zod";

/**
 * Safely parses a value using the provided Zod schema.
 * If parsing fails, it returns `null` instead of throwing an error.
 *
 * @template T - The Zod schema type
 * @param schema - The Zod schema to use for parsing
 * @returns A function that accepts an unknown value and returns the parsed value (or null if invalid)
 */
export const safeParseToNull =
  <T extends z.ZodTypeAny>(schema: T) =>
  (value: unknown) => {
    const result = schema.optional().safeParse(value);
    return result.success ? result.data : null;
  };