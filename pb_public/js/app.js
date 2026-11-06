/* Sistema de Pareceres - aplicação (JavaScript puro, sem internet) */
"use strict";

// ================= utilidades =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CARGOS = ["Professor(a)", "Coordenadora Pedagógica", "Orientadora Educacional", "Secretária", "Diretora"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const byNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");
const byNumero = (a, b) => (a.numero || 9999) - (b.numero || 9999) || (a.created || "").localeCompare(b.created || "");
const byOrdem = (a, b) => (a.ordem || 0) - (b.ordem || 0) || a.created.localeCompare(b.created);

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dataParaBanco = (ymd) => (ymd ? `${ymd} 12:00:00.000Z` : "");
const dataDoBanco = (v) => (v ? String(v).slice(0, 10) : "");
function dataExtenso(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
function dataCurta(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
function frase(t) {
  t = String(t || "").trim();
  if (!t) return "";
  return /[.!?;:]$/.test(t) ? t : t + ".";
}

function toast(msg, err) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 2600);
}

// ================= API (PocketBase) =================
const api = {
  async req(method, path, body) {
    const r = await fetch("/api/" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      let msg = j.message || "Erro ao comunicar com o banco.";
      if (j.data && Object.keys(j.data).length) msg += " (" + Object.entries(j.data).map(([k, v]) => `${k}: ${v.message}`).join("; ") + ")";
      throw new Error(msg);
    }
    return j;
  },
  async list(col, { filter, sort, expand } = {}) {
    let page = 1, out = [];
    for (;;) {
      const q = new URLSearchParams({ page, perPage: 500, skipTotal: "1" });
      if (filter) q.set("filter", filter);
      if (sort) q.set("sort", sort);
      if (expand) q.set("expand", expand);
      const j = await this.req("GET", `collections/${col}/records?${q}`);
      out = out.concat(j.items);
      if (j.items.length < 500) break;
      page++;
    }
    return out;
  },
  get: (col, id, expand) => api.req("GET", `collections/${col}/records/${id}` + (expand ? `?expand=${expand}` : "")),
  create: (col, data) => api.req("POST", `collections/${col}/records`, data),
  update: (col, id, data) => api.req("PATCH", `collections/${col}/records/${id}`, data),
  del: (col, id) => api.req("DELETE", `collections/${col}/records/${id}`),
};
const q = (v) => `"${String(v).replace(/"/g, '\\"')}"`; // aspas para filtros

async function getPeriodos() {
  return (await api.list("periodos")).sort(byOrdem);
}
const opcoesPeriodo = (periodos, atual) => {
  const nomes = periodos.map((p) => p.nome);
  if (atual && !nomes.includes(atual)) nomes.push(atual);
  return nomes.map((n) => `<option ${n === atual ? "selected" : ""}>${esc(n)}</option>`).join("");
};
const PROMPT_PADRAO = `Você é uma professora de Educação Infantil escrevendo o campo "Observação" de um parecer descritivo.

Escreva UM parágrafo curto (de 3 a 5 frases), em português do Brasil, em 3ª pessoa, referindo-se ao aluno apenas como "a criança".

Regras:
- Baseie-se SOMENTE nos objetivos alcançados listados abaixo. Não invente fatos, comportamentos ou dificuldades.
- Faça uma síntese do desenvolvimento, sem repetir os objetivos literalmente e sem listá-los.
- Use linguagem acolhedora, positiva e adequada para os responsáveis lerem.
- Não use títulos, listas, aspas nem emojis. Responda apenas com o parágrafo.

Faixa etária: {faixa}

Objetivos alcançados neste período, por campo de experiência:
{objetivos}`;
function montarPrompt(modelo, faixa, camposTxt, anotacoes) {
  let p = (modelo || PROMPT_PADRAO).replace(/\{faixa\}/g, faixa || "").replace(/\{objetivos\}/g, camposTxt);
  if (anotacoes) p += `\n\nAnotações da professora (use somente se forem relevantes):\n${anotacoes}`;
  return p;
}
async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok;
  }
}
async function getConfig() {
  const l = await api.list("config");
  if (l.length) return l[0];
  return api.create("config", { escola: "", cidade: "", sistema_padrao: "", periodo_padrao: "" });
}

// ================= modal =================
function modal({ title, body, okText = "Salvar", wide = false, onOk, cancelText = "Cancelar", danger = false }) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal ${wide ? "wide" : ""}">
      <div class="modal-h">${esc(title)}</div>
      <div class="modal-b"></div>
      <div class="modal-f"><button data-x>${esc(cancelText)}</button><button class="${danger ? "danger" : "pri"}" data-ok>${esc(okText)}</button></div></div>`;
    const b = $(".modal-b", bg);
    if (typeof body === "string") b.innerHTML = body; else b.appendChild(body);
    root.appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    $("[data-x]", bg).onclick = () => close(null);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(null); });
    const ok = async () => {
      try {
        const v = onOk ? await onOk(b) : true;
        if (v === false) return;
        close(v === undefined ? true : v);
      } catch (e) { toast(e.message, true); }
    };
    $("[data-ok]", bg).onclick = ok;
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") close(null); if (e.key === "Enter" && e.target.tagName === "INPUT") ok(); });
    const f = $("input,select,textarea", b);
    if (f) setTimeout(() => f.focus(), 30);
  });
}
const confirmar = (msg, okText = "Excluir") => modal({ title: "Confirmar", body: `<p>${msg}</p>`, okText, danger: true });

// ================= roteamento =================
const routes = {};
async function router() {
  const h = location.hash.replace(/^#\/?/, "") || "pareceres";
  const [name, ...args] = h.split("/");
  $$("#menu a").forEach((a) => a.classList.toggle("active", a.dataset.r === (name === "parecer" ? "pareceres" : name)));
  const main = $("#main");
  main.innerHTML = `<div class="empty">Carregando...</div>`;
  try {
    await (routes[name] || routes.pareceres)(main, ...args);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p><p class="hint">Verifique se o sistema foi iniciado pelo atalho "Iniciar Sistema".</p></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

// ================= PESSOAS =================
routes.pessoas = async (main) => {
  const pessoas = (await api.list("pessoas")).sort(byNome);
  let filtro = sessionStorage.getItem("f_cargo") || "";
  const draw = () => {
    const lista = pessoas.filter((p) => !filtro || p.cargo === filtro);
    main.innerHTML = `
      <div class="page-head"><div><h1>Professores e equipe</h1><p>Professores, coordenação, orientação, secretaria e direção.</p></div>
        <div class="actions"><button class="pri" id="novo">+ Nova pessoa</button></div></div>
      <div class="card">
        <div class="filters"><select id="fc"><option value="">Todos os cargos</option>${CARGOS.map((c) => `<option ${c === filtro ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <table class="t"><thead><tr><th>Nome</th><th>Cargo</th><th>Portaria</th><th></th></tr></thead><tbody>
        ${lista.map((p) => `<tr><td>${esc(p.nome)}</td><td><span class="badge gray">${esc(p.cargo)}</span></td><td>${esc(p.portaria)}</td>
          <td class="act"><button class="sm" data-e="${p.id}">Editar</button> <button class="sm danger" data-d="${p.id}">Excluir</button></td></tr>`).join("") ||
          `<tr><td colspan="4" class="empty">Nenhuma pessoa cadastrada.</td></tr>`}
        </tbody></table></div>`;
    $("#fc").onchange = (e) => { filtro = e.target.value; sessionStorage.setItem("f_cargo", filtro); draw(); };
    $("#novo").onclick = () => editar();
    $$("[data-e]").forEach((b) => (b.onclick = () => editar(pessoas.find((p) => p.id === b.dataset.e))));
    $$("[data-d]").forEach((b) => (b.onclick = async () => {
      const p = pessoas.find((x) => x.id === b.dataset.d);
      if (!(await confirmar(`Excluir <b>${esc(p.nome)}</b>?`))) return;
      try { await api.del("pessoas", p.id); pessoas.splice(pessoas.indexOf(p), 1); draw(); toast("Excluído."); } catch (e) { toast(e.message, true); }
    }));
  };
  const editar = async (p) => {
    const r = await modal({
      title: p ? "Editar pessoa" : "Nova pessoa",
      body: `<div class="grid">
        <label class="f">Nome<input type="text" id="m_nome" value="${esc(p?.nome)}"></label>
        <label class="f">Cargo<select id="m_cargo">${CARGOS.map((c) => `<option ${c === (p?.cargo || filtro) ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="f">Portaria <span class="hint">Opcional. Já vem preenchida no parecer, e pode ser alterada lá.</span><input type="text" id="m_port" value="${esc(p?.portaria)}"></label></div>`,
      onOk: async (b) => {
        const d = { nome: $("#m_nome", b).value.trim(), cargo: $("#m_cargo", b).value, portaria: $("#m_port", b).value.trim() };
        if (!d.nome) { toast("Informe o nome.", true); return false; }
        return p ? api.update("pessoas", p.id, d) : api.create("pessoas", d);
      },
    });
    if (r) { const i = pessoas.findIndex((x) => x.id === r.id); if (i >= 0) pessoas[i] = r; else pessoas.push(r); pessoas.sort(byNome); draw(); toast("Salvo."); }
  };
  draw();
};

// ================= TURMAS =================
routes.turmas = async (main) => {
  const [turmas, faixas, pessoas, alunos] = await Promise.all([
    api.list("turmas"), api.list("faixas"), api.list("pessoas", { filter: `cargo=${q(CARGOS[0])}` }), api.list("alunos"),
  ]);
  turmas.sort(byNome); faixas.sort(byOrdem); pessoas.sort(byNome);
  const nome = (arr, id) => arr.find((x) => x.id === id)?.nome || "";
  const draw = () => {
    main.innerHTML = `
      <div class="page-head"><div><h1>Turmas</h1><p>Cada turma tem uma faixa etária (define os objetivos) e seus professores.</p></div>
        <div class="actions"><button class="pri" id="novo">+ Nova turma</button></div></div>
      <div class="card"><table class="t"><thead><tr><th>Turma</th><th>Faixa etária</th><th>Professores</th><th>Alunos</th><th></th></tr></thead><tbody>
      ${turmas.map((t) => `<tr><td><b>${esc(t.nome)}</b></td><td>${esc(nome(faixas, t.faixa)) || '<span class="badge warn">sem faixa</span>'}</td>
        <td>${(t.professores || []).map((id) => esc(nome(pessoas, id))).filter(Boolean).join(", ") || '<span class="hint">nenhum</span>'}</td>
        <td><a href="#/alunos/${t.id}">${alunos.filter((a) => a.turma === t.id).length}</a></td>
        <td class="act"><button class="sm" data-ch="${t.id}">📋 Chamada</button> <button class="sm" data-e="${t.id}">Editar</button> <button class="sm danger" data-d="${t.id}">Excluir</button></td></tr>`).join("") ||
        `<tr><td colspan="5" class="empty">Nenhuma turma cadastrada.</td></tr>`}
      </tbody></table></div>`;
    $("#novo").onclick = () => editar();
    $$("[data-e]").forEach((b) => (b.onclick = () => editar(turmas.find((t) => t.id === b.dataset.e))));
    $$("[data-ch]").forEach((b) => (b.onclick = () => chamada(turmas.find((t) => t.id === b.dataset.ch))));
    $$("[data-d]").forEach((b) => (b.onclick = async () => {
      const t = turmas.find((x) => x.id === b.dataset.d);
      if (alunos.some((a) => a.turma === t.id)) return toast("Esta turma tem alunos. Mova ou exclua os alunos antes.", true);
      if (!(await confirmar(`Excluir a turma <b>${esc(t.nome)}</b>?`))) return;
      try { await api.del("turmas", t.id); turmas.splice(turmas.indexOf(t), 1); draw(); toast("Excluída."); } catch (e) { toast(e.message, true); }
    }));
  };
  // lista de chamada: escolhe o mês e a orientadora e abre a impressão
  const chamada = async (t) => {
    const lista = alunos.filter((a) => a.turma === t.id).sort(byNumero);
    if (!lista.length) return toast("Esta turma não tem alunos cadastrados.", true);
    let orientadoras = [], cfg = {};
    try { [orientadoras, cfg] = await Promise.all([api.list("pessoas", { filter: `cargo=${q(CARGOS[2])}` }), getConfig()]); } catch (e) { return toast(e.message, true); }
    orientadoras.sort(byNome);
    const agora = new Date();
    const mesSalvo = parseInt(sessionStorage.getItem("ch_mes"), 10);
    const mes0 = mesSalvo >= 0 && mesSalvo <= 11 ? mesSalvo : agora.getMonth();
    const ano0 = sessionStorage.getItem("ch_ano") || agora.getFullYear();
    const ori0 = sessionStorage.getItem("ch_ori") || (orientadoras.length === 1 ? orientadoras[0].id : "");
    const r = await modal({
      title: "Lista de chamada — " + t.nome,
      okText: "Gerar PDF",
      body: `<div class="grid">
        <div class="grid g2"><label class="f">Mês<select id="m_mes">${MESES.map((m, i) => `<option value="${i}" ${i === mes0 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="f">Ano<input type="text" inputmode="numeric" id="m_ano" value="${esc(ano0)}"></label></div>
        <label class="f">Orientadora Educacional<select id="m_ori"><option value="">(não informar)</option>${orientadoras.map((p) => `<option value="${p.id}" ${p.id === ori0 ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select>
          ${orientadoras.length ? "" : '<span class="hint">Nenhuma orientadora cadastrada. Cadastre em "Professores e equipe".</span>'}</label>
        <p class="hint" style="margin:0">${lista.length} aluno(s), em ordem de número. Os dias letivos são anotados à mão no cabeçalho.</p></div>`,
      onOk: (b) => {
        const ano = $("#m_ano", b).value.trim();
        if (!/^\d{4}$/.test(ano)) { toast("Informe o ano com 4 dígitos.", true); return false; }
        return { mes: parseInt($("#m_mes", b).value, 10), ano, ori: $("#m_ori", b).value };
      },
    });
    if (!r) return;
    sessionStorage.setItem("ch_mes", r.mes); sessionStorage.setItem("ch_ano", r.ano); sessionStorage.setItem("ch_ori", r.ori);
    imprimirChamada({
      escola: cfg.escola || "",
      turma: t.nome,
      faixa: nome(faixas, t.faixa),
      profs: (t.professores || []).map((id) => nome(pessoas, id)).filter(Boolean).join(", "),
      mes: MESES[r.mes], ano: r.ano,
      orientadora: orientadoras.find((p) => p.id === r.ori)?.nome || "",
    }, lista);
  };
  const editar = async (t) => {
    const sel = new Set(t?.professores || []);
    const r = await modal({
      title: t ? "Editar turma" : "Nova turma",
      body: `<div class="grid">
        <label class="f">Nome da turma<input type="text" id="m_nome" value="${esc(t?.nome)}" placeholder="Ex.: Berçário A"></label>
        <label class="f">Faixa etária<select id="m_faixa"><option value="">Selecione...</option>${faixas.map((f) => `<option value="${f.id}" ${f.id === t?.faixa ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}</select></label>
        <div class="f"><label class="f">Professores da turma</label>
          <div class="chips" id="m_profs">${pessoas.map((p) => `<label class="chip ${sel.has(p.id) ? "on" : ""}"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? "checked" : ""}>${esc(p.nome)}</label>`).join("") ||
          '<span class="hint">Nenhum professor cadastrado. Cadastre em "Professores e equipe".</span>'}</div></div></div>`,
      onOk: async (b) => {
        const d = { nome: $("#m_nome", b).value.trim(), faixa: $("#m_faixa", b).value, professores: $$("#m_profs input:checked", b).map((i) => i.value) };
        if (!d.nome) { toast("Informe o nome da turma.", true); return false; }
        if (!d.faixa) { toast("Selecione a faixa etária.", true); return false; }
        return t ? api.update("turmas", t.id, d) : api.create("turmas", d);
      },
    });
    if (r) { const i = turmas.findIndex((x) => x.id === r.id); if (i >= 0) turmas[i] = r; else turmas.push(r); turmas.sort(byNome); draw(); toast("Salvo."); }
  };
  draw();
};
document.addEventListener("change", chipSync);
function chipSync(e) {
  if (e.target.matches(".chip input")) e.target.closest(".chip").classList.toggle("on", e.target.checked);
}

// ================= ALUNOS =================
routes.alunos = async (main, turmaParam) => {
  const [alunos, turmas] = await Promise.all([api.list("alunos"), api.list("turmas")]);
  turmas.sort(byNome);
  const tIdx = (id) => turmas.findIndex((t) => t.id === id);
  const ordena = () => alunos.sort((a, b) => tIdx(a.turma) - tIdx(b.turma) || byNumero(a, b));
  const proxNumero = (turma, excetoId) => Math.max(0, ...alunos.filter((a) => a.turma === turma && a.id !== excetoId).map((a) => a.numero || 0)) + 1;
  ordena();
  let ft = turmaParam || sessionStorage.getItem("f_turma") || (turmas[0]?.id ?? "");
  let busca = "";
  const draw = () => {
    const lista = alunos.filter((a) => (!ft || a.turma === ft) && (!busca || a.nome.toLowerCase().includes(busca.toLowerCase())));
    main.innerHTML = `
      <div class="page-head"><div><h1>Alunos</h1><p>Cadastro dos alunos, separados por turma.</p></div>
        <div class="actions"><button id="varios">+ Adicionar vários</button><button class="pri" id="novo">+ Novo aluno</button></div></div>
      <div class="card">
        <div class="filters"><select id="ft"><option value="">Todas as turmas</option>${turmas.map((t) => `<option value="${t.id}" ${t.id === ft ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select>
          <input type="search" id="bs" placeholder="Buscar aluno..." value="${esc(busca)}"></div>
        <table class="t"><thead><tr><th>Nº</th><th>Nome do aluno</th><th>Turma</th><th></th></tr></thead><tbody>
        ${lista.map((a) => `<tr><td><span class="badge gray">${a.numero ?? ""}</span></td><td>${esc(a.nome)}</td><td>${esc(turmas.find((t) => t.id === a.turma)?.nome)}</td>
          <td class="act"><button class="sm" data-e="${a.id}">Editar</button> <button class="sm danger" data-d="${a.id}">Excluir</button></td></tr>`).join("") ||
          `<tr><td colspan="4" class="empty">${turmas.length ? "Nenhum aluno nesta turma." : "Cadastre uma turma primeiro."}</td></tr>`}
        </tbody></table></div>`;
    $("#ft").onchange = (e) => { ft = e.target.value; sessionStorage.setItem("f_turma", ft); draw(); };
    $("#bs").oninput = (e) => { busca = e.target.value; const pos = e.target.selectionStart; draw(); const n = $("#bs"); n.focus(); n.setSelectionRange(pos, pos); };
    $("#novo").onclick = () => editar();
    $("#varios").onclick = varios;
    $$("[data-e]").forEach((b) => (b.onclick = () => editar(alunos.find((a) => a.id === b.dataset.e))));
    $$("[data-d]").forEach((b) => (b.onclick = async () => {
      const a = alunos.find((x) => x.id === b.dataset.d);
      if (!(await confirmar(`Excluir <b>${esc(a.nome)}</b>? Os pareceres deste aluno também serão excluídos.`))) return;
      try { await api.del("alunos", a.id); alunos.splice(alunos.indexOf(a), 1); draw(); toast("Excluído."); } catch (e) { toast(e.message, true); }
    }));
  };
  const turmaSelect = (id) => `<select id="m_turma">${turmas.map((t) => `<option value="${t.id}" ${t.id === id ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select>`;
  const editar = async (a) => {
    if (!turmas.length) return toast("Cadastre uma turma primeiro.", true);
    const r = await modal({
      title: a ? "Editar aluno" : "Novo aluno",
      body: (() => {
        const turma0 = a?.turma || ft || turmas[0].id;
        const div = document.createElement("div");
        div.className = "grid";
        div.innerHTML = `<label class="f">Nome do aluno<input type="text" id="m_nome" value="${esc(a?.nome)}"></label>
          <div class="grid g2"><label class="f">Turma${turmaSelect(turma0)}</label>
          <label class="f">Nº na turma <span class="hint">Ordem de entrada. Define a ordem no parecer.</span><input type="text" inputmode="numeric" id="m_num" value="${a ? a.numero ?? "" : proxNumero(turma0)}"></label></div>`;
        $("#m_turma", div).onchange = (e) => {
          $("#m_num", div).value = a && e.target.value === a.turma ? a.numero ?? "" : proxNumero(e.target.value, a?.id);
        };
        return div;
      })(),
      onOk: async (b) => {
        const d = { nome: $("#m_nome", b).value.trim(), turma: $("#m_turma", b).value, numero: parseInt($("#m_num", b).value, 10) };
        if (!d.nome) { toast("Informe o nome.", true); return false; }
        if (!(d.numero > 0)) { toast("Informe o número do aluno na turma.", true); return false; }
        const dup = alunos.find((x) => x.turma === d.turma && x.numero === d.numero && x.id !== a?.id);
        if (dup) { toast(`O número ${d.numero} já é de ${dup.nome} nesta turma.`, true); return false; }
        return a ? api.update("alunos", a.id, d) : api.create("alunos", d);
      },
    });
    if (r) { const i = alunos.findIndex((x) => x.id === r.id); if (i >= 0) alunos[i] = r; else alunos.push(r); ordena(); draw(); toast("Salvo."); }
  };
  const varios = async () => {
    if (!turmas.length) return toast("Cadastre uma turma primeiro.", true);
    const r = await modal({
      title: "Adicionar vários alunos",
      body: `<div class="grid"><label class="f">Turma${turmaSelect(ft)}</label>
        <label class="f">Nomes <span class="hint">Um nome por linha, na ordem de entrada na turma. Os números continuam a partir do último aluno da turma.</span><textarea id="m_nomes" rows="10"></textarea></label></div>`,
      okText: "Adicionar",
      onOk: async (b) => {
        const turma = $("#m_turma", b).value;
        const nomes = $("#m_nomes", b).value.split(/\r?\n/).map((s) => s.replace(/^\s*\d+[\s.)-]+/, "").trim()).filter(Boolean);
        if (!nomes.length) { toast("Cole ao menos um nome.", true); return false; }
        const out = [];
        let numero = proxNumero(turma);
        for (const nome of nomes) out.push(await api.create("alunos", { nome, turma, numero: numero++ }));
        return out;
      },
    });
    if (r) { alunos.push(...r); ordena(); draw(); toast(`${r.length} aluno(s) adicionados.`); }
  };
  draw();
};

// ================= OBJETIVOS =================
routes.objetivos = async (main) => {
  const [faixas, campos, objetivos] = await Promise.all([api.list("faixas"), api.list("campos"), api.list("objetivos")]);
  faixas.sort(byOrdem); campos.sort(byOrdem); objetivos.sort(byOrdem);
  let fx = sessionStorage.getItem("o_faixa") || faixas[0]?.id || "";
  let cp = sessionStorage.getItem("o_campo") || campos[0]?.id || "";
  if (!faixas.some((f) => f.id === fx)) fx = faixas[0]?.id || "";
  if (!campos.some((c) => c.id === cp)) cp = campos[0]?.id || "";
  let editId = null;

  const draw = () => {
    const lista = objetivos.filter((o) => o.faixa === fx && o.campo === cp);
    const cnt = (cid) => objetivos.filter((o) => o.faixa === fx && o.campo === cid).length;
    main.innerHTML = `
      <div class="page-head"><div><h1>Objetivos</h1><p>As respostas que aparecem como checklist em cada campo de experiência.</p></div>
        <div class="actions"><button id="gfaixas">Faixas etárias</button><button id="gcampos">Campos de experiência</button></div></div>
      <div class="card">
        <div class="filters"><label class="f">Faixa etária<select id="fx">${faixas.map((f) => `<option value="${f.id}" ${f.id === fx ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}</select></label></div>
        <div class="tabs">${campos.map((c) => `<button class="tab ${c.id === cp ? "on" : ""}" data-cp="${c.id}">${esc(c.nome)}<span class="cnt">${cnt(c.id)}</span></button>`).join("")}</div>
        <div class="toolbar"><div class="grow hint">${lista.length} objetivo(s) neste campo. Use as setas para mudar a ordem.</div>
          <button id="colar">Colar vários</button><button class="pri" id="add">+ Novo objetivo</button></div>
        <div id="olist">${lista.map((o, i) => `<div class="obj-row" data-id="${o.id}"><div class="num">${i + 1}</div>
          ${editId === o.id ? `<textarea id="edtxt">${esc(o.texto)}</textarea>
            <div class="btns"><button class="sm pri" data-save>Salvar</button><button class="sm" data-cancel>Cancelar</button></div>`
          : `<div class="txt">${esc(o.texto)}</div>
            <div class="btns"><button class="sm ghost" title="Subir" data-up ${i === 0 ? "disabled" : ""}>▲</button><button class="sm ghost" title="Descer" data-down ${i === lista.length - 1 ? "disabled" : ""}>▼</button>
            <button class="sm" data-edit>Editar</button><button class="sm danger" data-del>Excluir</button></div>`}</div>`).join("") ||
          `<div class="empty">${faixas.length && campos.length ? "Nenhum objetivo neste campo ainda." : "Cadastre uma faixa etária e um campo de experiência."}</div>`}</div>
      </div>`;
    $("#fx") && ($("#fx").onchange = (e) => { fx = e.target.value; sessionStorage.setItem("o_faixa", fx); draw(); });
    $$("[data-cp]").forEach((b) => (b.onclick = () => { cp = b.dataset.cp; sessionStorage.setItem("o_campo", cp); editId = null; draw(); }));
    $("#gfaixas").onclick = () => gerenciar("faixas", "Faixas etárias", faixas);
    $("#gcampos").onclick = () => gerenciar("campos", "Campos de experiência", campos);
    $("#add").onclick = async () => {
      if (!fx || !cp) return toast("Cadastre uma faixa etária e um campo primeiro.", true);
      const r = await modal({
        title: "Novo objetivo",
        body: `<label class="f">Texto do objetivo<textarea id="m_t" rows="4"></textarea></label>`,
        onOk: async (b) => {
          const texto = $("#m_t", b).value.trim();
          if (!texto) { toast("Escreva o objetivo.", true); return false; }
          const ordem = Math.max(0, ...lista.map((o) => o.ordem || 0)) + 1;
          return api.create("objetivos", { texto, faixa: fx, campo: cp, ordem });
        },
      });
      if (r) { objetivos.push(r); draw(); toast("Objetivo adicionado."); }
    };
    $("#colar").onclick = async () => {
      if (!fx || !cp) return toast("Cadastre uma faixa etária e um campo primeiro.", true);
      const r = await modal({
        title: "Colar vários objetivos",
        body: `<label class="f">Um objetivo por linha <span class="hint">Números no início da linha são removidos automaticamente.</span><textarea id="m_t" rows="12"></textarea></label>`,
        okText: "Adicionar",
        onOk: async (b) => {
          const linhas = $("#m_t", b).value.split(/\r?\n/).map((s) => s.replace(/^\s*\d+[\s.)-]*/, "").trim()).filter(Boolean);
          if (!linhas.length) { toast("Cole ao menos uma linha.", true); return false; }
          let ordem = Math.max(0, ...lista.map((o) => o.ordem || 0));
          const out = [];
          for (const texto of linhas) out.push(await api.create("objetivos", { texto, faixa: fx, campo: cp, ordem: ++ordem }));
          return out;
        },
      });
      if (r) { objetivos.push(...r); draw(); toast(`${r.length} objetivo(s) adicionados.`); }
    };
    $$("#olist .obj-row").forEach((row) => {
      const o = objetivos.find((x) => x.id === row.dataset.id);
      const i = lista.indexOf(o);
      const on = (sel, fn) => { const b = $(sel, row); if (b) b.onclick = fn; };
      on("[data-edit]", () => { editId = o.id; draw(); const t = $("#edtxt"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
      on("[data-cancel]", () => { editId = null; draw(); });
      on("[data-save]", async () => {
        const texto = $("#edtxt").value.trim();
        if (!texto) return toast("O texto não pode ficar vazio.", true);
        try { Object.assign(o, await api.update("objetivos", o.id, { texto })); editId = null; draw(); toast("Salvo."); } catch (e) { toast(e.message, true); }
      });
      on("[data-del]", async () => {
        if (!(await confirmar(`Excluir este objetivo?<br><br><i>${esc(o.texto)}</i><br><br>Ele também sai dos pareceres em que estava marcado.`))) return;
        try { await api.del("objetivos", o.id); objetivos.splice(objetivos.indexOf(o), 1); draw(); toast("Excluído."); } catch (e) { toast(e.message, true); }
      });
      const mover = async (d) => {
        const arr = lista.slice();
        [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
        try {
          for (let k = 0; k < arr.length; k++) if (arr[k].ordem !== k + 1) { arr[k].ordem = k + 1; await api.update("objetivos", arr[k].id, { ordem: k + 1 }); }
          objetivos.sort(byOrdem); draw();
        } catch (e) { toast(e.message, true); }
      };
      on("[data-up]", () => mover(-1));
      on("[data-down]", () => mover(1));
    });
  };

  const gerenciar = async (col, titulo, arr) => {
    const box = document.createElement("div");
    const drawBox = () => {
      box.innerHTML = `<div class="hint" style="margin-bottom:10px">${col === "campos" ? "Os campos aparecem no parecer nesta ordem." : "Cada turma é ligada a uma faixa etária."}</div>
        ${arr.map((x, i) => `<div class="obj-row"><div class="num">${i + 1}</div><input type="text" value="${esc(x.nome)}" data-id="${x.id}">
          <div class="btns"><button class="sm ghost" data-up="${i}" ${i === 0 ? "disabled" : ""}>▲</button><button class="sm ghost" data-down="${i}" ${i === arr.length - 1 ? "disabled" : ""}>▼</button><button class="sm danger" data-del="${x.id}">Excluir</button></div></div>`).join("")}
        <div class="obj-row"><div class="num">+</div><input type="text" id="novo_nome" placeholder="Adicionar novo..."><div class="btns"><button class="sm pri" id="novo_add">Adicionar</button></div></div>`;
      $$("input[data-id]", box).forEach((inp) => (inp.onchange = async () => {
        const x = arr.find((y) => y.id === inp.dataset.id);
        const nome = inp.value.trim(); if (!nome) return;
        try { Object.assign(x, await api.update(col, x.id, { nome })); toast("Salvo."); } catch (e) { toast(e.message, true); }
      }));
      $$("[data-del]", box).forEach((b) => (b.onclick = async () => {
        const x = arr.find((y) => y.id === b.dataset.del);
        const n = objetivos.filter((o) => o[col === "campos" ? "campo" : "faixa"] === x.id).length;
        if (!confirm(`Excluir "${x.nome}"?${n ? `\n\nATENÇÃO: ${n} objetivo(s) ligados a ele também serão excluídos.` : ""}`)) return;
        try {
          await api.del(col, x.id); arr.splice(arr.indexOf(x), 1);
          for (let k = objetivos.length - 1; k >= 0; k--) if (objetivos[k][col === "campos" ? "campo" : "faixa"] === x.id) objetivos.splice(k, 1);
          drawBox();
        } catch (e) { toast(e.message, true); }
      }));
      const mv = async (i, d) => {
        [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
        for (let k = 0; k < arr.length; k++) if (arr[k].ordem !== k + 1) { arr[k].ordem = k + 1; await api.update(col, arr[k].id, { ordem: k + 1 }); }
        drawBox();
      };
      $$("[data-up]", box).forEach((b) => (b.onclick = () => mv(+b.dataset.up, -1)));
      $$("[data-down]", box).forEach((b) => (b.onclick = () => mv(+b.dataset.down, 1)));
      const add = async () => {
        const nome = $("#novo_nome", box).value.trim(); if (!nome) return;
        try { arr.push(await api.create(col, { nome, ordem: arr.length + 1 })); drawBox(); $("#novo_nome", box).focus(); } catch (e) { toast(e.message, true); }
      };
      $("#novo_add", box).onclick = add;
      $("#novo_nome", box).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); add(); } };
    };
    drawBox();
    await modal({ title: titulo, body: box, okText: "Fechar", cancelText: "Voltar", wide: true });
    if (!faixas.some((f) => f.id === fx)) fx = faixas[0]?.id || "";
    if (!campos.some((c) => c.id === cp)) cp = campos[0]?.id || "";
    draw();
  };
  draw();
};

// ================= OBSERVAÇÕES PRONTAS =================
routes.observacoes = async (main) => {
  const itens = (await api.list("obs_prontas")).sort(byOrdem);
  let editId = null;
  const draw = () => {
    main.innerHTML = `
      <div class="page-head"><div><h1>Observações prontas</h1><p>Frases que aparecem para marcar no campo Observação de cada aluno. Ao marcar, a frase entra no texto, que continua podendo ser editado.</p></div>
        <div class="actions"><button id="colar">Colar várias</button><button class="pri" id="add">+ Nova observação</button></div></div>
      <div class="card"><div id="olist">${itens.map((o, i) => `<div class="obj-row" data-id="${o.id}"><div class="num">${i + 1}</div>
        ${editId === o.id ? `<textarea id="edtxt">${esc(o.texto)}</textarea>
          <div class="btns"><button class="sm pri" data-save>Salvar</button><button class="sm" data-cancel>Cancelar</button></div>`
        : `<div class="txt">${esc(o.texto)}</div>
          <div class="btns"><button class="sm ghost" title="Subir" data-up ${i === 0 ? "disabled" : ""}>▲</button><button class="sm ghost" title="Descer" data-down ${i === itens.length - 1 ? "disabled" : ""}>▼</button>
          <button class="sm" data-edit>Editar</button><button class="sm danger" data-del>Excluir</button></div>`}</div>`).join("") ||
        `<div class="empty">Nenhuma observação pronta cadastrada.</div>`}</div></div>`;
    $("#add").onclick = async () => {
      const r = await modal({
        title: "Nova observação pronta",
        body: `<label class="f">Texto<textarea id="m_t" rows="4"></textarea></label>`,
        onOk: async (b) => {
          const texto = $("#m_t", b).value.trim();
          if (!texto) { toast("Escreva o texto.", true); return false; }
          return api.create("obs_prontas", { texto, ordem: itens.length + 1 });
        },
      });
      if (r) { itens.push(r); draw(); toast("Adicionada."); }
    };
    $("#colar").onclick = async () => {
      const r = await modal({
        title: "Colar várias observações",
        body: `<label class="f">Uma observação por linha<textarea id="m_t" rows="10"></textarea></label>`,
        okText: "Adicionar",
        onOk: async (b) => {
          const linhas = $("#m_t", b).value.split(/\r?\n/).map((x) => x.replace(/^\s*\d+[\s.)-]*/, "").trim()).filter(Boolean);
          if (!linhas.length) { toast("Cole ao menos uma linha.", true); return false; }
          const out = []; let ordem = itens.length;
          for (const texto of linhas) out.push(await api.create("obs_prontas", { texto, ordem: ++ordem }));
          return out;
        },
      });
      if (r) { itens.push(...r); draw(); toast(`${r.length} observação(ões) adicionada(s).`); }
    };
    $$("#olist .obj-row").forEach((row) => {
      const o = itens.find((x) => x.id === row.dataset.id);
      const i = itens.indexOf(o);
      const on = (sel, fn) => { const b = $(sel, row); if (b) b.onclick = fn; };
      on("[data-edit]", () => { editId = o.id; draw(); $("#edtxt").focus(); });
      on("[data-cancel]", () => { editId = null; draw(); });
      on("[data-save]", async () => {
        const texto = $("#edtxt").value.trim(); if (!texto) return toast("O texto não pode ficar vazio.", true);
        try { Object.assign(o, await api.update("obs_prontas", o.id, { texto })); editId = null; draw(); toast("Salvo."); } catch (e) { toast(e.message, true); }
      });
      on("[data-del]", async () => {
        if (!(await confirmar(`Excluir esta observação pronta?<br><br><i>${esc(o.texto)}</i><br><br>Os pareceres já preenchidos não são alterados.`))) return;
        try { await api.del("obs_prontas", o.id); itens.splice(i, 1); draw(); toast("Excluída."); } catch (e) { toast(e.message, true); }
      });
      const mover = async (d) => {
        [itens[i], itens[i + d]] = [itens[i + d], itens[i]];
        try { for (let k = 0; k < itens.length; k++) if (itens[k].ordem !== k + 1) { itens[k].ordem = k + 1; await api.update("obs_prontas", itens[k].id, { ordem: k + 1 }); } } catch (e) { toast(e.message, true); }
        draw();
      };
      on("[data-up]", () => mover(-1));
      on("[data-down]", () => mover(1));
    });
  };
  draw();
};

// ================= PERÍODOS =================
routes.periodos = async (main) => {
  const [periodos, pareceres] = await Promise.all([getPeriodos(), api.list("pareceres")]);
  const usos = (nome) => pareceres.filter((p) => p.periodo === nome).length;
  const draw = () => {
    main.innerHTML = `
      <div class="page-head"><div><h1>Períodos</h1><p>Os períodos que podem ser escolhidos no parecer (trimestres, semestres...). A ordem aqui é a ordem das listas.</p></div>
        <div class="actions"><button class="pri" id="novo">+ Novo período</button></div></div>
      <div class="card"><table class="t"><thead><tr><th style="width:60px">Ordem</th><th>Período</th><th>Pareceres</th><th></th></tr></thead><tbody>
      ${periodos.map((p, i) => `<tr><td class="hint">${i + 1}</td><td><b>${esc(p.nome)}</b></td><td>${usos(p.nome) || '<span class="hint">0</span>'}</td>
        <td class="act"><button class="sm ghost" data-up="${i}" ${i === 0 ? "disabled" : ""} title="Subir">▲</button><button class="sm ghost" data-down="${i}" ${i === periodos.length - 1 ? "disabled" : ""} title="Descer">▼</button>
        <button class="sm" data-e="${p.id}">Editar</button> <button class="sm danger" data-d="${p.id}">Excluir</button></td></tr>`).join("") ||
        `<tr><td colspan="4" class="empty">Nenhum período cadastrado.</td></tr>`}
      </tbody></table></div>`;
    $("#novo").onclick = () => editar();
    $$("[data-e]").forEach((b) => (b.onclick = () => editar(periodos.find((p) => p.id === b.dataset.e))));
    $$("[data-d]").forEach((b) => (b.onclick = async () => {
      const p = periodos.find((x) => x.id === b.dataset.d);
      const n = usos(p.nome);
      if (n) return toast(`Este período é usado em ${n} parecer(es) e não pode ser excluído.`, true);
      if (!(await confirmar(`Excluir o período <b>${esc(p.nome)}</b>?`))) return;
      try { await api.del("periodos", p.id); periodos.splice(periodos.indexOf(p), 1); draw(); toast("Excluído."); } catch (e) { toast(e.message, true); }
    }));
    const mv = async (i, d) => {
      [periodos[i], periodos[i + d]] = [periodos[i + d], periodos[i]];
      try { for (let k = 0; k < periodos.length; k++) if (periodos[k].ordem !== k + 1) { periodos[k].ordem = k + 1; await api.update("periodos", periodos[k].id, { ordem: k + 1 }); } } catch (e) { toast(e.message, true); }
      draw();
    };
    $$("[data-up]").forEach((b) => (b.onclick = () => mv(+b.dataset.up, -1)));
    $$("[data-down]").forEach((b) => (b.onclick = () => mv(+b.dataset.down, 1)));
  };
  const editar = async (p) => {
    const antigo = p?.nome;
    const r = await modal({
      title: p ? "Editar período" : "Novo período",
      body: `<label class="f">Nome do período <span class="hint">Como deve aparecer no parecer. Ex.: 1º TRIMESTRE</span><input type="text" id="m_nome" value="${esc(p?.nome)}"></label>`,
      onOk: async (b) => {
        const nome = $("#m_nome", b).value.trim().toUpperCase();
        if (!nome) { toast("Informe o nome.", true); return false; }
        if (periodos.some((x) => x.nome === nome && x.id !== p?.id)) { toast("Já existe um período com esse nome.", true); return false; }
        return p ? api.update("periodos", p.id, { nome }) : api.create("periodos", { nome, ordem: periodos.length + 1 });
      },
    });
    if (!r) return;
    if (p && antigo !== r.nome) {
      // renomeia também nos pareceres e na configuração
      for (const pa of pareceres.filter((x) => x.periodo === antigo)) { await api.update("pareceres", pa.id, { periodo: r.nome }); pa.periodo = r.nome; }
      if (sessionStorage.getItem("f_periodo") === antigo) sessionStorage.setItem("f_periodo", r.nome);
      const c = await getConfig(); if (c.periodo_padrao === antigo) await api.update("config", c.id, { periodo_padrao: r.nome });
    }
    const i = periodos.findIndex((x) => x.id === r.id); if (i >= 0) periodos[i] = r; else periodos.push(r);
    draw(); toast("Salvo.");
  };
  draw();
};

// ================= CONFIGURAÇÕES =================
routes.config = async (main) => {
  const [c, periodos] = await Promise.all([getConfig(), getPeriodos()]);
  main.innerHTML = `
    <div class="page-head"><div><h1>Configurações</h1><p>Valores que já vêm preenchidos em cada novo parecer.</p></div></div>
    <div class="card"><div class="grid g2">
      <label class="f">Nome da escola (Estabelecimento)<input type="text" id="c_escola" value="${esc(c.escola)}"></label>
      <label class="f">Cidade (Local)<input type="text" id="c_cidade" value="${esc(c.cidade)}"></label>
      <label class="f">Período padrão <span class="hint">(cadastre em <a href="#/periodos">Períodos</a>)</span><select id="c_periodo"><option value="">—</option>${opcoesPeriodo(periodos, c.periodo_padrao)}</select></label>
      <label class="f">Sistema de avaliação (padrão)<input type="text" id="c_sistema" value="${esc(c.sistema_padrao)}"></label>
    </div>
    <div style="margin-top:16px"><button class="pri" id="salvar">Salvar configurações</button></div></div>
    <div class="card"><div class="card-head"><h2>Prompt para IA (ChatGPT)</h2><button class="sm" id="c_prompt_padrao">Restaurar texto padrão</button></div>
      <p class="hint" style="margin-top:0">É o texto que o botão "Gerar prompt para IA" monta na Observação de cada aluno. Use <b>{faixa}</b> onde deve entrar a faixa etária e <b>{objetivos}</b> onde entram os objetivos marcados. O nome do aluno nunca é incluído.</p>
      <textarea id="c_prompt" rows="14">${esc(c.prompt_ia || PROMPT_PADRAO)}</textarea>
      <div style="margin-top:12px"><button class="pri" id="salvar2">Salvar configurações</button></div></div>
    <div class="card"><h2>Backup (cópia de segurança)</h2>
      <p>Todos os dados ficam na pasta <b>pb_data</b>, dentro da pasta do sistema.</p>
      <p>Para fazer backup, use o atalho <b>Fazer Backup</b> da pasta do sistema. Ele cria uma cópia na pasta <b>backups</b>, com data e hora. Copie essa pasta para um pendrive de vez em quando.</p></div>`;
  $("#c_prompt_padrao").onclick = () => { $("#c_prompt").value = PROMPT_PADRAO; toast('Texto padrão restaurado. Clique em "Salvar configurações".'); };
  $("#salvar").onclick = $("#salvar2").onclick = async () => {
    try {
      const prompt = $("#c_prompt").value.trim();
      if (prompt && !prompt.includes("{objetivos}")) return toast("O prompt precisa ter {objetivos} em algum lugar.", true);
      await api.update("config", c.id, { escola: $("#c_escola").value.trim(), cidade: $("#c_cidade").value.trim(), periodo_padrao: $("#c_periodo").value.trim(), sistema_padrao: $("#c_sistema").value.trim(),
        prompt_ia: prompt === PROMPT_PADRAO.trim() ? "" : prompt });
      toast("Configurações salvas."); atualizarMarca();
    } catch (e) { toast(e.message, true); }
  };
};
async function atualizarMarca() {
  try { const c = await getConfig(); $("#brand-escola").textContent = c.escola || "Educação Infantil"; } catch (e) {}
}

// ================= PARECERES (lista) =================
routes.pareceres = async (main) => {
  const [todos, turmas, pas, periodos] = await Promise.all([api.list("pareceres", { sort: "-data,-created" }), api.list("turmas"), api.list("parecer_alunos", { sort: "created" }), getPeriodos()]);
  const tn = (id) => turmas.find((t) => t.id === id)?.nome || "(turma excluída)";
  const nomesPer = periodos.map((p) => p.nome);
  todos.forEach((p) => { if (p.periodo && !nomesPer.includes(p.periodo)) nomesPer.push(p.periodo); });
  let fp = sessionStorage.getItem("f_periodo") || "";
  if (fp && !nomesPer.includes(fp)) fp = "";
  const pareceres = todos.filter((p) => !fp || p.periodo === fp);
  main.innerHTML = `
    <div class="page-head"><div><h1>Pareceres</h1><p>Um parecer por turma e período, com um parecer para cada aluno no mesmo arquivo.</p></div>
      <div class="actions"><button class="pri" id="novo">+ Novo parecer</button></div></div>
    <div class="card">
      <div class="filters"><label class="f">Período<select id="fp"><option value="">Todos os períodos</option>${nomesPer.map((n) => `<option ${n === fp ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div>
      <table class="t"><thead><tr><th>Turma</th><th>Período</th><th>Data</th><th>Preenchimento</th><th></th></tr></thead><tbody>
    ${pareceres.map((p) => {
      const l = pas.filter((x) => x.parecer === p.id);
      const feitos = l.filter((x) => (x.objetivos || []).length).length;
      const pct = l.length ? Math.round((feitos / l.length) * 100) : 0;
      return `<tr><td><b>${esc(tn(p.turma))}</b></td><td>${esc(p.periodo)}</td><td>${dataCurta(dataDoBanco(p.data))}</td>
        <td><div style="display:flex;align-items:center;gap:10px"><div class="progress" style="width:110px"><div style="width:${pct}%"></div></div><span class="hint">${feitos}/${l.length} alunos</span></div></td>
        <td class="act"><button class="sm pri" data-open="${p.id}">Abrir</button> <button class="sm" data-word="${p.id}">Word</button> <button class="sm" data-pdf="${p.id}">PDF</button> <button class="sm danger" data-d="${p.id}">Excluir</button></td></tr>`;
    }).join("") || `<tr><td colspan="5" class="empty">${todos.length ? "Nenhum parecer neste período." : "Nenhum parecer ainda. Clique em <b>+ Novo parecer</b> para começar."}</td></tr>`}
    </tbody></table></div>
    ${turmas.length ? "" : `<div class="card"><h2>Primeiros passos</h2><ol>
      <li>Em <a href="#/config">Configurações</a>, preencha o nome da escola e a cidade.</li>
      <li>Em <a href="#/pessoas">Professores e equipe</a>, cadastre professores, coordenadora, orientadora, secretária e diretora.</li>
      <li>Em <a href="#/turmas">Turmas</a>, crie as turmas e escolha os professores de cada uma.</li>
      <li>Em <a href="#/alunos">Alunos</a>, cadastre os alunos de cada turma.</li>
      <li>Volte aqui e crie o parecer.</li></ol></div>`}`;
  $("#fp").onchange = (e) => { sessionStorage.setItem("f_periodo", e.target.value); router(); };
  $("#novo").onclick = () => (location.hash = "#/parecer/novo");
  $$("[data-open]").forEach((b) => (b.onclick = () => (location.hash = "#/parecer/" + b.dataset.open)));
  $$("[data-word]").forEach((b) => (b.onclick = () => escolherEExportar(b.dataset.word, "word")));
  $$("[data-pdf]").forEach((b) => (b.onclick = () => escolherEExportar(b.dataset.pdf, "pdf")));
  $$("[data-d]").forEach((b) => (b.onclick = async () => {
    const p = pareceres.find((x) => x.id === b.dataset.d);
    if (!(await confirmar(`Excluir o parecer de <b>${esc(tn(p.turma))}</b> (${esc(p.periodo)})? Todas as marcações dos alunos serão perdidas.`))) return;
    try { await api.del("pareceres", p.id); toast("Parecer excluído."); router(); } catch (e) { toast(e.message, true); }
  }));
};

// ================= PARECER (cadastro + preenchimento) =================
routes.parecer = async (main, id) => {
  const novo = !id || id === "novo";
  const [cfg, turmas, pessoas, faixas, periodos] = await Promise.all([getConfig(), api.list("turmas"), api.list("pessoas"), api.list("faixas"), getPeriodos()]);
  turmas.sort(byNome); pessoas.sort(byNome);
  const P = novo
    ? { escola: cfg.escola, cidade: cfg.cidade, sistema: cfg.sistema_padrao, periodo: sessionStorage.getItem("f_periodo") || cfg.periodo_padrao || periodos[0]?.nome || "", data: dataParaBanco(hoje()), professores: [] }
    : await api.get("pareceres", id);
  const porCargo = (c) => pessoas.filter((p) => p.cargo === c);
  const pessoa = (pid) => pessoas.find((p) => p.id === pid);
  const unico = (c) => { const l = porCargo(c); return l.length === 1 ? l[0] : null; };
  if (novo) {
    // se só houver uma pessoa no cargo, já seleciona
    [["coordenadora", "coord_port", CARGOS[1]], ["orientadora", "orient_port", CARGOS[2]], ["secretaria", "sec_port", CARGOS[3]], ["diretora", "dir_port", CARGOS[4]]].forEach(([k, kp, c]) => {
      const u = unico(c); if (u) { P[k] = u.id; P[kp] = u.portaria || ""; }
    });
  }

  const selPessoa = (campo, campoPort, cargo) => `
    <label class="f">${cargo}<div class="pair">
      <select data-k="${campo}" data-port="${campoPort}"><option value="">Selecione...</option>${porCargo(cargo).map((p) => `<option value="${p.id}" ${p.id === P[campo] ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select>
      <input type="text" data-k="${campoPort}" placeholder="Portaria" value="${esc(P[campoPort])}"></div></label>`;

  const profsChips = () => {
    const t = turmas.find((x) => x.id === P.turma);
    if (!t) return `<span class="hint">Selecione a turma para ver os professores dela.</span>`;
    const lista = (t.professores || []).map(pessoa).filter(Boolean);
    if (!lista.length) return `<span class="hint">Esta turma não tem professores. Vincule em <a href="#/turmas">Turmas</a>.</span>`;
    const sel = new Set(P.professores || []);
    return lista.map((p) => `<label class="chip ${sel.has(p.id) ? "on" : ""} ${!sel.has(p.id) && sel.size >= 3 ? "dis" : ""}"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? "checked" : ""} ${!sel.has(p.id) && sel.size >= 3 ? "disabled" : ""}>${esc(p.nome)}</label>`).join("");
  };

  main.innerHTML = `
    <div class="page-head"><div><a href="#/pareceres" class="hint">← Voltar para pareceres</a><h1>${novo ? "Novo parecer" : "Parecer — " + esc(turmas.find((t) => t.id === P.turma)?.nome || "")}</h1>
      ${novo ? "<p>Preencha o cadastro inicial. Depois, marque os objetivos de cada aluno.</p>" : ""}</div>
      <div class="actions">${novo ? "" : `<span class="save-state" id="st"></span><button id="bword">⬇ Baixar Word</button><button id="bpdf">⬇ Gerar PDF</button>`}</div></div>
    <div class="card" id="cab">
      <div class="collapse-head" id="cab-h"><h2 style="margin:0">Cadastro inicial</h2>${novo ? "" : `<button class="sm ghost" id="cab-t">Mostrar / ocultar</button>`}</div>
      ${novo ? "" : `<div class="summary-line" id="cab-sum"></div>`}
      <div id="cab-b" style="margin-top:14px; ${novo ? "" : "display:none"}">
        <div class="grid g3">
          <label class="f span2">Escola (Estabelecimento)<input type="text" data-k="escola" value="${esc(P.escola)}"></label>
          <label class="f">Data<input type="date" data-k="data" value="${dataDoBanco(P.data)}"></label>
          <label class="f">Turma<select data-k="turma" ${novo ? "" : "disabled title='A turma não pode ser alterada depois de criado o parecer'"}><option value="">Selecione...</option>${turmas.map((t) => `<option value="${t.id}" ${t.id === P.turma ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select></label>
          <label class="f">Período<select data-k="periodo">${P.periodo ? "" : '<option value="">Selecione...</option>'}${opcoesPeriodo(periodos, P.periodo)}</select></label>
          <label class="f">Local (Cidade)<input type="text" data-k="cidade" value="${esc(P.cidade)}"></label>
          <label class="f span2">Sistema de avaliação — Progressão continuada<input type="text" data-k="sistema" value="${esc(P.sistema)}"></label>
        </div>
        <div class="f" style="margin-top:16px"><label class="f">Professores <span class="hint">(no máximo 3, somente os da turma)</span></label><div class="chips" id="profs">${profsChips()}</div></div>
        <div class="grid g2" style="margin-top:16px">
          ${selPessoa("coordenadora", "coord_port", CARGOS[1])}
          ${selPessoa("orientadora", "orient_port", CARGOS[2])}
          ${selPessoa("secretaria", "sec_port", CARGOS[3])}
          ${selPessoa("diretora", "dir_port", CARGOS[4])}
        </div>
        ${novo ? `<div style="margin-top:18px"><button class="pri" id="criar">Criar parecer e preencher alunos →</button></div>` : ""}
      </div>
    </div>
    <div id="alunos-area"></div>`;

  const cab = $("#cab");
  const resumo = () => {
    const s = $("#cab-sum"); if (!s) return;
    const profs = (P.professores || []).map((i) => pessoa(i)?.nome).filter(Boolean).join(", ");
    s.textContent = `${P.periodo || ""} · ${dataCurta(dataDoBanco(P.data))} · Professores: ${profs || "—"}`;
  };
  resumo();
  if (!novo) $("#cab-t").onclick = () => { const b = $("#cab-b"); b.style.display = b.style.display === "none" ? "" : "none"; };

  // salvamento do cabeçalho
  let salvaTimer;
  const st = (t, ok) => { const e = $("#st"); if (e) { e.textContent = t; e.className = "save-state" + (ok ? " ok" : ""); } };
  const salvarCab = () => {
    if (novo) return;
    clearTimeout(salvaTimer);
    st("Salvando...");
    salvaTimer = setTimeout(async () => {
      try {
        const { id: _i, collectionId, collectionName, created, updated, expand, ...d } = P;
        await api.update("pareceres", id, d);
        st("✓ Salvo", true); resumo();
      } catch (e) { st(""); toast(e.message, true); }
    }, 500);
  };
  cab.addEventListener("input", (e) => {
    const k = e.target.dataset.k; if (!k) return;
    P[k] = k === "data" ? dataParaBanco(e.target.value) : e.target.value;
    if (e.target.tagName !== "SELECT") salvarCab();
  });
  cab.addEventListener("change", (e) => {
    const t = e.target;
    if (t.closest("#profs")) {
      P.professores = $$("#profs input:checked").map((i) => i.value);
      $("#profs").innerHTML = profsChips(); salvarCab(); return;
    }
    const k = t.dataset.k; if (!k) return;
    P[k] = k === "data" ? dataParaBanco(t.value) : t.value;
    if (t.dataset.port) { // preenche a portaria com a do cadastro
      const pp = pessoa(t.value); P[t.dataset.port] = pp?.portaria || ""; $(`[data-k="${t.dataset.port}"]`, cab).value = P[t.dataset.port];
    }
    if (k === "turma") {
      const tt = turmas.find((x) => x.id === P.turma);
      const profs = (tt?.professores || []).filter((pid) => pessoa(pid));
      P.professores = profs.length <= 3 ? profs : [];
      $("#profs").innerHTML = profsChips();
    }
    salvarCab();
  });

  if (novo) {
    $("#criar").onclick = async (ev) => {
      if (!P.turma) return toast("Selecione a turma.", true);
      if (!P.periodo) return toast("Selecione o período. Cadastre em Períodos, se precisar.", true);
      const t = turmas.find((x) => x.id === P.turma);
      if (!t.faixa) return toast("Esta turma não tem faixa etária. Ajuste em Turmas.", true);
      const alunos = (await api.list("alunos", { filter: `turma=${q(P.turma)}` })).sort(byNumero);
      if (!alunos.length) return toast("Esta turma não tem alunos cadastrados.", true);
      ev.target.disabled = true;
      try {
        const r = await api.create("pareceres", P);
        for (const a of alunos) await api.create("parecer_alunos", { parecer: r.id, aluno: a.id, objetivos: [], observacao: "" });
        toast("Parecer criado!");
        location.hash = "#/parecer/" + r.id;
      } catch (e) { ev.target.disabled = false; toast(e.message, true); }
    };
    return;
  }

  $("#bword").onclick = () => escolherEExportar(id, "word");
  $("#bpdf").onclick = () => escolherEExportar(id, "pdf");
  await preencherAlunos($("#alunos-area"), P, turmas, faixas);
};

async function preencherAlunos(area, P, turmas, faixas) {
  const turma = turmas.find((t) => t.id === P.turma);
  const [pas, campos, objetivos, obsProntas] = await Promise.all([
    api.list("parecer_alunos", { filter: `parecer=${q(P.id)}`, expand: "aluno" }),
    api.list("campos"),
    api.list("objetivos", { filter: `faixa=${q(turma?.faixa || "")}` }),
    api.list("obs_prontas"),
  ]);
  campos.sort(byOrdem); objetivos.sort(byOrdem); obsProntas.sort(byOrdem);
  const nomeAluno = (pa) => pa.expand?.aluno?.nome || "(aluno)";
  pas.sort((a, b) => byNumero(a.expand?.aluno || {}, b.expand?.aluno || {}));
  const faixa = faixas.find((f) => f.id === turma?.faixa);
  let atual = pas[0]?.id;
  let campoAtual = campos[0]?.id;
  let busca = "";

  const salvarTimers = {};
  const salvarPA = (pa) => {
    const st = $("#st"); if (st) { st.textContent = "Salvando..."; st.className = "save-state"; }
    clearTimeout(salvarTimers[pa.id]);
    salvarTimers[pa.id] = setTimeout(async () => {
      try {
        await api.update("parecer_alunos", pa.id, { objetivos: pa.objetivos, observacao: pa.observacao });
        if (st) { st.textContent = "✓ Salvo"; st.className = "save-state ok"; }
      } catch (e) { toast(e.message, true); }
    }, 400);
  };

  const textoCampo = (pa, cid) => objetivos.filter((o) => o.campo === cid && pa.objetivos.includes(o.id)).map((o) => frase(o.texto)).join(" ");

  const desenhaLista = () => {
    const box = $("#al-items"); if (!box) return;
    box.innerHTML = pas.map((pa, i) => {
      const n = pa.objetivos.length;
      const camposFeitos = campos.filter((c) => objetivos.some((o) => o.campo === c.id && pa.objetivos.includes(o.id))).length;
      const cls = n === 0 ? "" : camposFeitos === campos.length ? "ok" : "part";
      return `<div class="al-item ${pa.id === atual ? "on" : ""}" data-pa="${pa.id}"><div class="dot ${cls}" title="Nº ${pa.expand?.aluno?.numero ?? ""}">${pa.expand?.aluno?.numero ?? i + 1}</div><div class="nm">${esc(nomeAluno(pa))}</div><div class="n">${n || ""}</div></div>`;
    }).join("");
    $$(".al-item", box).forEach((el) => (el.onclick = () => { atual = el.dataset.pa; desenha(); }));
    const feitos = pas.filter((p) => p.objetivos.length).length;
    $("#al-prog").innerHTML = `<div class="progress"><div style="width:${pas.length ? (feitos / pas.length) * 100 : 0}%"></div></div><div class="hint" style="margin-top:6px">${feitos} de ${pas.length} alunos com marcações</div>`;
  };

  const desenha = () => {
    const pa = pas.find((x) => x.id === atual);
    const idx = pas.indexOf(pa);
    area.innerHTML = `<div class="editor">
      <div class="card alunos-list"><div class="al-head"><div style="display:flex;justify-content:space-between;align-items:center"><b>Alunos (${pas.length})</b><button class="sm ghost" id="sync" title="Incluir alunos cadastrados depois">↻ Atualizar</button></div><div id="al-prog" style="margin-top:8px"></div></div><div class="al-items" id="al-items"></div></div>
      <div>${pa ? `
        <div class="card">
          <div class="student-head"><div><div class="hint">Nº ${esc(pa.expand?.aluno?.numero ?? idx + 1)} · Aluno ${idx + 1} de ${pas.length} · ${esc(faixa?.nome || "")}</div><h2>${esc(nomeAluno(pa))}</h2></div>
            <div class="actions"><button id="w1" title="Baixar Word só deste aluno">⬇ Word deste aluno</button><button id="p1" title="Gerar PDF só deste aluno">⬇ PDF deste aluno</button><button id="copiar">Copiar marcações de outro aluno</button><button id="prev" ${idx <= 0 ? "disabled" : ""}>← Anterior</button><button class="pri" id="next" ${idx >= pas.length - 1 ? "disabled" : ""}>Próximo →</button></div></div>
          <div class="tabs">${campos.map((c) => {
            const n = objetivos.filter((o) => o.campo === c.id && pa.objetivos.includes(o.id)).length;
            return `<button class="tab ${c.id === campoAtual ? "on" : ""}" data-c="${c.id}">${esc(c.nome)}<span class="cnt">${n}</span></button>`;
          }).join("")}</div>
          <div class="toolbar"><input type="search" id="busca" class="grow" placeholder="Filtrar objetivos deste campo..." value="${esc(busca)}" style="max-width:360px">
            <div class="grow"></div><button class="sm" id="todos">Marcar todos</button><button class="sm" id="nenhum">Desmarcar todos</button></div>
          <div class="obj-list" id="objs"></div>
          ${objetivos.length ? "" : `<div class="empty">Não há objetivos cadastrados para a faixa etária desta turma. Cadastre em <a href="#/objetivos">Objetivos</a>.</div>`}
        </div>
        <div class="card">
          <div class="card-head" style="margin-bottom:6px"><label class="f" for="obs" style="margin:0">Observação <span class="hint">(aparece no final do parecer deste aluno; escreva livremente, marque respostas prontas ou use a IA)</span></label>
            <button class="sm" id="obs-ia" title="Monta um texto para colar no ChatGPT com os objetivos marcados deste aluno">✨ Gerar prompt para IA</button></div>
          <textarea id="obs" rows="4">${esc(pa.observacao)}</textarea>
          <div class="card-head" style="margin:16px 0 6px"><b style="font-size:14px">Respostas prontas</b>
            <div class="actions"><button class="sm" id="obs-salvar" title="Guarda o texto da observação (ou o trecho selecionado) para usar com outros alunos">+ Salvar texto como resposta pronta</button><a href="#/observacoes" class="hint">Gerenciar</a></div></div>
          <div class="obj-list" id="obs-prontas"></div>
        </div>
        <div class="card"><div class="card-head"><h2>Como vai ficar no documento</h2></div><div class="preview" id="prev-txt"></div></div>`
        : `<div class="card empty">Nenhum aluno neste parecer. Clique em "↻ Atualizar" para incluir os alunos da turma.</div>`}
      </div></div>`;
    desenhaLista();
    $("#sync").onclick = sincronizar;
    if (!pa) return;

    const desenhaObjs = () => {
      const lista = objetivos.filter((o) => o.campo === campoAtual);
      const filtrada = lista.filter((o) => !busca || o.texto.toLowerCase().includes(busca.toLowerCase()));
      $("#objs").innerHTML = filtrada.map((o) => {
        const on = pa.objetivos.includes(o.id);
        return `<label class="obj ${on ? "on" : ""}"><input type="checkbox" value="${o.id}" ${on ? "checked" : ""}><span class="num">${lista.indexOf(o) + 1}</span><span>${esc(o.texto)}</span></label>`;
      }).join("") || (lista.length ? `<div class="empty">Nenhum objetivo encontrado.</div>` : `<div class="empty">Nenhum objetivo neste campo.</div>`);
    };
    const desenhaPrev = () => {
      $("#prev-txt").innerHTML = campos.map((c) => `<b>${esc(c.nome)}:</b>${esc(textoCampo(pa, c.id)) || '<span class="hint">(nada marcado)</span>'}`).join("") +
        `<b>Observação:</b>${esc(pa.observacao) || '<span class="hint">(vazio)</span>'}`;
    };
    const atualizaContadores = () => {
      $$(".tabs .tab").forEach((t) => { $(".cnt", t).textContent = objetivos.filter((o) => o.campo === t.dataset.c && pa.objetivos.includes(o.id)).length; });
      desenhaLista(); desenhaPrev();
    };
    desenhaObjs(); desenhaPrev();

    $$(".tabs .tab").forEach((t) => (t.onclick = () => { campoAtual = t.dataset.c; busca = ""; desenha(); }));
    $("#objs").addEventListener("change", (e) => {
      const cb = e.target; if (cb.type !== "checkbox") return;
      if (cb.checked) { if (!pa.objetivos.includes(cb.value)) pa.objetivos.push(cb.value); } else pa.objetivos = pa.objetivos.filter((x) => x !== cb.value);
      cb.closest(".obj").classList.toggle("on", cb.checked);
      atualizaContadores(); salvarPA(pa);
    });
    $("#busca").oninput = (e) => { busca = e.target.value; desenhaObjs(); };
    $("#todos").onclick = () => {
      const ids = objetivos.filter((o) => o.campo === campoAtual && (!busca || o.texto.toLowerCase().includes(busca.toLowerCase()))).map((o) => o.id);
      pa.objetivos = [...new Set(pa.objetivos.concat(ids))]; desenhaObjs(); atualizaContadores(); salvarPA(pa);
    };
    $("#nenhum").onclick = () => {
      const ids = new Set(objetivos.filter((o) => o.campo === campoAtual).map((o) => o.id));
      pa.objetivos = pa.objetivos.filter((x) => !ids.has(x)); desenhaObjs(); atualizaContadores(); salvarPA(pa);
    };
    const desenhaObsProntas = () => {
      const atualObs = pa.observacao || "";
      $("#obs-prontas").innerHTML = obsProntas.map((o, i) => {
        const on = atualObs.includes(frase(o.texto));
        return `<label class="obj ${on ? "on" : ""}"><input type="checkbox" value="${o.id}" ${on ? "checked" : ""}><span class="num">${i + 1}</span><span>${esc(o.texto)}</span></label>`;
      }).join("") || `<div class="hint">Nenhuma resposta pronta cadastrada. Escreva uma observação e clique em "+ Salvar texto como resposta pronta".</div>`;
    };
    desenhaObsProntas();
    $("#obs-prontas").addEventListener("change", (e) => {
      const cb = e.target; if (cb.type !== "checkbox") return;
      const t = frase(obsProntas.find((o) => o.id === cb.value).texto);
      let v = pa.observacao || "";
      if (cb.checked) v = v.trim() ? v.replace(/\s+$/, "") + " " + t : t;
      else v = v.split(t).join("").replace(/[ \t]{2,}/g, " ").replace(/^ +| +$/gm, "").trim();
      pa.observacao = v; $("#obs").value = v;
      desenhaObsProntas(); desenhaPrev(); salvarPA(pa);
    });
    $("#obs-ia").onclick = async () => {
      const marcados = campos.map((c) => ({ c, l: objetivos.filter((o) => o.campo === c.id && pa.objetivos.includes(o.id)) }));
      if (!marcados.some((m) => m.l.length)) return toast("Marque os objetivos do aluno primeiro. O prompt é montado a partir deles.", true);
      const cfg = await getConfig();
      const camposTxt = marcados.map((m) => `${m.c.nome}:\n` + (m.l.length ? m.l.map((o) => `- ${frase(o.texto)}`).join("\n") : "- (nenhum objetivo marcado)")).join("\n\n");
      const gerar = (comAnot) => montarPrompt(cfg.prompt_ia, faixa?.nome || "", camposTxt, comAnot ? (pa.observacao || "").trim() : "");
      const box = document.createElement("div");
      box.innerHTML = `
        <div class="grid">
          <div><div class="card-head" style="margin-bottom:6px"><b>1. Copie este texto e cole no ChatGPT</b>
            <div class="actions"><button class="pri sm" id="ia-copiar">📋 Copiar</button><a class="btn sm" href="https://chatgpt.com/" target="_blank" rel="noopener" style="padding:5px 10px;font-size:13px">Abrir ChatGPT ↗</a></div></div>
            <textarea id="ia-prompt" rows="10" style="font-size:13px">${esc(gerar(false))}</textarea>
            ${(pa.observacao || "").trim() ? `<label class="hint" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="ia-anot"> Incluir o que já está escrito na Observação como anotação (confira se não há o nome da criança)</label>` : ""}
            <div class="hint" style="margin-top:6px">O nome do aluno não vai no texto. Precisa de internet só para usar o ChatGPT.</div></div>
          <div><b>2. Cole aqui a resposta do ChatGPT</b>
            <textarea id="ia-resp" rows="5" style="margin-top:6px" placeholder="Cole aqui o parágrafo que o ChatGPT devolveu..."></textarea>
            <div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">
              <label class="hint" style="display:flex;gap:6px;align-items:center"><input type="radio" name="ia-modo" value="sub" checked> Substituir a observação</label>
              <label class="hint" style="display:flex;gap:6px;align-items:center"><input type="radio" name="ia-modo" value="add"> Acrescentar ao final</label></div></div>
        </div>`;
      const anot = $("#ia-anot", box);
      if (anot) anot.onchange = () => { $("#ia-prompt", box).value = gerar(anot.checked); };
      $("#ia-copiar", box).onclick = async () => {
        const ok = await copiarTexto($("#ia-prompt", box).value);
        toast(ok ? "Copiado! Agora cole no ChatGPT (Ctrl+V)." : "Não consegui copiar. Selecione o texto e use Ctrl+C.", !ok);
        if (ok) setTimeout(() => $("#ia-resp", box)?.focus(), 50);
      };
      const r = await modal({
        title: `Observação com IA — ${nomeAluno(pa)}`, body: box, wide: true, okText: "Usar na observação", cancelText: "Fechar",
        onOk: (b) => {
          let t = $("#ia-resp", b).value.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
          if (!t) { toast("Cole a resposta do ChatGPT no passo 2.", true); return false; }
          return { t, modo: $("input[name=ia-modo]:checked", b).value };
        },
      });
      if (!r) return;
      const atualObs = (pa.observacao || "").trim();
      pa.observacao = r.modo === "add" && atualObs ? atualObs + " " + r.t : r.t;
      $("#obs").value = pa.observacao;
      desenhaObsProntas(); desenhaPrev(); salvarPA(pa);
      toast("Observação atualizada. Revise o texto antes de gerar o documento.");
    };
    $("#obs-salvar").onclick = async () => {
      const ta = $("#obs");
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd).trim();
      const r = await modal({
        title: "Salvar como resposta pronta",
        body: `<label class="f">Texto <span class="hint">Pode ajustar antes de salvar. Ele vai aparecer para todos os alunos.</span><textarea id="m_t" rows="4">${esc(sel || ta.value.trim())}</textarea></label>`,
        onOk: async (b) => {
          const texto = $("#m_t", b).value.trim();
          if (!texto) { toast("Escreva o texto.", true); return false; }
          if (obsProntas.some((o) => o.texto === texto)) { toast("Essa resposta pronta já existe.", true); return false; }
          return api.create("obs_prontas", { texto, ordem: obsProntas.length + 1 });
        },
      });
      if (r) { obsProntas.push(r); desenhaObsProntas(); toast("Resposta pronta salva."); }
    };
    $("#obs").oninput = (e) => { pa.observacao = e.target.value; desenhaPrev(); desenhaObsProntas(); salvarPA(pa); };
    $("#prev").onclick = () => { atual = pas[idx - 1].id; desenha(); window.scrollTo(0, 0); };
    $("#next").onclick = () => { atual = pas[idx + 1].id; desenha(); window.scrollTo(0, 0); };
    const exportarEste = async (tipo) => {
      clearTimeout(salvarTimers[pa.id]);
      await api.update("parecer_alunos", pa.id, { objetivos: pa.objetivos, observacao: pa.observacao }); // garante que está salvo
      exportar(P.id, tipo, [pa.id]);
    };
    $("#w1").onclick = () => exportarEste("word");
    $("#p1").onclick = () => exportarEste("pdf");
    $("#copiar").onclick = async () => {
      const outros = pas.filter((x) => x.id !== pa.id && x.objetivos.length);
      if (!outros.length) return toast("Nenhum outro aluno tem marcações ainda.", true);
      const r = await modal({
        title: "Copiar marcações",
        body: `<div class="grid"><label class="f">Copiar de<select id="m_de">${outros.map((o) => `<option value="${o.id}">${esc(nomeAluno(o))} (${o.objetivos.length})</option>`).join("")}</select></label>
          <label class="f">O que copiar<select id="m_modo"><option value="tudo">Todos os campos</option><option value="campo">Somente o campo atual</option></select></label>
          <p class="hint">As marcações atuais de ${esc(nomeAluno(pa))} nos campos copiados serão substituídas. Depois é só ajustar o que for diferente.</p></div>`,
        okText: "Copiar",
        onOk: (b) => ({ de: $("#m_de", b).value, modo: $("#m_modo", b).value }),
      });
      if (!r) return;
      const src = pas.find((x) => x.id === r.de);
      if (r.modo === "tudo") pa.objetivos = src.objetivos.slice();
      else {
        const ids = new Set(objetivos.filter((o) => o.campo === campoAtual).map((o) => o.id));
        pa.objetivos = pa.objetivos.filter((x) => !ids.has(x)).concat(src.objetivos.filter((x) => ids.has(x)));
      }
      salvarPA(pa); desenha(); toast("Marcações copiadas.");
    };
  };

  const sincronizar = async () => {
    const alunos = await api.list("alunos", { filter: `turma=${q(P.turma)}` });
    const ja = new Set(pas.map((p) => p.aluno));
    const novos = alunos.filter((a) => !ja.has(a.id));
    if (!novos.length) return toast("Todos os alunos da turma já estão neste parecer.");
    for (const a of novos) {
      const r = await api.create("parecer_alunos", { parecer: P.id, aluno: a.id, objetivos: [], observacao: "" });
      r.expand = { aluno: a }; pas.push(r);
    }
    pas.sort((a, b) => byNumero(a.expand?.aluno || {}, b.expand?.aluno || {}));
    if (!atual) atual = pas[0]?.id;
    desenha(); toast(`${novos.length} aluno(s) incluído(s).`);
  };
  desenha();
}

// ================= EXPORTAÇÃO (Word / PDF) =================
async function montarDados(parecerId, paIds) {
  const P = await api.get("pareceres", parecerId);
  const [turma, pessoas, pas, campos] = await Promise.all([
    api.get("turmas", P.turma), api.list("pessoas"),
    api.list("parecer_alunos", { filter: `parecer=${q(parecerId)}`, expand: "aluno" }), api.list("campos"),
  ]);
  const objetivos = (await api.list("objetivos", { filter: `faixa=${q(turma.faixa || "")}` })).sort(byOrdem);
  campos.sort(byOrdem);
  const nm = (id) => pessoas.find((p) => p.id === id)?.nome || "";
  const geral = {
    escola: P.escola, cidade: P.cidade, sistema: P.sistema, periodo: (P.periodo || "").toUpperCase(), turma: turma.nome,
    data: dataExtenso(dataDoBanco(P.data)), profs: (P.professores || []).map(nm).filter(Boolean),
    coord: nm(P.coordenadora), coord_port: P.coord_port, orient: nm(P.orientadora), orient_port: P.orient_port,
    sec: nm(P.secretaria), sec_port: P.sec_port, dir: nm(P.diretora), dir_port: P.dir_port,
  };
  const alunos = pas
    .filter((pa) => !paIds || paIds.includes(pa.id))
    .map((pa) => ({
      nome: pa.expand?.aluno?.nome || "",
      _ord: pa.expand?.aluno || {},
      observacao: pa.observacao || "",
      campos: campos.map((c) => ({ nome: c.nome, texto: objetivos.filter((o) => o.campo === c.id && (pa.objetivos || []).includes(o.id)).map((o) => frase(o.texto)).join(" ") })),
    }))
    .sort((a, b) => byNumero(a._ord, b._ord));
  const sufixo = alunos.length === 1 && paIds ? ` - ${alunos[0].nome}` : "";
  const arq = `Parecer - ${turma.nome} - ${P.periodo || ""}${sufixo}`.replace(/[\\/:*?"<>|]/g, "-").trim();
  return { geral, alunos, arq };
}

// Pergunta se é para todos os alunos ou só alguns
async function escolherEExportar(parecerId, tipo) {
  try {
    const pas = (await api.list("parecer_alunos", { filter: `parecer=${q(parecerId)}`, expand: "aluno" }))
      .sort((a, b) => byNumero(a.expand?.aluno || {}, b.expand?.aluno || {}));
    if (!pas.length) return toast("Este parecer não tem alunos.", true);
    const box = document.createElement("div");
    box.innerHTML = `
      <div class="grid">
        <label class="chip on" style="justify-content:flex-start;border-radius:8px"><input type="radio" name="modo" value="todos" checked> <b>Todos os alunos</b> <span class="hint">(${pas.length}, um por página, no mesmo arquivo)</span></label>
        <label class="chip" style="justify-content:flex-start;border-radius:8px"><input type="radio" name="modo" value="alguns"> <b>Escolher aluno(s)</b></label>
      </div>
      <div id="lista-al" style="display:none;margin-top:14px">
        <div class="toolbar"><span class="hint grow">Marque os alunos que deseja ${tipo === "word" ? "baixar" : "imprimir"}.</span>
          <button class="sm" data-all>Marcar todos</button><button class="sm" data-none>Desmarcar todos</button></div>
        <div class="obj-list" style="max-height:340px;overflow:auto">${pas.map((pa) => `
          <label class="obj"><input type="checkbox" value="${pa.id}"><span class="num">${esc(pa.expand?.aluno?.numero ?? "")}</span><span>${esc(pa.expand?.aluno?.nome || "")}</span></label>`).join("")}</div>
      </div>`;
    box.addEventListener("change", (e) => {
      if (e.target.name === "modo") {
        $$('input[name=modo]', box).forEach((r) => r.closest(".chip").classList.toggle("on", r.checked));
        $("#lista-al", box).style.display = e.target.value === "alguns" ? "" : "none";
      }
      if (e.target.matches(".obj input")) e.target.closest(".obj").classList.toggle("on", e.target.checked);
    });
    const marcar = (v) => $$(".obj input", box).forEach((c) => { c.checked = v; c.closest(".obj").classList.toggle("on", v); });
    $("[data-all]", box).onclick = () => marcar(true);
    $("[data-none]", box).onclick = () => marcar(false);
    const ids = await modal({
      title: tipo === "word" ? "Baixar Word" : "Gerar PDF / Imprimir",
      body: box,
      okText: tipo === "word" ? "Baixar Word" : "Gerar PDF",
      onOk: (b) => {
        if ($("input[name=modo]:checked", b).value === "todos") return "todos";
        const l = $$(".obj input:checked", b).map((c) => c.value);
        if (!l.length) { toast("Marque ao menos um aluno.", true); return false; }
        return l;
      },
    });
    if (ids) await exportar(parecerId, tipo, ids === "todos" ? null : ids);
  } catch (e) { toast(e.message, true); }
}

async function exportar(parecerId, tipo, paIds) {
  try {
    const { geral, alunos, arq } = await montarDados(parecerId, paIds);
    if (!alunos.length) return toast("Este parecer não tem alunos.", true);
    if (tipo === "word") {
      const blob = gerarDocx(geral, alunos);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = arq + ".docx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("Arquivo Word gerado. Veja na pasta Downloads.");
    } else {
      imprimirPDF(geral, alunos, arq);
    }
  } catch (e) { console.error(e); toast(e.message, true); }
}

function imprimirPDF(g, alunos, arq) {
  const logo = window.MODELO_PARECER.arquivos["word/media/image1.png"];
  const sig = (nome, cargo, port) => `${nome !== null ? `<div class="ln"></div><div>${esc(cargo)}</div><div>${esc(nome)}</div>` : ""}${port !== undefined ? `<div>Portaria : ${esc(port)}</div>` : ""}`;
  const profs = [0, 1, 2].map((i) => g.profs[i] ? `<div class="ln"></div><div style="font-size:10pt">Professor</div><div style="font-size:10pt">${esc(g.profs[i])}</div>` : "").join("");
  const html = alunos.map((a) => `
    <div class="pp">
      <div class="logo"><img src="data:image/png;base64,${logo}"></div>
      <table>
        <tr><td colspan="2" class="tit">PARECER DESCRITIVO PARCIAL EDUCAÇÃO INFANTIL</td></tr>
        <tr><td colspan="2">Estabelecimento: ${esc(g.escola)}</td></tr>
        <tr><td style="width:62%">Aluno (a): ${esc(a.nome)}</td><td>Turma: ${esc(g.turma)}</td></tr>
        <tr><td colspan="2"><b>SISTEMA DE AVALIAÇÃO PROGRESSÃO CONTINUADA:</b> ${esc(g.sistema)}</td></tr>
        <tr><td colspan="2">
          <div class="tit" style="margin:6px 0">PARECER DESCRITIVO PARCIAL ${esc(g.periodo)}</div>
          <div class="c" style="margin-bottom:10px">Parecer Descritivo emitido pelos professores, de acordo com os saberes e conhecimentos e campos de experiências do ${esc(g.turma)}</div>
          ${a.campos.map((c) => `<div class="campo">${esc(c.nome)}:</div><div class="txt">${esc(c.texto) || "&nbsp;"}</div>`).join('<div class="linha">&nbsp;</div>')}
          <div style="margin:0 0 4px"><div class="linha">&nbsp;</div><b>Observação:</b> ${esc(a.observacao).replace(/\n/g, "<br>")}</div>
        </td></tr>
        <tr><td><b>Local:</b> ${esc(g.cidade)}</td><td><b>Data:</b> ${esc(g.data)}</td></tr>
        <tr><td rowspan="2" class="sig profs">${profs}</td><td class="sig">${sig(g.coord, "Coordenadora Pedagógica", g.coord_port)}</td></tr>
        <tr><td class="sig">${sig(g.orient, "Orientadora Educacional", g.orient_port)}</td></tr>
        <tr><td class="sig">${sig(g.sec, "Secretária", g.sec_port)}</td><td class="sig">${sig(g.dir, "Diretora", g.dir_port)}</td></tr>
      </table>
      <div class="ciencia">Ciência do(a) Responsável pelo(a) aluno(a): ____________________________________________</div>
    </div>`).join("");
  $("#print-root").innerHTML = html;
  const titulo = document.title;
  document.title = arq; // nome sugerido do PDF
  const fim = () => { document.title = titulo; window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim);
  toast('Na janela de impressão, escolha "Salvar como PDF".');
  setTimeout(() => window.print(), 300);
}

function imprimirChamada(g, alunos) {
  const DIAS = 22;
  const cel = '<td class="d"></td>'.repeat(DIAS);
  // altura da linha: diminui um pouco com muitos alunos para caber numa folha (mínimo 5 mm)
  const rh = Math.max(5, Math.min(6.4, 124 / alunos.length)).toFixed(2);
  $("#print-root").innerHTML = `
    <div class="ch" style="--rh:${rh}mm">
      <div class="ch-top">${g.escola ? `<div class="ch-esc">${esc(g.escola)}</div>` : ""}<div class="ch-tit">LISTA DE CHAMADA</div></div>
      <div class="ch-info">
        <div><b>Turma:</b> ${esc(g.turma)}</div>
        ${g.faixa ? `<div><b>Faixa etária:</b> ${esc(g.faixa)}</div>` : ""}
        <div><b>Professor(a):</b> ${esc(g.profs) || "—"}</div>
        ${g.orientadora ? `<div><b>Orientadora Educacional:</b> ${esc(g.orientadora)}</div>` : ""}
        <div><b>Mês/Ano:</b> ${esc(g.mes)} / ${esc(g.ano)}</div>
      </div>
      <table>
        <thead>
          <tr><th class="n" rowspan="2">Nº</th><th class="nm" rowspan="2">Nome do aluno</th><th colspan="${DIAS}">Dias letivos (anote o dia no quadro)</th></tr>
          <tr class="dia">${'<th class="d"></th>'.repeat(DIAS)}</tr>
        </thead>
        <tbody>${alunos.map((a) => `<tr><td class="n">${esc(a.numero ?? "")}</td><td class="nm">${esc(a.nome)}</td>${cel}</tr>`).join("")}</tbody>
      </table>
      <div class="ch-leg">Legenda sugerida: <b>•</b> ou <b>P</b> = presente &nbsp; <b>F</b> = falta &nbsp; <b>FJ</b> = falta justificada</div>
      <div class="ch-foot">
        <div><div class="ln"></div>Professor(a)</div>
        <div><div class="ln"></div>Coordenação</div>
        <div><div class="ln"></div>Orientadora Educacional${g.orientadora ? `<br>${esc(g.orientadora)}` : ""}</div>
      </div>
    </div>`;
  const titulo = document.title;
  document.title = `Chamada - ${g.turma} - ${g.mes} ${g.ano}`; // nome sugerido do PDF
  const fim = () => { document.title = titulo; window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim);
  toast('Na janela de impressão, escolha "Salvar como PDF".');
  setTimeout(() => window.print(), 300);
}

// Versão instalada (o "Iniciar Sistema" copia VERSAO.txt para pb_public/versao.txt)
async function mostrarVersao() {
  try {
    const r = await fetch("versao.txt?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const v = (await r.text()).trim();
    if (/^[0-9A-Za-z.\-]{1,20}$/.test(v)) $("#versao").textContent = "Versão " + v;
  } catch (e) {}
}

// ================= início =================
atualizarMarca();
mostrarVersao();
router();
