const http = require("http");
const fs = require("fs");
const path = require("path");
const { buildDashboardData } = require("./dashboard-data-adapter.cjs");

const host = "127.0.0.1";
const port = 4326;
const root = __dirname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : (req.url || "/").split("?")[0];

  if (requestPath === "/api/dashboard") {
    try {
      const payload = buildDashboardData();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(
        JSON.stringify({
          error: "dashboard_data_failed",
          message: error instanceof Error ? error.message : String(error)
        }),
      );
    }
    return;
  }

  const resolvedPath = path.normalize(path.join(root, requestPath));

  if (!resolvedPath.startsWith(path.normalize(root))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(resolvedPath)] || "text/plain; charset=utf-8"
    });
    res.end(contents);
  });
});

server.listen(port, host, () => {
  console.log(`dashboard preview server running at http://${host}:${port}`);
});
