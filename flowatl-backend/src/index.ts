import { config } from './config.js';
import { createApp } from './server.js';
import { createServices } from './services.js';

const services = createServices();
services.start();

const app = createApp(services);
const server = app.listen(config.port, config.host, () => {
  console.log(
    `FlowATL backend listening on http://${config.host}:${config.port} ` +
      `(${services.simulation.fleetSize} shuttles, ${config.nodeEnv})`,
  );
});

// SSE clients hold connections open; give them a moment, then let go.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — stopping the network.`);
  services.dispose();
  server.close(() => process.exit(0));
  // Do not wait forever on open event streams.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
