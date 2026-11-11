module.exports = {
  apps: [
    {
      name: "apax-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "apax-api",
      cwd: __dirname,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "4000",
        VERIFY_ADMIN_ID: "admin",
        VERIFY_ADMIN_PASSWORD: "!@#QWEASDZXC",
      },
    },
  ],
}
