import { mergeAndConcat } from 'merge-anything';
import type { SchemaObject } from 'openapi3-ts/oas30';
import {
  AnyZodObject,
  ZodAny,
  ZodArray,
  ZodBigInt,
  ZodBoolean,
  ZodBranded,
  ZodCatch,
  ZodDate,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodDiscriminatedUnionOption,
  ZodEffects,
  ZodEnum,
  ZodIntersection,
  ZodLiteral,
  ZodNativeEnum,
  ZodNever,
  ZodNull,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodReadonly,
  ZodRecord,
  ZodSchema,
  ZodString,
  ZodTransformer,
  ZodTypeAny,
  ZodUnion,
  ZodUnknown,
} from 'zod';

type CustomSchemaObject = SchemaObject & { hideDefinitions?: string[] };

export interface OpenApiZodAny extends ZodTypeAny {
  metaOpenApi?: CustomSchemaObject | CustomSchemaObject[];
}

interface OpenApiZodAnyObject extends AnyZodObject {
  metaOpenApi?: CustomSchemaObject | CustomSchemaObject[];
}

interface ParsingArgs<T> {
  zodRef: T;
  schemas: CustomSchemaObject[];
  useOutput?: boolean;
  hideDefinitions?: string[];
}

const parseTypeofObject: Record<string, SchemaObject> = {
  string: {
    type: 'string',
  },
  number: {
    type: 'number',
  },
  symbol: {
    type: 'string',
  },
  bigint: {
    type: 'integer',
    format: 'int64',
  },
  boolean: {
    type: 'boolean',
  },
  undefined: {},
  object: {},
  function: {},
  null: {
    nullable: true,
  },
};

function parseTypeof(
  type:
    | 'string'
    | 'number'
    | 'symbol'
    | 'bigint'
    | 'boolean'
    | 'undefined'
    | 'object'
    | 'function'
    | 'null'
    | (string & {}),
): SchemaObject {
  return parseTypeofObject[type] ?? {};
}

export function extendApi<T extends OpenApiZodAny>(
  schema: T,
  schemaObject: CustomSchemaObject = {},
): T {
  const This = (schema as any).constructor;
  const newSchema = new This(schema._def);
  newSchema.metaOpenApi = Object.assign(
    {},
    schema.metaOpenApi || {},
    schemaObject,
  );
  return newSchema;
}

function iterateZodObject({
  zodRef,
  useOutput,
  hideDefinitions,
}: ParsingArgs<OpenApiZodAnyObject>) {
  return Object.keys(zodRef.shape)
    .filter((key) => hideDefinitions?.includes(key) === false)
    .reduce(
      (carry, key) => ({
        ...carry,
        [key]: generateSchema(zodRef.shape[key], useOutput),
      }),
      {} as Record<string, SchemaObject>,
    );
}

function parseTransformation({
  zodRef,
  schemas,
  useOutput,
}: ParsingArgs<ZodTransformer<never> | ZodEffects<never>>): SchemaObject {
  const input = generateSchema(zodRef._def.schema, useOutput);

  let output = 'undefined';
  if (useOutput && zodRef._def.effect) {
    const effect =
      zodRef._def.effect.type === 'transform' ? zodRef._def.effect : null;
    if (effect && 'transform' in effect) {
      try {
        output = typeof effect.transform(
          ['integer', 'number'].includes(`${input.type}`)
            ? 0
            : 'string' === input.type
              ? ''
              : 'boolean' === input.type
                ? false
                : 'object' === input.type
                  ? {}
                  : 'null' === input.type
                    ? null
                    : 'array' === input.type
                      ? []
                      : undefined,
          { addIssue: () => {}, path: [] },
        );
      } catch {
        /**/
      }
    }
  }
  return mergeWithDescription(
    zodRef,
    {
      ...(zodRef.description ? { description: zodRef.description } : {}),
      ...input,
      ...(['number', 'string', 'boolean', 'null'].includes(output)
        ? parseTypeof(output)
        : {}),
    },
    ...schemas,
  );
}

function parseString({
  zodRef,
  schemas,
}: ParsingArgs<ZodString>): SchemaObject {
  const baseSchema: SchemaObject = {
    type: 'string',
  };
  const { checks = [] } = zodRef._def;
  for (const item of checks) {
    switch (item.kind) {
      case 'email': {
        baseSchema.format = 'email';
        break;
      }
      case 'uuid': {
        baseSchema.format = 'uuid';
        break;
      }
      case 'cuid': {
        baseSchema.format = 'cuid';
        break;
      }
      case 'url': {
        baseSchema.format = 'uri';
        break;
      }
      case 'datetime': {
        baseSchema.format = 'date-time';
        break;
      }
      case 'length': {
        baseSchema.minLength = item.value;
        baseSchema.maxLength = item.value;
        break;
      }
      case 'max': {
        baseSchema.maxLength = item.value;
        break;
      }
      case 'min': {
        baseSchema.minLength = item.value;
        break;
      }
      case 'regex': {
        baseSchema.pattern = item.regex.source;
        break;
      }
    }
  }
  return mergeWithDescription(zodRef, baseSchema, ...schemas);
}

function parseNumber({
  zodRef,
  schemas,
}: ParsingArgs<ZodNumber>): SchemaObject {
  const baseSchema: SchemaObject = {
    type: 'number',
  };
  const { checks = [] } = zodRef._def;
  for (const item of checks) {
    switch (item.kind) {
      case 'max': {
        baseSchema.maximum = item.value;
        if (!item.inclusive) {
          baseSchema.exclusiveMaximum = true;
        }
        break;
      }
      case 'min': {
        baseSchema.minimum = item.value;
        if (!item.inclusive) {
          baseSchema.exclusiveMinimum = true;
        }
        break;
      }
      case 'int': {
        baseSchema.type = 'integer';
        break;
      }
      case 'multipleOf': {
        baseSchema.multipleOf = item.value;
      }
    }
  }
  return mergeWithDescription(zodRef, baseSchema, ...schemas);
}

function getExcludedDefinitionsFromSchema(
  schemas: CustomSchemaObject[],
): string[] {
  const excludedDefinitions = [];
  for (const schema of schemas) {
    if (Array.isArray(schema.hideDefinitions)) {
      excludedDefinitions.push(...schema.hideDefinitions);
    }
  }

  return excludedDefinitions;
}

function parseObject({
  zodRef,
  schemas,
  useOutput,
  hideDefinitions,
}: ParsingArgs<
  ZodObject<never, 'passthrough' | 'strict' | 'strip'>
>): SchemaObject {
  let additionalProperties: SchemaObject['additionalProperties'];

  // `catchall` obviates `strict`, `strip`, and `passthrough`
  if (
    !(
      zodRef._def.catchall instanceof ZodNever ||
      zodRef._def.catchall?._def.typeName === 'ZodNever'
    )
  ) {
    additionalProperties = generateSchema(zodRef._def.catchall, useOutput);
  } else if (zodRef._def.unknownKeys === 'passthrough') {
    additionalProperties = true;
  } else if (zodRef._def.unknownKeys === 'strict') additionalProperties = false;

  // So that `undefined` values don't end up in the schema and be weird
  additionalProperties =
    additionalProperties == null ? {} : { additionalProperties };

  const requiredProperties = Object.keys(zodRef.shape).filter((key) => {
    const item = (zodRef as AnyZodObject).shape[key];
    return (
      !(
        item.isOptional() ||
        item instanceof ZodDefault ||
        item._def.typeName === 'ZodDefault'
      ) && !(item instanceof ZodNever || item._def.typeName === 'ZodDefault')
    );
  });

  const required =
    requiredProperties.length > 0 ? { required: requiredProperties } : {};

  return mergeWithDescription(
    zodRef,
    {
      type: 'object',
      properties: iterateZodObject({
        zodRef,
        schemas,
        useOutput,
        hideDefinitions: getExcludedDefinitionsFromSchema(schemas),
      }),
      ...required,
      ...additionalProperties,
      ...hideDefinitions,
    },
    ...schemas,
  );
}

function parseRecord({
  zodRef,
  schemas,
  useOutput,
}: ParsingArgs<ZodRecord>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      type: 'object',
      additionalProperties:
        zodRef._def.valueType instanceof ZodUnknown
          ? {}
          : generateSchema(zodRef._def.valueType, useOutput),
    },
    ...schemas,
  );
}

function parseBigInt({
  zodRef,
  schemas,
}: ParsingArgs<ZodBigInt>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    { type: 'integer', format: 'int64' },
    ...schemas,
  );
}

function parseBoolean({
  zodRef,
  schemas,
}: ParsingArgs<ZodBoolean>): SchemaObject {
  return mergeWithDescription(zodRef, { type: 'boolean' }, ...schemas);
}

function parseDate({ zodRef, schemas }: ParsingArgs<ZodDate>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    { type: 'string', format: 'date-time' },
    ...schemas,
  );
}

function parseNull({ zodRef, schemas }: ParsingArgs<ZodNull>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      nullable: true,
    },
    ...schemas,
  );
}

function parseOptional({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodOptional<OpenApiZodAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    generateSchema(zodRef.unwrap(), useOutput),
    ...schemas,
  );
}

function parseNullable({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodNullable<OpenApiZodAny>>): SchemaObject {
  const schema = generateSchema(zodRef.unwrap(), useOutput);
  return mergeWithDescription(
    zodRef,
    { ...schema, type: schema.type, nullable: true },
    ...schemas,
  );
}

function parseDefault({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodDefault<OpenApiZodAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      default: zodRef._def.defaultValue(),
      ...generateSchema(zodRef._def.innerType, useOutput),
    },
    ...schemas,
  );
}

function parseArray({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodArray<OpenApiZodAny>>): SchemaObject {
  const constraints: SchemaObject = {};
  if (zodRef._def.exactLength != null) {
    constraints.minItems = zodRef._def.exactLength.value;
    constraints.maxItems = zodRef._def.exactLength.value;
  }

  if (zodRef._def.minLength != null) {
    constraints.minItems = zodRef._def.minLength.value;
  }
  if (zodRef._def.maxLength != null) {
    constraints.maxItems = zodRef._def.maxLength.value;
  }

  return mergeWithDescription(
    zodRef,
    {
      type: 'array',
      items: generateSchema(zodRef.element, useOutput),
      ...constraints,
    },
    ...schemas,
  );
}

function parseLiteral({
  schemas,
  zodRef,
}: ParsingArgs<ZodLiteral<OpenApiZodAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      ...parseTypeof(typeof zodRef._def.value),
      enum: [zodRef._def.value],
    },
    ...schemas,
  );
}

function parseEnum({
  schemas,
  zodRef,
}: ParsingArgs<ZodEnum<never> | ZodNativeEnum<never>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      ...parseTypeof(typeof Object.values(zodRef._def.values)[0]),
      enum: Object.values(zodRef._def.values),
    },
    ...schemas,
  );
}

function parseIntersection({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodIntersection<ZodTypeAny, ZodTypeAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      allOf: [
        generateSchema(zodRef._def.left, useOutput),
        generateSchema(zodRef._def.right, useOutput),
      ],
    },
    ...schemas,
  );
}

function parseUnion({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<ZodUnion<[ZodTypeAny, ...ZodTypeAny[]]>>): SchemaObject {
  const contents = zodRef._def.options;
  if (
    contents.reduce(
      (prev, content) => prev && content._def.typeName === 'ZodLiteral',
      true,
    )
  ) {
    // special case to transform unions of literals into enums
    const literals = contents;
    const type = literals.reduce(
      (prev, content) =>
        !prev || prev === typeof content._def.value
          ? typeof content._def.value
          : null,
      null as null | string,
    );

    if (type) {
      return mergeWithDescription(
        zodRef,
        {
          ...parseTypeof(type),
          enum: literals.map((literal) => literal._def.value),
        },
        ...schemas,
      );
    }
  }

  return mergeWithDescription(
    zodRef,
    {
      oneOf: contents.map((schema) => generateSchema(schema, useOutput)),
    },
    ...schemas,
  );
}

function parseDiscriminatedUnion({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<
  ZodDiscriminatedUnion<string, ZodDiscriminatedUnionOption<string>[]>
>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    {
      discriminator: {
        propertyName: zodRef._def.discriminator,
      },
      oneOf: [...zodRef._def.options.values()].map((schema) =>
        generateSchema(schema, useOutput),
      ),
    },
    ...schemas,
  );
}

function parseNever({ zodRef, schemas }: ParsingArgs<ZodNever>): SchemaObject {
  return mergeWithDescription(zodRef, { readOnly: true }, ...schemas);
}

function parseBranded({
  schemas,
  zodRef,
}: ParsingArgs<ZodBranded<ZodAny, string>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    generateSchema(zodRef._def.type),
    ...schemas,
  );
}

function catchAllParser({
  zodRef,
  schemas,
}: ParsingArgs<ZodTypeAny>): SchemaObject {
  return mergeWithDescription(zodRef, ...schemas);
}

function parsePipeline({
  zodRef,
  useOutput,
  schemas,
}: ParsingArgs<ZodPipeline<never, never>>): SchemaObject {
  if (useOutput) {
    return mergeWithDescription(
      zodRef,
      generateSchema(zodRef._def.out, useOutput),
      ...schemas,
    );
  }
  return mergeWithDescription(
    zodRef,
    generateSchema(zodRef._def.in, useOutput),
    ...schemas,
  );
}

function parseReadonly({
  zodRef,
  useOutput,
  schemas,
}: ParsingArgs<ZodReadonly<ZodAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    generateSchema(zodRef._def.innerType, useOutput),
    ...schemas,
  );
}

function parseCatch({
  zodRef,
  useOutput,
  schemas,
}: ParsingArgs<ZodCatch<ZodTypeAny>>): SchemaObject {
  return mergeWithDescription(
    zodRef,
    generateSchema(zodRef._def.innerType, useOutput),
    ...schemas,
  );
}

function mergeWithDescription(
  zodRef: ZodSchema,
  ...schemas: SchemaObject[]
): SchemaObject {
  let [first, ...rest] = schemas;
  first ??= {};
  if (zodRef.description) {
    first.description = zodRef.description;
  }
  return mergeAndConcat(first, ...rest);
}

const workerMap: Record<string, (options: ParsingArgs<any>) => SchemaObject> = {
  ZodObject: parseObject,
  ZodRecord: parseRecord,
  ZodString: parseString,
  ZodNumber: parseNumber,
  ZodBigInt: parseBigInt,
  ZodBoolean: parseBoolean,
  ZodDate: parseDate,
  ZodNull: parseNull,
  ZodOptional: parseOptional,
  ZodNullable: parseNullable,
  ZodDefault: parseDefault,
  ZodArray: parseArray,
  ZodLiteral: parseLiteral,
  ZodEnum: parseEnum,
  ZodNativeEnum: parseEnum,
  ZodTransformer: parseTransformation,
  ZodEffects: parseTransformation,
  ZodIntersection: parseIntersection,
  ZodUnion: parseUnion,
  ZodDiscriminatedUnion: parseDiscriminatedUnion,
  ZodNever: parseNever,
  ZodBranded: parseBranded,
  ZodUndefined: catchAllParser,
  ZodTuple: catchAllParser,
  ZodMap: catchAllParser,
  ZodFunction: catchAllParser,
  ZodLazy: catchAllParser,
  ZodPromise: catchAllParser,
  ZodAny: catchAllParser,
  ZodUnknown: catchAllParser,
  ZodVoid: catchAllParser,
  ZodPipeline: parsePipeline,
  ZodReadonly: parseReadonly,
  ZodCatch: parseCatch,
};

export function generateSchema(
  zodRef: OpenApiZodAny,
  useOutput?: boolean,
): SchemaObject {
  const { metaOpenApi = {} } = zodRef;
  const schemas: CustomSchemaObject[] = [
    ...(Array.isArray(metaOpenApi) ? metaOpenApi : [metaOpenApi]),
  ];
  try {
    const typeName = zodRef._def.typeName;
    const parser = workerMap[typeName] ?? catchAllParser;
    return parser({
      zodRef: zodRef as never,
      schemas,
      useOutput,
    });
  } catch (error) {
    console.error(error);
    return catchAllParser({ zodRef, schemas });
  }
}
