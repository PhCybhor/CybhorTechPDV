"use strict";

const fs = require("fs");
const path = require("path");

const electron = path.join(__dirname, "..", "electron");

function ler(nome) {
  return fs.readFileSync(path.join(electron, nome), "utf8");
}

/**
 * Require no corpo de function conta como lazy.
 * Bloco solto no módulo (if/while) ainda roda no load: é topo.
 * `//` precedido de `\` não é comentário (`/^https?:\/\//`).
 */
function classificarRequireLocal(src) {
  const re = /^require\s*\(\s*(['"])\.\/assistenteLocal\1\s*\)/;
  const frames = [];
  const hunts = [];
  const topo = [];
  const lazy = [];
  const stack = ["code"];
  let i = 0;
  let arrow = false;

  function modo() {
    return stack[stack.length - 1];
  }

  function palavraFunction(pos) {
    if (src.slice(pos, pos + 8) !== "function") return false;
    const antes = src[pos - 1];
    const depois = src[pos + 8];
    if (antes && /[\w$]/.test(antes)) return false;
    if (depois && /[\w$]/.test(depois)) return false;
    return true;
  }

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const k = modo();

    if (k === "line") {
      if (c === "\n") stack.pop();
      i++;
      continue;
    }
    if (k === "block") {
      if (c === "*" && n === "/") {
        stack.pop();
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (k === "s" || k === "d") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if ((k === "s" && c === "'") || (k === "d" && c === '"')) stack.pop();
      i++;
      continue;
    }
    if (k === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i++;
        continue;
      }
      if (c === "$" && n === "{") {
        stack.push("code");
        frames.push("interp");
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (c === "/" && n === "/" && src[i - 1] !== "\\") {
      stack.push("line");
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      stack.push("block");
      i += 2;
      continue;
    }
    if (c === "'") {
      stack.push("s");
      i++;
      continue;
    }
    if (c === '"') {
      stack.push("d");
      i++;
      continue;
    }
    if (c === "`") {
      stack.push("tpl");
      i++;
      continue;
    }

    if (arrow) {
      if (c === " " || c === "\n" || c === "\t" || c === "\r") {
        i++;
        continue;
      }
      if (c === "{") {
        frames.push("fn");
        arrow = false;
        i++;
        continue;
      }
      arrow = false;
    }

    if (c === "(" || c === ")" || c === "{" || c === "}") {
      const hunt = hunts[hunts.length - 1];
      if (hunt && !hunt.done) {
        if (c === "(") {
          hunt.paren++;
          hunt.seenParen = true;
          i++;
          continue;
        }
        if (c === ")" && hunt.paren > 0) {
          hunt.paren--;
          i++;
          continue;
        }
        if (c === "{") {
          if (hunt.paren > 0 || hunt.inner > 0) hunt.inner++;
          else if (hunt.seenParen) {
            frames.push("fn");
            hunts.pop();
          } else frames.push("block");
          i++;
          continue;
        }
        if (c === "}" && hunt.inner > 0) {
          hunt.inner--;
          i++;
          continue;
        }
      }
    }

    if (c === "{") {
      frames.push("block");
      i++;
      continue;
    }
    if (c === "}") {
      const top = frames[frames.length - 1];
      if (top === "interp") stack.pop();
      if (frames.length) frames.pop();
      i++;
      continue;
    }
    if (c === "=" && n === ">") {
      arrow = true;
      i += 2;
      continue;
    }
    if (palavraFunction(i)) {
      hunts.push({ paren: 0, seenParen: false, inner: 0, done: false });
      i += 8;
      continue;
    }
    if (c === "r") {
      const m = re.exec(src.slice(i));
      if (m) {
        (frames.includes("fn") ? lazy : topo).push(i);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }

  return { topo, lazy };
}

function iaHardwareSemPesos(src) {
  const pesos = [
    /\.gguf\b/i,
    /\.safetensors\b/i,
    /\.onnx\b/i,
    /llama\.cpp/i,
    /node-llama/i,
    /@xenova/i,
    /\btransformers\b/i,
    /from_pretrained/i,
    /load(?:Model|Weights)\b/i,
    /ollama\s+pull/i,
    /\/api\/pull\b/,
    /require\(\s*["'][^"']*(?:gguf|onnxruntime|@huggingface)[^"']*["']\s*\)/i,
  ];
  return !pesos.some((re) => re.test(src));
}

function geminiSemHardFail(src) {
  return !/mensagem\.length\s*>/.test(src);
}

function journalUserData(src) {
  const nome = "cybhor-ia-journal.jsonl";
  let idx = 0;
  let achou = 0;
  while ((idx = src.indexOf(nome, idx)) !== -1) {
    achou++;
    const janela = src.slice(Math.max(0, idx - 400), idx);
    if (!/app\.getPath\(\s*["']userData["']\s*\)/.test(janela)) return false;
    idx += nome.length;
  }
  return achou > 0;
}

function ragSemRede(src) {
  if (/https?:\/\//.test(src)) return false;
  if (/\bfetch\s*\(/.test(src)) return false;
  if (/require\(\s*["'](?:node:)?https?["']\s*\)/.test(src)) return false;
  if (/\baxios\b/.test(src)) return false;
  return true;
}

function exigir(cond, msg) {
  if (!cond) {
    console.error("FAIL  scanner — " + msg);
    process.exit(1);
  }
}

function checarScanner() {
  const casos = [
    ['require("./assistenteLocal");', 1, 0],
    ["function f(){ require('./assistenteLocal'); }", 0, 1],
    ["async function f(o = {}){ require(\"./assistenteLocal\"); }", 0, 1],
    ["if (true) { require(\"./assistenteLocal\"); }", 1, 0],
    ['const s = "require(\\"./assistenteLocal\\")";', 0, 0],
    ["function f(){ const s = `a ${1}`; require(\"./assistenteLocal\"); }", 0, 1],
    [
      'if (!/^https?:\\/\\//i.test(t)) { function f(){ require("./assistenteLocal"); } }',
      0,
      1,
    ],
  ];
  for (const [codigo, nTopo, nLazy] of casos) {
    const r = classificarRequireLocal(codigo);
    exigir(
      r.topo.length === nTopo && r.lazy.length === nLazy,
      JSON.stringify({ codigo, r, nTopo, nLazy })
    );
  }
}

function manual() {
  console.log("");
  console.log("MANUAL");
  console.log("- Abrir caixa enquanto indexarDocumentos roda → UI responsiva");
  console.log("- localOk=false → zero calls to :11434 during chat");
  console.log("- Mensagem 50k chars → sucesso sem toast de limite");
}

function main() {
  checarScanner();
  const itens = [
    {
      nome: "iaHardware não importa/carrega pesos de modelo",
      ok: iaHardwareSemPesos(ler("iaHardware.js")),
    },
    {
      nome: "assistenteGemini não rejeita com mensagem.length >",
      ok: geminiSemHardFail(ler("assistenteGemini.js")),
    },
    {
      nome: 'main.js não faz require("./assistenteLocal") no topo',
      ok: (() => {
        const r = classificarRequireLocal(ler("main.js"));
        return r.topo.length === 0 && r.lazy.length >= 1;
      })(),
    },
    {
      nome: "journal em userData (cybhor-ia-journal.jsonl)",
      ok: journalUserData(ler("main.js")),
    },
    {
      nome: "ragStore sem sync de rede",
      ok: ragSemRede(ler("ragStore.js")),
    },
  ];

  let ok = true;
  for (const item of itens) {
    if (!item.ok) ok = false;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.nome}`);
  }
  manual();
  process.exit(ok ? 0 : 1);
}

main();
