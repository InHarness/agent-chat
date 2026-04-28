import { runBasic } from './commands/basic.js';

const HELP = `Usage: agent-chat <command> [options]

Commands:
  basic           Start a local server + UI in the current directory.

Run "agent-chat <command> --help" for command-specific options.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(HELP);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'basic') {
    await runBasic(argv.slice(1));
    return;
  }

  process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`agent-chat: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
