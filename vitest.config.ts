import { vitestConfig } from '@st-api/config';
import { InlineConfig } from 'vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default defineConfig(async (env) =>
  mergeConfig(await vitestConfig(env), {
    test: {} satisfies InlineConfig,
  }),
);
