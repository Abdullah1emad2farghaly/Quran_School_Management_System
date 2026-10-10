import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import type { CredentialPrompter } from './bootstrap-main-admin-cli';

/** Interactive prompts on the real terminal; typed passwords are not echoed. */
export class TerminalPrompter implements CredentialPrompter {
  private muted = false;
  private readonly rl: Interface;

  constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {
    const sink = new Writable({
      write: (chunk, encoding, callback) => {
        if (!this.muted) this.output.write(chunk, encoding);
        callback();
      },
    });
    this.rl = createInterface({ input: this.input, output: sink, terminal: true });
  }

  isInteractive(): boolean {
    return Boolean(this.input.isTTY && this.output.isTTY);
  }

  askPhone(): Promise<string> {
    return this.ask('Phone number: ', false);
  }

  askPassword(label: string): Promise<string> {
    return this.ask(`${label}: `, true);
  }

  close(): void {
    this.rl.close();
  }

  private ask(prompt: string, hidden: boolean): Promise<string> {
    return new Promise((resolve) => {
      this.output.write(prompt);
      this.muted = hidden;
      this.rl.question('', (answer) => {
        this.muted = false;
        if (hidden) this.output.write('\n');
        resolve(answer);
      });
    });
  }
}
