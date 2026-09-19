import { server, attachRelaySocket, shutdown, config } from '../server.ts';

/**
 * Starts the inbound / callback voice service.
 *
 * Nothing here can dial. The process answers calls Twilio hands it and shuts down
 * cleanly when asked, and there is no planner or turn producer wired in by default:
 * a bare `serve` answers every call as an ordinary inbound call, which is the safe
 * behaviour rather than a broken one.
 */

await attachRelaySocket();

server.listen(config.port, config.host, () => {
  process.stdout.write(JSON.stringify({
    event: 'service.started', service: 'inbound-voice',
    port: config.port, host: config.host, paths: config.paths,
    canPlaceOutboundCalls: false,
  }) + '\n');
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
