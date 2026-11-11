export interface Log {
  info(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export class Logger implements Log {
  constructor(private readonly output: { appendLine(value: string): void }, private readonly level: string) {}
  private write(level: string, message: string): void {
    this.output.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
  }
  info(message: string): void { this.write('info', message); }
  error(message: string): void { this.write('error', message); }
  debug(message: string): void { if (this.level === 'debug') this.write('debug', message); }
}
