import { describe, it, expect } from 'vitest';
import {
  escapeShellArg,
  validateAndEscapePath,
  validateAndEscapeProfile,
} from '../shell.js';

describe('escapeShellArg', () => {
  it('should wrap simple strings in single quotes', () => {
    expect(escapeShellArg('hello')).toBe("'hello'");
  });

  it('should escape single quotes within strings', () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'");
  });

  it('should handle multiple single quotes', () => {
    expect(escapeShellArg("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });

  it('should handle empty strings', () => {
    expect(escapeShellArg('')).toBe("''");
  });

  it('should handle strings with spaces', () => {
    expect(escapeShellArg('hello world')).toBe("'hello world'");
  });

  it('should handle paths with spaces', () => {
    expect(escapeShellArg('/path/to/my project')).toBe("'/path/to/my project'");
  });

  it('should throw for non-string input', () => {
    expect(() => escapeShellArg(123 as any)).toThrow('Shell argument must be a string');
    expect(() => escapeShellArg(null as any)).toThrow('Shell argument must be a string');
    expect(() => escapeShellArg(undefined as any)).toThrow('Shell argument must be a string');
  });

  it('should handle special characters safely', () => {
    // These should be safely wrapped, not executed
    expect(escapeShellArg('$(whoami)')).toBe("'$(whoami)'");
    expect(escapeShellArg('`ls`')).toBe("'`ls`'");
  });
});

describe('validateAndEscapePath', () => {
  it('should accept valid paths', () => {
    expect(validateAndEscapePath('/home/user/project')).toBe("'/home/user/project'");
    expect(validateAndEscapePath('./my-project')).toBe("'./my-project'");
    expect(validateAndEscapePath('C:\\Users\\project')).toBe("'C:\\Users\\project'");
  });

  it('should accept paths with spaces', () => {
    expect(validateAndEscapePath('/home/user/my project')).toBe("'/home/user/my project'");
  });

  it('should accept paths with dots and underscores', () => {
    expect(validateAndEscapePath('./my_project.test')).toBe("'./my_project.test'");
  });

  it('should reject paths with semicolons (command chaining)', () => {
    expect(() => validateAndEscapePath('/path; rm -rf /')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with pipes', () => {
    expect(() => validateAndEscapePath('/path | cat /etc/passwd')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with backticks (command substitution)', () => {
    expect(() => validateAndEscapePath('/path/`whoami`')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with $() (command substitution)', () => {
    expect(() => validateAndEscapePath('/path/$(whoami)')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with ampersand', () => {
    expect(() => validateAndEscapePath('/path & echo hacked')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with curly braces', () => {
    expect(() => validateAndEscapePath('/path/{a,b}')).toThrow('potentially dangerous characters');
  });

  it('should reject paths with redirects', () => {
    expect(() => validateAndEscapePath('/path > /etc/passwd')).toThrow('potentially dangerous characters');
    expect(() => validateAndEscapePath('/path < /etc/passwd')).toThrow('potentially dangerous characters');
  });

  it('should throw for empty paths', () => {
    expect(() => validateAndEscapePath('')).toThrow('must be a non-empty string');
  });

  it('should throw for non-string input', () => {
    expect(() => validateAndEscapePath(null as any)).toThrow('must be a non-empty string');
    expect(() => validateAndEscapePath(undefined as any)).toThrow('must be a non-empty string');
  });

  it('should use custom name in error messages', () => {
    expect(() => validateAndEscapePath('', 'Move directory')).toThrow('Invalid Move directory');
  });
});

describe('validateAndEscapeProfile', () => {
  it('should accept valid profile names', () => {
    expect(validateAndEscapeProfile('default')).toBe("'default'");
    expect(validateAndEscapeProfile('my-profile')).toBe("'my-profile'");
    expect(validateAndEscapeProfile('profile_123')).toBe("'profile_123'");
  });

  it('should accept alphanumeric names', () => {
    expect(validateAndEscapeProfile('Profile1')).toBe("'Profile1'");
    expect(validateAndEscapeProfile('test123')).toBe("'test123'");
  });

  it('should reject profiles with spaces', () => {
    expect(() => validateAndEscapeProfile('my profile')).toThrow('Only alphanumeric');
  });

  it('should reject profiles with special characters', () => {
    expect(() => validateAndEscapeProfile('profile;rm')).toThrow('Only alphanumeric');
    expect(() => validateAndEscapeProfile('profile$test')).toThrow('Only alphanumeric');
    expect(() => validateAndEscapeProfile('profile/test')).toThrow('Only alphanumeric');
  });

  it('should reject profiles with dots', () => {
    expect(() => validateAndEscapeProfile('profile.test')).toThrow('Only alphanumeric');
  });

  it('should throw for empty profiles', () => {
    expect(() => validateAndEscapeProfile('')).toThrow('must be a non-empty string');
  });

  it('should throw for non-string input', () => {
    expect(() => validateAndEscapeProfile(null as any)).toThrow('must be a non-empty string');
    expect(() => validateAndEscapeProfile(undefined as any)).toThrow('must be a non-empty string');
  });
});
