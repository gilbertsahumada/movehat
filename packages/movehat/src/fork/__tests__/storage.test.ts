import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { ForkStorage } from '../storage.js';

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

    it('should not overwrite existing files', () => {
      vol.fromJSON({
        [`${forkPath}/accounts.json`]: '{"existing": "data"}',
      });

      const storage = new ForkStorage(forkPath);
      storage.initialize();

      const content = vol.readFileSync(`${forkPath}/accounts.json`, 'utf-8');
      expect(content).toBe('{"existing": "data"}');
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
    });

    it('should throw error if metadata does not exist', () => {
      const storage = new ForkStorage(forkPath);
      expect(() => storage.loadMetadata()).toThrow('Fork metadata not found');
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
          '0x1': { sequenceNumber: '0' },
          '0x2': { sequenceNumber: '5' },
          '0x3': { sequenceNumber: '10' },
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
          '0x1': { sequenceNumber: '0' },
        }),
      });

      const storage = new ForkStorage(forkPath);
      storage.clearAccounts();

      const accounts = storage.listAccounts();
      expect(accounts).toHaveLength(0);
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
