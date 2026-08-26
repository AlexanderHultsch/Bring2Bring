import { z } from 'zod';

const integerInRange = (min, max) =>
  z
    .string()
    .regex(/^\d+$/, { message: `must be an integer between ${min} and ${max}` })
    .transform((value) => Number(value))
    .refine((value) => value >= min && value <= max, {
      message: `must be an integer between ${min} and ${max}`,
    });

const nonEmptyString = z.string().min(1, { message: 'must be a non-empty string' });

const absoluteHttpUrl = z.string().min(1, { message: 'required' }).transform((value, ctx) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be an absolute http(s) URL' });
    return z.NEVER;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'must be an absolute http(s) URL' });
    return z.NEVER;
  }
  return value.replace(/\/+$/, '');
});

const FIELDS = [
  {
    envKey: 'PORT',
    configKey: 'port',
    required: false,
    default: '3000',
    schema: integerInRange(1, 65535),
  },
  {
    envKey: 'DB_PATH',
    configKey: 'dbPath',
    required: false,
    default: './data/dishlist.db',
    schema: nonEmptyString,
  },
  {
    envKey: 'UPLOAD_DIR',
    configKey: 'uploadDir',
    required: false,
    default: './data/uploads',
    schema: nonEmptyString,
  },
  {
    envKey: 'SESSION_SECRET',
    configKey: 'sessionSecret',
    required: true,
    schema: z.string().min(16, { message: 'must be at least 16 characters' }),
  },
  {
    envKey: 'ADMIN_USER',
    configKey: 'adminUser',
    required: true,
    schema: nonEmptyString,
  },
  {
    envKey: 'ADMIN_PASSWORD',
    configKey: 'adminPassword',
    required: true,
    schema: nonEmptyString,
  },
  {
    envKey: 'PUBLIC_BASE_URL',
    configKey: 'publicBaseUrl',
    required: true,
    schema: absoluteHttpUrl,
  },
  {
    envKey: 'TRUST_PROXY',
    configKey: 'trustProxy',
    required: false,
    default: '1',
    schema: integerInRange(0, Number.MAX_SAFE_INTEGER),
  },
  {
    envKey: 'NODE_ENV',
    configKey: 'nodeEnv',
    required: false,
    default: 'production',
    schema: z.enum(['production', 'development', 'test']),
  },
  {
    envKey: 'NUMBER_LOCALE',
    configKey: 'numberLocale',
    required: false,
    default: 'de-DE',
    schema: nonEmptyString,
  },
];

export function loadConfig(env = process.env) {
  const errors = [];
  const result = {};

  for (const field of FIELDS) {
    const raw = env[field.envKey];

    if (raw === undefined) {
      if (field.required) {
        errors.push(`${field.envKey}: required`);
        continue;
      }
      result[field.configKey] = field.schema.parse(field.default);
      continue;
    }

    const parsed = field.schema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid value';
      errors.push(`${field.envKey}: ${message}`);
      continue;
    }
    result[field.configKey] = parsed.data;
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  ${errors.join('\n  ')}`);
  }

  result.isProduction = result.nodeEnv === 'production';

  return result;
}
