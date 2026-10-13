const fs = require("fs");
const path = require("path");
const dir = __dirname;
const css = fs.readFileSync(path.join(dir, "app.css"), "utf8");
const logic = fs.readFileSync(path.join(dir, "logic.js"), "utf8");
const ui = fs.readFileSync(path.join(dir, "ui.js"), "utf8");
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#9e2b2b">
<title>短线单</title>
<style>
${css}
</style>
</head>
<body>
<main id="app"></main>
<script>
${logic}
${ui}
</script>
</body>
</html>
`;
const out = path.join(dir, "短线单.html");
fs.writeFileSync(out, html);
console.log(out, html.length);
