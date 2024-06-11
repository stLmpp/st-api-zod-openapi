import { SchemaObject } from 'openapi3-ts/oas30';
import { z, ZodTypeDef } from 'zod';

import { extendApi } from './zod-openapi.js';

declare module 'zod' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface ZodSchema<
    Output = any,
    Def extends ZodTypeDef = ZodTypeDef,
    Input = Output,
  > {
    openapi<T extends ZodSchema<Output, Def, Input>>(
      this: T,
      metadata: Partial<SchemaObject>,
    ): T;
  }
}

export function extendZodWithOpenApi(zod: typeof z, forceOverride = false) {
  if (!forceOverride && zod.ZodSchema.prototype.openapi !== undefined) {
    // This zod instance is already extended with the required methods,
    // doing it again will just result in multiple wrapper methods for
    // `optional` and `nullable`
    return;
  }

  zod.ZodSchema.prototype.openapi = function (
    metadata?: Partial<SchemaObject>,
  ) {
    return extendApi(this, metadata);
  };
}
