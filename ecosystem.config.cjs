module.exports = {
  apps: [
    {
      name: "points-bot",
      script: "src/index.js",
      node_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      kill_timeout: 5000,
      max_memory_restart: "300M",
    },
  ],
};
