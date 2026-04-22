// PM2 process configuration for SpaceViewer.
// Usage on your VPS:
//   npm ci --omit=dev
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save
//   pm2 startup   # (optional) auto-start on reboot

module.exports = {
  apps: [
    {
      name: "spaceviewer",
      script: "server/server.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 5173,
        NASA_API_KEY: "DEMO_KEY",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5173,
      },
    },
  ],
};
