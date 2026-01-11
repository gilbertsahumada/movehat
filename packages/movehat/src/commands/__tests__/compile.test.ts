import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol, fs as memfsFs } from 'memfs';

// Mock fs module - handle both default and named exports
vi.mock('fs', () => {
  return {
    default: memfsFs,
    ...memfsFs,
  };
});

// Import after mock is set up
const { extractNamedAddresses, updateMoveToml } = await import('../compile.js');

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
