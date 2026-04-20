import express from 'express';
import { createChatHandler } from '@inharness/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'test',
  threadsDir: './threads',
});

const app = express();
app.get('/api/config', handler.handleConfig);

const server = app.listen(3999, () => {
  fetch('http://localhost:3999/api/config')
    .then(r => r.json())
    .then((d: any) => {
      for (const [n, a] of Object.entries(d.architectures)) {
        const arch = a as any;
        console.log(n, 'options:', arch.options.map((o: any) => o.key), 'contextWindows:', arch.contextWindows);
      }
      server.close();
    });
});
