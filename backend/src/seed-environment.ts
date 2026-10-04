import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { MIN_PASSWORD_LENGTH } from './shared/constants/users.constants';

const OWNER_ENVIRONMENT_KEYS = ['OWNER_EMAIL', 'OWNER_USERNAME', 'OWNER_NAME', 'OWNER_PASSWORD'];

/** Resolve from src/dist, regardless of the directory used to invoke npm. */
export function loadBootstrapEnvironment(
  envPath = resolve(__dirname, '../../.env'),
): string | null {
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch (error: unknown) {
    // Docker Compose injects the root .env via env_file; it is not in the image.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const environment = parse(contents);
  for (const [key, value] of Object.entries(environment)) {
    // Preserve runtime overrides such as Docker's internal DATABASE_URL.
    if (process.env[key] === undefined) process.env[key] = value;
  }
  for (const key of OWNER_ENVIRONMENT_KEYS) {
    // When the file exists, all OWNER credentials must come from that file.
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
  return envPath;
}

export function requiredEnvironment(name: string, trim = true): string {
  const rawValue = process.env[name];
  const value = trim ? rawValue?.trim() : rawValue;
  if (!value) throw new Error(`${name} is required to bootstrap the initial OWNER`);
  return value;
}

type OwnerBootstrapInput = {
  email: string;
  username: string;
  name: string;
  password: string;
};

export function ownerBootstrapInput(): OwnerBootstrapInput {
  const input = {
    email: requiredEnvironment('OWNER_EMAIL').toLowerCase(),
    username: requiredEnvironment('OWNER_USERNAME').toLowerCase(),
    name: requiredEnvironment('OWNER_NAME'),
    password: requiredEnvironment('OWNER_PASSWORD', false),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) {
    throw new Error('OWNER_EMAIL must be a valid email address with at most 254 characters');
  }
  if (!/^[a-z0-9._-]{3,50}$/.test(input.username)) {
    throw new Error(
      'OWNER_USERNAME must contain 3 to 50 lowercase letters, numbers, dots, underscores or hyphens',
    );
  }
  if (input.name.length < 2 || input.name.length > 150) {
    throw new Error('OWNER_NAME must contain between 2 and 150 characters');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 128) {
    throw new Error(
      `OWNER_PASSWORD must contain between ${MIN_PASSWORD_LENGTH} and 128 characters`,
    );
  }
  const normalizedPassword = input.password.toLowerCase();
  if (
    ['replace_with', 'change_me', 'changeme', 'example', 'password'].some((fragment) =>
      normalizedPassword.includes(fragment),
    )
  ) {
    throw new Error('OWNER_PASSWORD must not use a placeholder or example value');
  }

  return input;
}
