import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol, fs as memfsFs } from 'memfs';

// Mock fs module - handle both default and named exports
vi.mock('fs', () => {
  return {
    default: memfsFs,
    ...memfsFs,
  };
});

// Mock runCli so the compileCommand orchestrator tests below never hit
// the real `movement` binary.
const runCliMock = vi.fn();
vi.mock('../../utils/runCli.js', () => ({
  runCli: runCliMock,
}));

// Mock loadUserConfig so we don't need a real movehat.config.ts on disk
// (memfs replaces fs but not the dynamic-import path inside loadUserConfig).
const loadUserConfigMock = vi.fn();
vi.mock('../../core/config.js', () => ({
  loadUserConfig: loadUserConfigMock,
}));

// Import after mocks are set up
const compileModule = await import('../compile.js');
const { extractNamedAddresses, updateMoveToml } = compileModule;
const compileCommand = compileModule.default;

describe('extractNamedAddresses', () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  it('should extract single module address', () => {
    vol.fromJSON({
      '/move/sources/counter.move': `
        module counter::my_counter {
          public fun increment() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).toContain('counter');
    expect(addresses.size).toBe(1);
  });

  it('should extract multiple module addresses', () => {
    vol.fromJSON({
      '/move/sources/counter.move': `
        module counter::my_counter {
          public fun increment() {}
        }
      `,
      '/move/sources/token.move': `
        module my_token::token {
          public fun mint() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).toContain('counter');
    expect(addresses).toContain('my_token');
    expect(addresses.size).toBe(2);
  });

  it('should ignore standard addresses (std, aptos_framework, aptos_std)', () => {
    vol.fromJSON({
      '/move/sources/counter.move': `
        module std::something {
          public fun test() {}
        }
        module aptos_framework::coin {
          public fun transfer() {}
        }
        module aptos_std::table {
          public fun new() {}
        }
        module my_module::counter {
          public fun increment() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).not.toContain('std');
    expect(addresses).not.toContain('aptos_framework');
    expect(addresses).not.toContain('aptos_std');
    expect(addresses).toContain('my_module');
    expect(addresses.size).toBe(1);
  });

  it('should ignore addresses in comments', () => {
    vol.fromJSON({
      '/move/sources/counter.move': `
        // module commented_out::should_not_match {
        /* 
          module block_comment::also_ignored {
        */
        module real_module::counter {
          public fun increment() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).not.toContain('commented_out');
    expect(addresses).not.toContain('block_comment');
    expect(addresses).toContain('real_module');
    expect(addresses.size).toBe(1);
  });

  it('should handle nested directories', () => {
    vol.fromJSON({
      '/move/sources/core/counter.move': `
        module core_module::counter {
          public fun increment() {}
        }
      `,
      '/move/sources/utils/helpers.move': `
        module utils_module::helpers {
          public fun helper() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).toContain('core_module');
    expect(addresses).toContain('utils_module');
    expect(addresses.size).toBe(2);
  });

  it('should return empty set for empty directory', () => {
    vol.fromJSON({
      '/move/sources/.gitkeep': '',
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses.size).toBe(0);
  });

  it('should handle module with underscore in name', () => {
    vol.fromJSON({
      '/move/sources/counter.move': `
        module hello_blockchain::my_counter_v2 {
          public fun increment() {}
        }
      `,
    });

    const addresses = extractNamedAddresses('/move');
    expect(addresses).toContain('hello_blockchain');
    expect(addresses.size).toBe(1);
  });
});

describe('updateMoveToml', () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  it('should add missing addresses to Move.toml', () => {
    vol.fromJSON({
      '/move/Move.toml': `[package]
name = "test"
version = "1.0.0"

[addresses]
existing = "_"

[dev-addresses]
existing = "0xcafe"

[dependencies]
`,
    });

    const detected = new Set(['existing', 'new_address']);
    const added = updateMoveToml('/move', detected);

    expect(added).toContain('new_address');
    expect(added).not.toContain('existing');
    expect(added.length).toBe(1);

    const content = vol.readFileSync('/move/Move.toml', 'utf-8') as string;
    expect(content).toContain('new_address = "_"');
    expect(content).toContain('new_address = "0xbeef"'); // Second dev address
  });

  it('should assign unique dev addresses', () => {
    vol.fromJSON({
      '/move/Move.toml': `[package]
name = "test"

[addresses]

[dev-addresses]

[dependencies]
`,
    });

    const detected = new Set(['addr1', 'addr2', 'addr3']);
    const added = updateMoveToml('/move', detected);

    expect(added.length).toBe(3);

    const content = vol.readFileSync('/move/Move.toml', 'utf-8') as string;
    expect(content).toContain('addr1 = "0xcafe"');
    expect(content).toContain('addr2 = "0xbeef"');
    expect(content).toContain('addr3 = "0xdead"');
  });

  it('should not duplicate existing addresses', () => {
    vol.fromJSON({
      '/move/Move.toml': `[package]
name = "test"

[addresses]
counter = "_"

[dev-addresses]
counter = "0xcafe"

[dependencies]
`,
    });

    const detected = new Set(['counter']);
    const added = updateMoveToml('/move', detected);

    expect(added.length).toBe(0);
  });

  it('should return empty array if Move.toml does not exist', () => {
    vol.fromJSON({
      '/move/sources/counter.move': 'module test::counter {}',
    });

    const detected = new Set(['test']);
    const added = updateMoveToml('/move', detected);

    expect(added.length).toBe(0);
  });

  it('should avoid dev address conflicts', () => {
    vol.fromJSON({
      '/move/Move.toml': `[package]
name = "test"

[addresses]
existing = "_"

[dev-addresses]
existing = "0xcafe"

[dependencies]
`,
    });

    const detected = new Set(['existing', 'new_one']);
    const added = updateMoveToml('/move', detected);

    const content = vol.readFileSync('/move/Move.toml', 'utf-8') as string;
    // new_one should get 0xbeef since 0xcafe is taken
    expect(content).toContain('new_one = "0xbeef"');
  });
});

describe('compileCommand — orchestrator', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vol.reset();
    runCliMock.mockReset();
    loadUserConfigMock.mockReset();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it('happy path: detects named addresses, invokes movement build, finishes', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: {},
    });
    vol.fromJSON({
      '/proj/move/Move.toml': `[package]
name = "proj"

[addresses]
counter = "_"

[dev-addresses]
counter = "0xcafe"

[dependencies]
`,
      '/proj/move/sources/counter.move': 'module counter::lib {}',
    });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' });

    await compileCommand();

    expect(runCliMock).toHaveBeenCalledTimes(1);
    const call = runCliMock.mock.calls[0]!;
    expect(call[0].command).toBe('movement');
    expect(call[0].args.slice(0, 2)).toEqual(['move', 'build']);
  });

  it('exits 1 with a clear error when moveDir is missing', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/nonexistent',
      namedAddresses: {},
    });

    await expect(compileCommand()).rejects.toThrow('__test_exit_1__');
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it('exits 1 when the build step returns non-zero', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: {},
    });
    vol.fromJSON({
      '/proj/move/Move.toml': '[package]\nname="x"\n[addresses]\n',
      '/proj/move/sources/x.move': 'module x::lib {}',
    });
    runCliMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'compile error',
    });

    await expect(compileCommand()).rejects.toThrow('__test_exit_1__');
  });

  it('merges user-configured namedAddresses over auto-assigned dev addresses', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: { counter: '0xabc' },
    });
    vol.fromJSON({
      '/proj/move/Move.toml':
        '[package]\nname="x"\n[addresses]\ncounter = "_"\n[dev-addresses]\n',
      '/proj/move/sources/counter.move': 'module counter::lib {}',
    });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    await compileCommand();

    const args = runCliMock.mock.calls[0]![0].args;
    const namedIdx = args.indexOf('--named-addresses');
    expect(namedIdx).toBeGreaterThanOrEqual(0);
    // User-configured override (0xabc) wins over auto-assigned (0xcafe).
    expect(args[namedIdx + 1]).toContain('counter=0xabc');
  });

  it('passes multiple named addresses as distinct comma-delimited mappings', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: {},
    });
    vol.fromJSON({
      '/proj/move/Move.toml':
        '[package]\nname="x"\n[addresses]\none = "_"\ntwo = "_"\n[dev-addresses]\n',
      '/proj/move/sources/one.move': 'module one::lib {}',
      '/proj/move/sources/two.move': 'module two::lib {}',
    });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    await compileCommand();

    const args = runCliMock.mock.calls[0]![0].args;
    const mappings = args[args.indexOf('--named-addresses') + 1].split(',');
    expect(mappings).toContain('one=0xcafe');
    expect(mappings).toContain('two=0xbeef');
  });

  it('rejects an invalid named-address key', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: { 'bad-name-with-dash': '0x1' },
    });
    vol.fromJSON({
      '/proj/move/Move.toml': '[package]\nname="x"\n[addresses]\n',
      '/proj/move/sources/x.move': 'module x::lib {}',
    });

    await expect(compileCommand()).rejects.toThrow('__test_exit_1__');
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid address value (non-hex)', async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      moveDir: '/proj/move',
      namedAddresses: { counter: 'not-hex' },
    });
    vol.fromJSON({
      '/proj/move/Move.toml': '[package]\nname="x"\n[addresses]\n',
      '/proj/move/sources/x.move': 'module counter::lib {}',
    });

    await expect(compileCommand()).rejects.toThrow('__test_exit_1__');
    expect(runCliMock).not.toHaveBeenCalled();
  });
});
