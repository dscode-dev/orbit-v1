import * as fs from 'node:fs';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../src/infra/security/argon2.constants';
import { loadBootstrapEnvironment, ownerBootstrapInput } from '../src/seed-environment';

const credentials = [
  'OWNER_EMAIL=Owner@orbit.test',
  'OWNER_USERNAME=Owner',
  'OWNER_NAME=Proprietário',
  'OWNER_PASSWORD="  S3cure#$Value!  "',
].join('\n');

describe('OWNER bootstrap environment', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('reads the project root .env regardless of the working directory', () => {
    jest.spyOn(process, 'cwd').mockReturnValue('/app/backend');
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue(credentials);

    const source = loadBootstrapEnvironment();

    expect(source).toBe(resolve(__dirname, '../../.env'));
    expect(read).toHaveBeenCalledWith(source, 'utf8');
    expect(ownerBootstrapInput()).toEqual({
      email: 'owner@orbit.test',
      username: 'owner',
      name: 'Proprietário',
      password: '  S3cure#$Value!  ',
    });
  });

  it('prefers root OWNER credentials while preserving Docker database overrides', () => {
    process.env.OWNER_EMAIL = 'stale@orbit.test';
    process.env.OWNER_PASSWORD = 'StaleCredential123!';
    process.env.DATABASE_URL = 'postgresql://internal-db:5432/orbit';
    jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(
        `${credentials}\nDATABASE_URL=postgresql://localhost:5533/orbit\nORGANIZATION_CITY=Recife`,
      );

    loadBootstrapEnvironment();

    expect(ownerBootstrapInput().email).toBe('owner@orbit.test');
    expect(ownerBootstrapInput().password).toBe('  S3cure#$Value!  ');
    expect(process.env.DATABASE_URL).toBe('postgresql://internal-db:5432/orbit');
    expect(process.env.ORGANIZATION_CITY).toBe('Recife');
  });

  it('does not silently mix incomplete root credentials with inherited credentials', () => {
    process.env.OWNER_PASSWORD = 'InheritedCredential123!';
    jest.spyOn(fs, 'readFileSync').mockReturnValue('OWNER_EMAIL=owner@orbit.test');

    loadBootstrapEnvironment();

    expect(process.env.OWNER_PASSWORD).toBeUndefined();
    expect(ownerBootstrapInput).toThrow('OWNER_USERNAME is required');
  });

  it('uses environment injected by Compose when the root file is absent in the image', () => {
    process.env.OWNER_EMAIL = 'owner@orbit.test';
    process.env.OWNER_USERNAME = 'owner';
    process.env.OWNER_NAME = 'Proprietário';
    process.env.OWNER_PASSWORD = 'DockerCredential123!';
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
    });

    expect(loadBootstrapEnvironment()).toBeNull();
    expect(ownerBootstrapInput().password).toBe('DockerCredential123!');
  });

  it('fails on unreadable files instead of falling back to inherited credentials', () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    });

    expect(loadBootstrapEnvironment).toThrow('Permission denied');
  });

  it('hashes the exact configured password, including quoted spaces and special characters', async () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue(credentials);
    loadBootstrapEnvironment();
    const input = ownerBootstrapInput();
    const hash = await argon2.hash(input.password, ARGON2_OPTIONS);

    expect(await argon2.verify(hash, '  S3cure#$Value!  ')).toBe(true);
    expect(await argon2.verify(hash, input.password.trim())).toBe(false);
  });
});
