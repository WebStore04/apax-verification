import { spawn } from "node:child_process"

const children = []

function launch(args, env) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  })
  children.push(child)
  child.on("exit", (code, signal) => {
    for (const other of children) {
      if (other !== child && other.exitCode === null && other.signalCode === null) other.kill()
    }
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
}

launch(["node_modules/next/dist/bin/next", "start", "-p", "3000"], { PORT: "3000" })
launch(["node_modules/tsx/dist/cli.mjs", "src/index.ts"], {
  PORT: "4000",
  VERIFY_ADMIN_ID: process.env.VERIFY_ADMIN_ID || "admin",
  VERIFY_ADMIN_PASSWORD: process.env.VERIFY_ADMIN_PASSWORD || "!@#QWEASDZXC",
})
