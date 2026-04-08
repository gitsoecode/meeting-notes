import readline from "node:readline";

export interface Prompter {
  ask(question: string, defaultVal?: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  close(): void;
}

export function createPrompter(): Prompter {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question: string, defaultVal?: string): Promise<string> =>
    new Promise((resolve) => {
      const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
      rl.question(prompt, (answer) => resolve(answer.trim() || defaultVal || ""));
    });

  const askHidden = (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
      process.stdout.write(`${question}: `);

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw ?? false;
      const wasPaused = stdin.isPaused();

      // Pause readline so it doesn't consume our keystrokes.
      rl.pause();

      if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");

      let buf = "";

      const onData = (chunk: string) => {
        for (const ch of chunk) {
          const code = ch.charCodeAt(0);
          if (ch === "\n" || ch === "\r" || code === 4) {
            // Enter or Ctrl-D
            cleanup();
            process.stdout.write("\n");
            resolve(buf);
            return;
          }
          if (code === 3) {
            // Ctrl-C
            cleanup();
            process.stdout.write("\n");
            reject(new Error("Cancelled"));
            return;
          }
          if (code === 127 || code === 8) {
            // Backspace / Delete
            if (buf.length > 0) {
              buf = buf.slice(0, -1);
              process.stdout.write("\b \b");
            }
            continue;
          }
          if (code < 32) continue; // ignore other control chars
          buf += ch;
          process.stdout.write("*");
        }
      };

      const cleanup = () => {
        stdin.removeListener("data", onData);
        if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
        if (wasPaused) stdin.pause();
        rl.resume();
      };

      stdin.on("data", onData);
    });

  const close = () => {
    rl.close();
  };

  return { ask, askHidden, close };
}
