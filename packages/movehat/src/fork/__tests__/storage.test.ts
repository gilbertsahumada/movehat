import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import {
  beginCacheGenerationTransition,
  commitCacheGenerationTransition,
  ForkCacheGenerationTransitionError,
  ForkStorage,
} from '../storage.js';

// Mock fs module
vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('ForkStorage', () => {
  const forkPath = '/test-fork';

  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  describe('initialize', () => {
    it('should create fork directory structure', () => {
      const storage = new ForkStorage(forkPath);
      storage.initialize();

      expect(vol.existsSync(forkPath)).toBe(true);
      expect(vol.existsSync(`${forkPath}/resources`)).toBe(true);
      expect(vol.existsSync(`${forkPath}/cache`)).toBe(true);
      expect(vol.existsSync(`${forkPath}/cache/.gitignore`)).toBe(true);
      expect(vol.existsSync(`${forkPath}/accounts.json`)).toBe(true);
    });

    it('should create fork directories as 0700 and cache/account files as 0600', () => {
      const storage = new ForkStorage(forkPath);
      storage.initialize();

      expect(vol.statSync(forkPath).mode & 0o777).toBe(0o700);
      expect(vol.statSync(`${forkPath}/resources`).mode & 0o777).toBe(0o700);
      expect(vol.statSync(`${forkPath}/cache`).mode & 0o777).toBe(0o700);
      expect(vol.statSync(`${forkPath}/accounts.json`).mode & 0o777).toBe(0o600);
      expect(vol.statSync(`${forkPath}/cache/.gitignore`).mode & 0o777).toBe(0o600);
    });

    it('should not overwrite existing files', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{"existing": "data"}',
      });

      const storage = new ForkStorage(forkPath);
      storage.initialize();

      const content = vol.readFileSync(`${forkPath}/accounts.json`, 'utf-8');
      expect(content).toBe('{"existing": "data"}');
      expect(vol.statSync(`${forkPath}/accounts.json`).mode & 0o777).toBe(0o600);
    });
  });

  describe('exists', () => {
    it('should return false if fork does not exist', () => {
      const storage = new ForkStorage(forkPath);
      expect(storage.exists()).toBe(false);
    });

    it('should return false if metadata.json is missing', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{}',
      });

      const storage = new ForkStorage(forkPath);
      expect(storage.exists()).toBe(false);
    });

    it('should return true if fork exists with metadata', () => {
      vol.fromJSON({
        [`${forkPath}/metadata.json`]: '{}',
      });

      const storage = new ForkStorage(forkPath);
      expect(storage.exists()).toBe(true);
    });
  });

  describe('metadata', () => {
    it('should save and load metadata', () => {
      vol.mkdirSync(forkPath, { recursive: true });

      const storage = new ForkStorage(forkPath);
      const metadata = {
        network: 'testnet',
        nodeUrl: 'https://testnet.example.com/v1',
        chainId: 250,
        ledgerVersion: '12345',
        timestamp: '1234567890',
        epoch: '100',
        blockHeight: '1000',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      storage.saveMetadata(metadata);
      const loaded = storage.loadMetadata();

      expect(loaded).toEqual(metadata);
      expect(vol.statSync(`${forkPath}/metadata.json`).mode & 0o777).toBe(0o600);
    });

    it('should throw error if metadata does not exist', () => {
      const storage = new ForkStorage(forkPath);
      expect(() => storage.loadMetadata()).toThrow('Fork metadata not found');
    });

    it('should throw a controlled error for corrupt metadata JSON', () => {
      vol.fromJSON({
        [`${forkPath}/metadata.json`]: '{not-json',
      });

      const storage = new ForkStorage(forkPath);
      expect(() => storage.loadMetadata()).toThrow('Invalid JSON in fork metadata');
    });
  });

  describe('accounts', () => {
    it('should save and get account state', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{}',
      });

      const storage = new ForkStorage(forkPath);
      const accountState = {
        sequenceNumber: '10',
        authenticationKey: '0xabc123',
      };

      storage.saveAccount('0x123', accountState);
      const loaded = storage.getAccount('0x123');

      expect(loaded).toEqual(accountState);
      expect(vol.statSync(`${forkPath}/accounts.json`).mode & 0o777).toBe(0o600);
    });

    it('should return null for non-existent account', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{}',
      });

      const storage = new ForkStorage(forkPath);
      const result = storage.getAccount('0xnonexistent');

      expect(result).toBeNull();
    });

    it('should list all accounts', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: JSON.stringify({
          '0x1': { sequenceNumber: '0', authenticationKey: '0xaa' },
          '0x2': { sequenceNumber: '5', authenticationKey: '0xbb' },
          '0x3': { sequenceNumber: '10', authenticationKey: '0xcc' },
        }),
      });

      const storage = new ForkStorage(forkPath);
      const accounts = storage.listAccounts();

      expect(accounts).toHaveLength(3);
      expect(accounts).toContain('0x1');
      expect(accounts).toContain('0x2');
      expect(accounts).toContain('0x3');
    });

    it('should clear all accounts', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: JSON.stringify({
          '0x1': { sequenceNumber: '0', authenticationKey: '0xaa' },
        }),
      });

      const storage = new ForkStorage(forkPath);
      storage.clearAccounts();

      const accounts = storage.listAccounts();
      expect(accounts).toHaveLength(0);
      expect(vol.statSync(`${forkPath}/accounts.json`).mode & 0o777).toBe(0o600);
    });

    it('should throw a controlled error for corrupt accounts JSON', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{"0x1":',
      });

      const storage = new ForkStorage(forkPath);
      expect(() => storage.listAccounts()).toThrow('Invalid JSON in fork accounts');
    });

    it('should throw a controlled error when accounts JSON is not an object', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: 'null',
      });

      const storage = new ForkStorage(forkPath);
      expect(() => storage.listAccounts()).toThrow('Expected an object');
    });
  });

  describe('resources', () => {
    beforeEach(() => {
      vol.fromJSON({
        [`${forkPath}/resources/.gitkeep`]: '',
      });
    });

    it('should save and get resource', () => {
      const storage = new ForkStorage(forkPath);
      const resource = { value: '100' };

      storage.saveResource('0x1', '0x1::coin::CoinStore', resource);
      const loaded = storage.getResource('0x1', '0x1::coin::CoinStore');

      expect(loaded).toEqual(resource);
      expect(vol.statSync(`${forkPath}/resources/0x1.json`).mode & 0o777).toBe(0o600);
    });

    it('should return null for non-existent resource', () => {
      const storage = new ForkStorage(forkPath);
      const result = storage.getResource('0x1', '0x1::nonexistent::Resource');

      expect(result).toBeNull();
    });

    it('should get all resources for an account', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: JSON.stringify({
          '0x1::coin::CoinStore': { value: '100' },
          '0x1::account::Account': { sequence: '5' },
        }),
      });

      const storage = new ForkStorage(forkPath);
      const resources = storage.getAllResources('0x1');

      expect(Object.keys(resources)).toHaveLength(2);
      expect(resources['0x1::coin::CoinStore']).toEqual({ value: '100' });
    });

    it('should throw a controlled error for corrupt resource JSON', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: '{bad',
      });

      const storage = new ForkStorage(forkPath);
      expect(() => storage.getAllResources('0x1')).toThrow('Invalid JSON in fork resources');
    });

    it('should check if resource exists', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: JSON.stringify({
          '0x1::coin::CoinStore': { value: '100' },
        }),
      });

      const storage = new ForkStorage(forkPath);

      expect(storage.hasResource('0x1', '0x1::coin::CoinStore')).toBe(true);
      expect(storage.hasResource('0x1', '0x1::nonexistent::Resource')).toBe(false);
    });

    it('should clear all resources', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: '{}',
        [`${forkPath}/resources/0x2.json`]: '{}',
      });

      const storage = new ForkStorage(forkPath);
      storage.clearResources();

      expect(vol.existsSync(`${forkPath}/resources/0x1.json`)).toBe(false);
      expect(vol.existsSync(`${forkPath}/resources/0x2.json`)).toBe(false);
    });

    it('migrates legacy resource files offline, including an empty snapshot', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: '{}',
        [`${forkPath}/resources/0x2.json`]: JSON.stringify({ '0x1::a::A': { value: 1 } }),
      });
      const storage = new ForkStorage(forkPath);

      storage.migrateLegacyResourceCache();

      expect(storage.hasAllResources('0x1')).toBe(true);
      expect(storage.hasAllResources('0x2')).toBe(true);
      expect(storage.getAllResources('0x1')).toEqual({});
      expect(vol.existsSync(`${forkPath}/cache/.resource-cache-v1`)).toBe(true);
      expect(storage.getCacheGeneration()).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('resumes an interrupted legacy migration idempotently', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: '{}',
        [`${forkPath}/cache/0x1.all-resources`]: 'complete\n',
      });
      const storage = new ForkStorage(forkPath);

      expect(() => {
        storage.migrateLegacyResourceCache();
        storage.migrateLegacyResourceCache();
      }).not.toThrow();
      expect(storage.hasAllResources('0x1')).toBe(true);
    });

    it('quarantines malformed legacy resource maps instead of failing the fork', () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: JSON.stringify({
          '0x1::a::A': ['not', 'resource', 'data'],
        }),
      });
      const storage = new ForkStorage(forkPath);

      storage.migrateLegacyResourceCache();

      expect(storage.hasAllResources('0x1')).toBe(false);
      expect(vol.existsSync(`${forkPath}/resources/0x1.json`)).toBe(false);
      const quarantined = (vol.readdirSync(`${forkPath}/resources`) as string[])
        .filter((name) => name.startsWith('0x1.json.corrupt-'));
      expect(quarantined).toHaveLength(1);
      // Migration completes so healthy addresses keep their cache.
      expect(vol.existsSync(`${forkPath}/cache/.resource-cache-v1`)).toBe(true);
    });

    it('does not trust an all-resources marker whose data file is gone', () => {
      // saveAllResources always writes the data file before the marker, so a
      // lone marker means the pair was torn apart. Serving it as a complete
      // snapshot would silently answer {} for an account that has resources.
      vol.fromJSON({
        [`${forkPath}/cache/0x1.all-resources`]: 'complete\n',
      });
      const storage = new ForkStorage(forkPath);

      expect(storage.hasAllResources('0x1')).toBe(false);
    });

    it('does not trust a marker written while the cache was swept mid-migration', async () => {
      // load() runs migrateLegacyResourceCache() without the fork lock, so a
      // concurrent clearResources() can delete the data file in the window
      // between reading it and writing its marker. Reproduce that window
      // deterministically by deleting the file as the migration reads it.
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: JSON.stringify({ '0x1::a::A': { value: 1 } }),
      });
      const fs = await import('fs');
      const realReadFileSync = fs.readFileSync;
      const readSpy = vi
        .spyOn(fs, 'readFileSync')
        .mockImplementation(((path: unknown, ...rest: unknown[]) => {
          const data = (realReadFileSync as (...args: unknown[]) => unknown)(path, ...rest);
          if (String(path) === `${forkPath}/resources/0x1.json`) {
            vol.unlinkSync(`${forkPath}/resources/0x1.json`);
          }
          return data;
        }) as unknown as typeof fs.readFileSync);

      const storage = new ForkStorage(forkPath);
      try {
        storage.migrateLegacyResourceCache();
      } finally {
        readSpy.mockRestore();
      }

      // The orphan marker really is written — that is the race.
      expect(vol.existsSync(`${forkPath}/cache/0x1.all-resources`)).toBe(true);
      // It must not be served as a complete snapshot.
      expect(storage.hasAllResources('0x1')).toBe(false);
    });

    it('tolerates a legacy resource file that vanishes mid-scan', async () => {
      vol.fromJSON({
        [`${forkPath}/resources/0x1.json`]: JSON.stringify({ '0x1::a::A': { value: 1 } }),
        [`${forkPath}/resources/0x2.json`]: JSON.stringify({ '0x1::b::B': { value: 2 } }),
      });
      const fs = await import('fs');
      const realReadFileSync = fs.readFileSync;
      const readSpy = vi
        .spyOn(fs, 'readFileSync')
        .mockImplementation(((path: unknown, ...rest: unknown[]) => {
          if (String(path) === `${forkPath}/resources/0x1.json`) {
            vol.unlinkSync(`${forkPath}/resources/0x1.json`);
            const missing: NodeJS.ErrnoException = new Error(
              `ENOENT: no such file or directory, open '${String(path)}'`
            );
            missing.code = 'ENOENT';
            throw missing;
          }
          return (realReadFileSync as (...args: unknown[]) => unknown)(path, ...rest);
        }) as unknown as typeof fs.readFileSync);

      const storage = new ForkStorage(forkPath);
      try {
        expect(() => storage.migrateLegacyResourceCache()).not.toThrow();
      } finally {
        readSpy.mockRestore();
      }

      // The vanished address is simply left uncached; healthy ones migrate.
      expect(storage.hasAllResources('0x1')).toBe(false);
      expect(storage.hasAllResources('0x2')).toBe(true);
      expect(vol.existsSync(`${forkPath}/cache/.resource-cache-v1`)).toBe(true);
    });

    it('advances cache generations without clearing migration state', () => {
      const storage = new ForkStorage(forkPath);
      storage.initialize();
      const first = storage.getCacheGeneration();
      const second = storage.advanceCacheGeneration();

      expect(second).not.toBe(first);
      expect(storage.getCacheGeneration()).toBe(second);
      expect(vol.existsSync(`${forkPath}/cache/.resource-cache-v1`)).toBe(true);
    });

    it('fails closed between the transition marker and stable generation commit', () => {
      const storage = new ForkStorage(forkPath);
      storage.initialize();
      const next = beginCacheGenerationTransition(forkPath);

      expect(() => storage.getCacheGeneration()).toThrow(
        ForkCacheGenerationTransitionError
      );
      expect(
        vol.readFileSync(`${forkPath}/cache/.generation`, 'utf8')
      ).toBe(`transition:${next}\n`);

      commitCacheGenerationTransition(forkPath, next);
      expect(storage.getCacheGeneration()).toBe(next);
    });

    it('initialize preserves an interrupted transition for explicit recovery', () => {
      const storage = new ForkStorage(forkPath);
      storage.initialize();
      const next = beginCacheGenerationTransition(forkPath);

      storage.initialize();

      expect(
        vol.readFileSync(`${forkPath}/cache/.generation`, 'utf8')
      ).toBe(`transition:${next}\n`);
      expect(() => storage.getCacheGeneration()).toThrow(
        ForkCacheGenerationTransitionError
      );
    });
  });

  describe('address sanitization', () => {
    beforeEach(() => {
      vol.fromJSON({
        [`${forkPath}/resources/.gitkeep`]: '',
      });
    });

    it('should handle addresses with 0x prefix', () => {
      const storage = new ForkStorage(forkPath);
      storage.saveResource('0xabc123', 'test::Resource', { value: 1 });

      expect(vol.existsSync(`${forkPath}/resources/0xabc123.json`)).toBe(true);
    });

    it('should normalize address to lowercase', () => {
      const storage = new ForkStorage(forkPath);
      storage.saveResource('0xABC123', 'test::Resource', { value: 1 });

      expect(vol.existsSync(`${forkPath}/resources/0xabc123.json`)).toBe(true);
    });

    it('should reject invalid address formats', () => {
      const storage = new ForkStorage(forkPath);

      expect(() => {
        storage.saveResource('../../../etc/passwd', 'test::Resource', { value: 1 });
      }).toThrow('Invalid address format');

      expect(() => {
        storage.saveResource('0x123/../../etc', 'test::Resource', { value: 1 });
      }).toThrow('Invalid address format');
    });

    it('should reject addresses with more than 64 hex chars (Movement cap)', () => {
      const storage = new ForkStorage(forkPath);
      const sixtyFiveHex = '0x' + 'a'.repeat(65);

      expect(() => {
        storage.saveResource(sixtyFiveHex, 'test::Resource', { value: 1 });
      }).toThrow('Invalid address format');
    });

    it('should accept addresses exactly at the 64 hex char limit', () => {
      const storage = new ForkStorage(forkPath);
      const sixtyFourHex = '0x' + 'a'.repeat(64);

      expect(() => {
        storage.saveResource(sixtyFourHex, 'test::Resource', { value: 1 });
      }).not.toThrow();

      expect(vol.existsSync(`${forkPath}/resources/${sixtyFourHex}.json`)).toBe(true);
    });
  });
});
