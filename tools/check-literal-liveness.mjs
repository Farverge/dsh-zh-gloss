#!/usr/bin/env node
/**
 * check-literal-liveness — 校准工具：把我方全部词条对生产已安装的官方构建产物核对存活性。
 *
 *   1. 键级（ui.json）：提取所有 register(NS,{zh,en}) 的 ns+键 集合，标出我方已不存在的孤儿键；
 *   2. 字面量（literals/chromeLiterals/patterns 的英文原文）：在官方 client/server 构建产物里
 *      逐条 grep，标出已无源可配的“静默失配”词条（官方改了英文原文或删除了该 UI 面）；
 *   3. pluginInfo 键：对 cordis.patch.yml 里登记的 id 全集核对，标出已下架/改名的插件。
 *
 * 用法：node tools/check-literal-liveness.mjs [官方 node_modules 根] [报告输出路径]
 * 退出码：0=全部存活，1=存在死词条（详见报告）。
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = process.argv[2] ?? join(process.env.HOME ?? "", ".dsh/profiles/web/node_modules");
const outFile = process.argv[3];
const atDir = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");

const load = (f) => require(join(atDir, "dicts", f));
const ui = load("ui.json").ui;
const literalSections = [];
for (const f of ["literals.json", "10-backend-copy.json", "20-trajectory.json"]) {
  const d = load(f);
  for (const sec of ["literals", "chromeLiterals"]) {
    if (d[sec]) for (const [en, zh] of Object.entries(d[sec])) literalSections.push({ file: f, sec, en, zh });
  }
  if (d.patterns) for (const p of d.patterns) {
    const src = typeof p === "string" ? p : (p.match ?? p.source ?? p.re ?? "");
    if (src) literalSections.push({ file: f, sec: "patterns", en: src, zh: typeof p === "object" ? (p.replacement ?? "") : "" });
  }
}

// ---- 1. 键级：从 @deepseek-ai/dsh-client-*/lib/client.js 提取 ns+键 全集 ----
function objAt(src, idx) {
  let depth = 0, inStr = null, esc = false;
  for (let i = idx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  return null;
}
const officialKeys = new Set(); // "ns\u0000key"
const anyNsKeys = new Set(); // key 兜底集合（register 形态多样，个别 ns 解析不到时不误报孤儿）
const dshRoot = join(root, "@deepseek-ai");
for (const p of readdirSync(dshRoot).sort()) {
  if (!p.startsWith("dsh-client")) continue;
  const f = join(dshRoot, p, "lib/client.js");
  if (!existsSync(f)) continue;
  const src = readFileSync(f, "utf8");
  // 命名空间常量：const XX = "ns" / NAMESPACE / NS
  const nsConst = new Map();
  for (const m of src.matchAll(/(?:const|var|let)\s+([\w$]+)\s*=\s*(["'])([^"']+)\2\s*;?/g)) nsConst.set(m[1], m[3]);
  const consts = {};
  for (const m of src.matchAll(/(?:const|var|let)\s+([\w$]+)\s*=\s*\{/g)) {
    if (!/^(zh|en)[\w$]*$/.test(m[1])) continue;
    const lit = objAt(src, m.index + m[0].length - 1);
    if (!lit) continue;
    try { consts[m[1]] = eval(`(${lit})`); } catch { /* 忽略 */ }
  }
  for (const m of src.matchAll(/register\(\s*(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*,\s*\{\s*zh\s*:?\s*([\w$]*)\s*,\s*en\s*:?\s*([\w$]*)/g)) {
    const nsRaw = m[1] ?? m[2] ?? nsConst.get(m[3]) ?? m[3];
    const ns = nsRaw?.replace(/["']/g, "");
    const zhName = m[4] || "zh", enName = m[5] || "en";
    if (!consts[zhName] || !consts[enName]) continue;
    for (const k of new Set([...Object.keys(consts[zhName]), ...Object.keys(consts[enName])])) {
      officialKeys.add(`${ns}\u0000${k}`);
      anyNsKeys.add(k);
    }
  }
}

const lines = [];
let dead = 0;
for (const [ns, table] of Object.entries(ui)) {
  for (const key of Object.keys(table)) {
    if (!officialKeys.has(`${ns}\u0000${key}`) && !anyNsKeys.has(key)) { lines.push(`[ui.json] 孤儿键 | ${ns}.${key} = ${table[key]}`); dead++; }
  }
}

// ---- 2. 字面量：在全部官方构建产物（client bundle + 宿主/服务端包 lib）里找英文原文 ----
const corpusFiles = [];
const walk = (dir, depth) => {
  if (depth > 4) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "test", "tests", "__tests__", "docs"].includes(e.name)) continue;
      walk(full, depth + 1);
    } else if (/\.(js|cjs|mjs|json|html|css)$/.test(e.name) && !/\.map$/.test(e.name) && e.name !== "package.json") {
      if (/lib|dist|client|server|host|web|public|assets|locales/i.test(full) || depth <= 1) corpusFiles.push(full);
    }
  }
};
walk(dshRoot, 0);
// SKILL.md 的 frontmatter 描述行也是渲染文案来源（技能目录经后端下发到 "/" 菜单）
const skillMd = [];
const walkMd = (dir, depth) => {
  if (depth > 4) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkMd(full, depth + 1);
    else if (e.name === "SKILL.md") skillMd.push(full);
  }
};
walkMd(dshRoot, 0);
corpusFiles.push(...skillMd);
const corpus = corpusFiles.map((f) => readFileSync(f, "utf8")).join("\n");
console.error(`语料：${corpusFiles.length} 个官方文件，${(corpus.length / 1e6).toFixed(1)}MB`);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const { file, sec, en, zh } of literalSections) {
  if (sec === "patterns") {
    // 正则词条：取字面片段（≥4 个连续非元字符，不含括号——括号常是分组语法而非原文）
    // 逐段探测，全部片段落空才算死
    const frags = (en.match(/[A-Za-z][A-Za-z0-9 .,:;!?&·'"\/-]{3,}/g) ?? []).filter((f) => /[A-Za-z]{2}/.test(f));
    if (frags.length && !frags.some((f) => corpus.includes(f))) {
      lines.push(`[${file}/${sec}] 失配 | "${en}" → ${String(zh).slice(0, 30)}`);
      dead++;
    }
    continue;
  }
  // 两级探测：原样子串命中；或 {param} 占位符宽松化后的正则命中（官方改了占位符内容）
  const relaxed = new RegExp(esc(en).replace(/\\\{[^}]{1,40}?\\\}/g, "\\{[^}]{0,60}?\\}"));
  if (!corpus.includes(en) && !relaxed.test(corpus)) {
    lines.push(`[${file}/${sec}] 失配 | "${en}" → ${String(zh).slice(0, 30)}`);
    dead++;
  }
}

// ---- 3. pluginInfo：对 loader 注册表（bundle patch × 2 + 用户 patch）∪ Agent 预设组合行 ----
const registryIds = new Set();
const registryFiles = [
  join(root, "@deepseek-ai/dsh-base/cordis.patch.yml"),
  join(root, "@deepseek-ai/dsh-web-app/cordis.patch.yml"),
  join(process.env.HOME ?? "", ".dsh/profiles/web/cordis.patch.yml"),
  ...["standard", "cordis", "minimal", "ptc"].map((p) =>
    join(root, "@deepseek-ai/dsh-agent-presets/presets", p, "agent.cordis.yml")),
];
for (const f of registryFiles) {
  if (!existsSync(f)) continue;
  for (const m of readFileSync(f, "utf8").matchAll(/-\s*id:\s*([\w/-]+)/g)) registryIds.add(m[1]);
}
{
  const pluginInfo = load("30-plugin-info.json").pluginInfo;
  for (const [k, v] of Object.entries(pluginInfo)) {
    if (k.startsWith("$")) continue;
    // dsh- 前缀是包名别名（双 id 设计），不是 loader id，跳过存活判定
    if (k.startsWith("dsh-")) continue;
    if (!registryIds.has(k)) { lines.push(`[30-plugin-info] id 不在 loader 注册表 | ${k} = ${String(v).slice(0, 30)}`); dead++; }
  }
  const uncovered = [...registryIds].filter((i) => !(i in pluginInfo));
  if (uncovered.length) lines.push(`[30-plugin-info] 注册表有 id 无释义 | ${uncovered.join(", ")}`);
}

const report = lines.length ? lines.join("\n") : "全部词条存活。";
console.log(report);
console.log(`\n死词条 ${dead} 条；官方键全集 ${officialKeys.size} 键`);
if (outFile) { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, report + "\n"); }
process.exitCode = lines.length ? 1 : 0;
