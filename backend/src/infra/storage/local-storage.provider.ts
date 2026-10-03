import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { AppConfigService } from '../../modules/config/app-config.service';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type {
  StorageProviderContract,
  StorageSaveInput,
  StoredFile,
} from './storage-provider.type';

@Injectable()
export class LocalStorageProvider implements StorageProviderContract, OnModuleInit {
  private readonly rootPath: string;

  constructor(config: AppConfigService) {
    this.rootPath = resolve(config.storagePath);
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      mkdir(this.resolveStoragePath('organization/logo'), { recursive: true }),
      mkdir(this.resolveStoragePath('organization/header'), { recursive: true }),
      mkdir(this.resolveStoragePath('organization/footer'), { recursive: true }),
    ]);
  }

  async save(input: StorageSaveInput): Promise<StoredFile> {
    const filePath = this.resolveStoragePath(input.storageKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.content, { flag: 'wx' });
    return {
      storageKey: input.storageKey,
      content: input.content,
    };
  }

  async get(storageKey: string): Promise<StoredFile> {
    const filePath = this.resolveStoragePath(storageKey);
    try {
      return {
        storageKey,
        content: await readFile(filePath),
      };
    } catch {
      throw new ApplicationException(
        ERROR_CODES.STORAGE_FILE_NOT_FOUND,
        'Arquivo armazenado não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveStoragePath(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolveStoragePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const normalizedKey = normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = resolve(join(this.rootPath, normalizedKey));
    if (!filePath.startsWith(`${this.rootPath}/`) && filePath !== this.rootPath) {
      throw new ApplicationException(
        ERROR_CODES.BAD_REQUEST,
        'Chave de armazenamento inválida',
        HttpStatus.BAD_REQUEST,
      );
    }
    return filePath;
  }
}
