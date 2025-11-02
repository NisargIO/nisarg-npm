import { z } from "zod";

export const safeParseToNull =
  <T extends z.ZodType>(schema: T) =>
  (value: unknown) => {
    const result = schema.optional().safeParse(value);
    return result.success ? result.data : null;
  };