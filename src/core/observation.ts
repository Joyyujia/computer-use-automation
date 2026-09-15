import { z } from "zod";

export const observedControlSchema = z.object({
  role: z.string(),
  name: z.string(),
  tag: z.string(),
  type: z.string().optional(),
  disabled: z.boolean(),
  value: z.string().optional()
});

export const observationSchema = z.object({
  url: z.string(),
  title: z.string(),
  visibleText: z.string(),
  controls: z.array(observedControlSchema),
  alerts: z.array(z.string()),
  screenshotPath: z.string().optional()
});

export type Observation = z.infer<typeof observationSchema>;
