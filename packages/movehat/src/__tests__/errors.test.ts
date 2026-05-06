import { describe, it, expect } from 'vitest';
import { ModuleAlreadyDeployedError } from '../errors.js';

describe('ModuleAlreadyDeployedError', () => {
  it('should create error with all properties', () => {
    const error = new ModuleAlreadyDeployedError(
      'Module "counter" is already deployed',
      'counter',
      'testnet',
      '0x1234',
      1704985623564,
      '0xabcd'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ModuleAlreadyDeployedError);
    expect(error.name).toBe('ModuleAlreadyDeployedError');
    expect(error.message).toBe('Module "counter" is already deployed');
    expect(error.moduleName).toBe('counter');
    expect(error.network).toBe('testnet');
    expect(error.address).toBe('0x1234');
    expect(error.timestamp).toBe(1704985623564);
    expect(error.txHash).toBe('0xabcd');
  });

  it('should work without optional txHash', () => {
    const error = new ModuleAlreadyDeployedError(
      'Module already deployed',
      'token',
      'mainnet',
      '0x5678',
      1704985623564
    );

    expect(error.moduleName).toBe('token');
    expect(error.network).toBe('mainnet');
    expect(error.txHash).toBeUndefined();
  });

  it('should have proper stack trace', () => {
    const error = new ModuleAlreadyDeployedError(
      'Test error',
      'test',
      'local',
      '0x0',
      Date.now()
    );

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ModuleAlreadyDeployedError');
  });

  it('should be catchable as Error', () => {
    const throwError = () => {
      throw new ModuleAlreadyDeployedError(
        'Test',
        'module',
        'testnet',
        '0x1',
        Date.now()
      );
    };

    expect(throwError).toThrow(Error);
    expect(throwError).toThrow(ModuleAlreadyDeployedError);
  });

  it('should allow instanceof checks', () => {
    try {
      throw new ModuleAlreadyDeployedError(
        'Test',
        'module',
        'testnet',
        '0x1',
        Date.now()
      );
    } catch (e) {
      expect(e instanceof ModuleAlreadyDeployedError).toBe(true);
      if (e instanceof ModuleAlreadyDeployedError) {
        expect(e.moduleName).toBe('module');
      }
    }
  });
});
