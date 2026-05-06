import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol, fs as memfsFs } from 'memfs';

// Mock fs module
vi.mock('fs', () => ({
  default: memfsFs,
  ...memfsFs,
}));

// Import after mock
const {
  validateSafeName,
  saveDeployment,
  loadDeployment,
  getAllDeployments,
  getDeployedAddress,
} = await import('../deployments.js');

describe('validateSafeName', () => {
  it('should accept valid names', () => {
    expect(() => validateSafeName('testnet', 'network')).not.toThrow();
    expect(() => validateSafeName('counter', 'module')).not.toThrow();
    expect(() => validateSafeName('my-module', 'module')).not.toThrow();
    expect(() => validateSafeName('module_v2', 'module')).not.toThrow();
    expect(() => validateSafeName('Module123', 'module')).not.toThrow();
  });

  it('should reject path traversal attempts', () => {
    expect(() => validateSafeName('../etc/passwd', 'network')).toThrow('Path traversal');
    expect(() => validateSafeName('..\\windows', 'network')).toThrow('Path traversal');
    expect(() => validateSafeName('foo/../bar', 'module')).toThrow('Path traversal');
  });

  it('should reject slashes', () => {
    expect(() => validateSafeName('path/to/file', 'network')).toThrow('Path traversal');
    expect(() => validateSafeName('path\\to\\file', 'network')).toThrow('Path traversal');
  });

  it('should reject special characters', () => {
    expect(() => validateSafeName('test;rm', 'module')).toThrow('Only alphanumeric');
    expect(() => validateSafeName('test$var', 'module')).toThrow('Only alphanumeric');
    expect(() => validateSafeName('test space', 'module')).toThrow('Only alphanumeric');
    expect(() => validateSafeName('test.module', 'module')).toThrow('Only alphanumeric');
  });

  it('should reject hidden files (starting with dot)', () => {
    // Note: dot is rejected by the alphanumeric check, not the specific dot check
    expect(() => validateSafeName('.hidden', 'network')).toThrow('Only alphanumeric');
    expect(() => validateSafeName('.gitignore', 'module')).toThrow('Only alphanumeric');
  });

  it('should reject empty strings', () => {
    expect(() => validateSafeName('', 'network')).toThrow('must be a non-empty string');
  });

  it('should reject non-string input', () => {
    expect(() => validateSafeName(null as any, 'network')).toThrow('must be a non-empty string');
    expect(() => validateSafeName(undefined as any, 'module')).toThrow('must be a non-empty string');
  });

  it('should use correct type in error messages', () => {
    expect(() => validateSafeName('bad name', 'network')).toThrow('Invalid network name');
    expect(() => validateSafeName('bad name', 'module')).toThrow('Invalid module name');
  });
});

describe('saveDeployment and loadDeployment', () => {
  beforeEach(() => {
    vol.reset();
    // Create initial directory structure
    vol.fromJSON({
      '/project/.gitkeep': '',
    });
    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it('should save and load deployment', () => {
    const deployment = {
      address: '0x1234',
      moduleName: 'counter',
      network: 'testnet',
      deployer: '0xabcd',
      timestamp: 1704985623564,
      txHash: '0x5678',
    };

    // Mock console.log to suppress output
    vi.spyOn(console, 'log').mockImplementation(() => {});

    saveDeployment(deployment);

    const loaded = loadDeployment('testnet', 'counter');
    expect(loaded).toEqual(deployment);
  });

  it('should return null for non-existent deployment', () => {
    const loaded = loadDeployment('testnet', 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('should create directories if they do not exist', () => {
    const deployment = {
      address: '0x1234',
      moduleName: 'token',
      network: 'mainnet',
      deployer: '0xabcd',
      timestamp: Date.now(),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});

    saveDeployment(deployment);

    expect(vol.existsSync('/project/deployments')).toBe(true);
    expect(vol.existsSync('/project/deployments/mainnet')).toBe(true);
  });

  it('should reject invalid network names when saving', () => {
    const deployment = {
      address: '0x1234',
      moduleName: 'counter',
      network: '../etc',
      deployer: '0xabcd',
      timestamp: Date.now(),
    };

    expect(() => saveDeployment(deployment)).toThrow('Path traversal');
  });

  it('should reject invalid module names when saving', () => {
    const deployment = {
      address: '0x1234',
      moduleName: 'counter;rm -rf',
      network: 'testnet',
      deployer: '0xabcd',
      timestamp: Date.now(),
    };

    expect(() => saveDeployment(deployment)).toThrow('Only alphanumeric');
  });
});

describe('getAllDeployments', () => {
  beforeEach(() => {
    vol.reset();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it('should return empty object for non-existent network', () => {
    vol.fromJSON({
      '/project/.gitkeep': '',
    });

    const deployments = getAllDeployments('nonexistent');
    expect(deployments).toEqual({});
  });

  it('should return all deployments for a network', () => {
    vol.fromJSON({
      '/project/deployments/testnet/counter.json': JSON.stringify({
        address: '0x1',
        moduleName: 'counter',
        network: 'testnet',
        deployer: '0xd1',
        timestamp: 1000,
      }),
      '/project/deployments/testnet/token.json': JSON.stringify({
        address: '0x2',
        moduleName: 'token',
        network: 'testnet',
        deployer: '0xd2',
        timestamp: 2000,
      }),
    });

    const deployments = getAllDeployments('testnet');

    expect(Object.keys(deployments)).toHaveLength(2);
    expect(deployments['counter'].address).toBe('0x1');
    expect(deployments['token'].address).toBe('0x2');
  });

  it('should ignore non-JSON files', () => {
    vol.fromJSON({
      '/project/deployments/testnet/counter.json': JSON.stringify({
        address: '0x1',
        moduleName: 'counter',
        network: 'testnet',
        deployer: '0xd1',
        timestamp: 1000,
      }),
      '/project/deployments/testnet/README.md': '# Readme',
      '/project/deployments/testnet/.gitkeep': '',
    });

    const deployments = getAllDeployments('testnet');

    expect(Object.keys(deployments)).toHaveLength(1);
    expect(deployments['counter']).toBeDefined();
  });
});

describe('getDeployedAddress', () => {
  beforeEach(() => {
    vol.reset();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it('should return address for existing deployment', () => {
    vol.fromJSON({
      '/project/deployments/testnet/counter.json': JSON.stringify({
        address: '0x1234abcd',
        moduleName: 'counter',
        network: 'testnet',
        deployer: '0xd1',
        timestamp: 1000,
      }),
    });

    const address = getDeployedAddress('testnet', 'counter');
    expect(address).toBe('0x1234abcd');
  });

  it('should return null for non-existent deployment', () => {
    vol.fromJSON({
      '/project/.gitkeep': '',
    });

    const address = getDeployedAddress('testnet', 'nonexistent');
    expect(address).toBeNull();
  });
});
