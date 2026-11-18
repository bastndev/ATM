export interface LanguageConfig {
  singleLine?: string;
  blockStart?: string;
  blockEnd?: string;
}

export function getLanguageConfig(
  languageId: string,
): LanguageConfig | undefined {
  switch (languageId) {
    case 'javascript':
    case 'typescript':
    case 'javascriptreact':
    case 'typescriptreact':
    case 'java':
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'go':
    case 'rust':
    case 'php':
    case 'swift':
    case 'kotlin':
    case 'dart':
      return { singleLine: '//', blockStart: '/*', blockEnd: '*/' };

    case 'python':
    case 'ruby':
    case 'shellscript':
    case 'yaml':
    case 'toml':
    case 'makefile':
    case 'dockerfile':
    case 'perl':
    case 'elixir':
      return { singleLine: '#' };

    case 'html':
    case 'xml':
    case 'markdown':
    case 'vue':
      return { blockStart: '<!--', blockEnd: '-->' };

    case 'css':
    case 'less':
    case 'scss':
      return { blockStart: '/*', blockEnd: '*/' };

    case 'sql':
    case 'lua':
    case 'haskell':
      return { singleLine: '--' };

    case 'json':
      return undefined; // Standard JSON does not support comments
    case 'jsonc':
      return { singleLine: '//', blockStart: '/*', blockEnd: '*/' };

    default:
      // Default fallback
      return { singleLine: '//', blockStart: '/*', blockEnd: '*/' };
  }
}
