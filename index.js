const { execSync } = require("child_process");

try {
  console.log("Starting QSMS Backend deployment...");

  execSync("npm install --no-audit --no-fund", {
    stdio: "inherit",
  });

  console.log("Building TypeScript project...");

  execSync("npm run build", {
    stdio: "inherit",
  });

  console.log("Starting QSMS Backend...");

  require("./dist/app/server.js");
} catch (error) {
  console.error("QSMS deployment failed:", error);
  process.exit(1);
}
