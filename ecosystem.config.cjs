module.exports = {
  apps: [
    {
      name: 'veritheo-bot',
      script: 'index.ts',
      interpreter: 'bun',

      // Auto-restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // Error handling
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Log rotation
      log_type: 'json',

      // Process management
      kill_timeout: 5000,
      wait_ready: false,

      // Instance management (single instance for Telegram bot)
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
