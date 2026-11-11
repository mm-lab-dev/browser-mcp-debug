import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';

export async function findExecutable(command: string): Promise<string> {
  const directories = path.isAbsolute(command) || command.includes('/') || command.includes('\\')
    ? [''] : (process.env.PATH ?? '').split(path.delimiter);
  const suffixes = process.platform === 'win32' && !path.extname(command) ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const file = directory ? path.join(directory.replace(/^"|"$/g, ''), command + suffix) : path.resolve(command + suffix);
      try {
        await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if ((await stat(file)).isFile()) return file;
      } catch { /* Continue PATH lookup. */ }
    }
  }
  throw new Error(`Host executable not found: ${command}. Install Node.js/npm on the local host and restart VS Code.`);
}

// Do not pass workspace-controlled strings through cmd.exe / shell:true.
export async function resolveCommand(command: string, args: string[]): Promise<{ command: string; args: string[] }> {
  const executable = await findExecutable(command);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const name = path.basename(executable, path.extname(executable)).toLowerCase();
    if (!['npx', 'npm'].includes(name)) throw new Error('Use an executable or Node.js script instead of a .cmd/.bat wrapper.');
    const cli = path.join(path.dirname(executable), 'node_modules', 'npm', 'bin', `${name}-cli.js`);
    await access(cli);
    return { command: await findExecutable('node'), args: [cli, ...args] };
  }
  return { command: executable, args };
}
