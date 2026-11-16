import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Installs the bot as a systemd user service on this machine. It uses the
// node that runs this script, so run it with the Node version you want.
const NAME = "points-bot";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unitDir = join(homedir(), ".config", "systemd", "user");
const unitPath = join(unitDir, `${NAME}.service`);

const unit = `[Unit]
Description=Points bot (Discord)

[Service]
WorkingDirectory=${repo}
ExecStart="${process.execPath}" --env-file=.env src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;

mkdirSync(unitDir, { recursive: true });
writeFileSync(unitPath, unit);
console.log(`Wrote ${unitPath}`);

const systemctl = (...args) => execFileSync("systemctl", ["--user", ...args], { stdio: "inherit" });
systemctl("daemon-reload");
systemctl("enable", NAME);
systemctl("restart", NAME);
console.log(`Started. Logs: npm run service:logs`);
