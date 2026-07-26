import { createApp } from './app.js';
import { config } from './lib/config.js';
import { startCron } from './jobs/cron.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`SideQuest API listening on http://localhost:${config.port}`);
  console.log(`photo storage: ${config.storage.driver}`);
});

if (config.runCron) startCron();
