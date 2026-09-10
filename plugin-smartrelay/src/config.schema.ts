import { z } from 'zod';

export const configSchema = z
  .object({
    apiUrl: z.string().default(''),
    apiKey: z.string().default(''),
  })
  .passthrough()
  .default({});

export type SmartRelayConfig = z.infer<typeof configSchema>;
