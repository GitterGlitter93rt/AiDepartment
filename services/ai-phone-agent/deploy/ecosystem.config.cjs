// PM2 alternative to the systemd unit. Use ONE or the other, never both
// — two supervisors fighting over port 3001 is a bad afternoon.
//
//   npm install -g pm2
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup    # then run the command it prints
module.exports = {
  apps: [{
    name: 'yad-voice-agent',
    script: 'src/server.ts',
    interpreter: 'node',
    interpreter_args: '--experimental-strip-types',
    cwd: '/opt/yad-voice-agent/services/ai-phone-agent',
    instances: 1,          // sessions are in-memory: a single instance only
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '30s',
    max_memory_restart: '1G',
    kill_timeout: 35000,   // must exceed SHUTDOWN_GRACE_MS so calls drain
    env_file: '/etc/yad-voice-agent.env',
    out_file: '/var/log/yad-voice-agent/out.log',
    error_file: '/var/log/yad-voice-agent/err.log',
    merge_logs: true,
    time: false,           // the app already timestamps every JSON line
  }],
};
