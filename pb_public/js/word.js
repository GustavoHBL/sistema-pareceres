/*
  Sistema de Pareceres - Educação Infantil
  © 2026 GustavoHBL. Todos os direitos reservados.
  Desenvolvido por GustavoHBL - https://github.com/GustavoHBL/sistema-pareceres
  Uso, cópia, modificação ou distribuição somente com autorização do autor (veja LICENSE.txt).
*/
// Geração do arquivo Word (.docx) a partir do modelo, sem bibliotecas externas.
(function (global) {
  // ---------- ZIP (sem compressão) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true); // UTF-8
      h.setUint16(8, 0, true); // store
      h.setUint16(10, 0, true);
      h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, size, true);
      h.setUint32(22, size, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, 0, true);
      c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, size, true);
      c.setUint32(24, size, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }
  function b64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // ---------- preenchimento ----------
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  }
  function fill(xml, vals) {
    return xml.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (m, k) => (k in vals ? vals[k] : m));
  }

  /**
   * geral: {escola, cidade, sistema, periodo, turma, data, profs:[..], coord, coord_port, orient, orient_port, sec, sec_port, dir, dir_port}
   * alunos: [{nome, observacao, campos:[{nome, texto}]}]
   */
  function gerarDocx(geral, alunos) {
    const M = global.MODELO_PARECER;
    const base = {};
    for (const k of ["escola", "cidade", "sistema", "periodo", "turma", "data", "coord", "coord_port", "orient", "orient_port", "sec", "sec_port", "dir", "dir_port"])
      base[k] = esc(geral[k]);
    // professores: cada um com espaço para assinar, linha, cargo e nome (espaçamento igual)
    const pp = (t) => fill(M.prof_par, { t });
    const profs = (geral.profs || []).filter(Boolean).slice(0, 3);
    base.PROFS = profs.length
      ? profs.map((p) => pp("") + pp("__________________________") + pp("Professor") + pp(esc(p))).join("") + pp("")
      : pp("");
    let corpo = "";
    alunos.forEach((a, i) => {
      const campos = (a.campos || [])
        .map((c) => fill(M.campo_titulo, { campo_nome: esc(c.nome) }) + fill(M.campo_lista, { campo_texto: esc(c.texto) }))
        .join(fill(M.campo_lista, { campo_texto: "" })); // linha em branco entre os campos
      const vals = Object.assign({}, base, {
        aluno: esc(a.nome),
        observacao: esc(a.observacao),
        QUEBRA: i === 0 ? "" : "<w:pageBreakBefore/>",
        DOCPR: String(1000 + i),
      });
      corpo += fill(M.corpo, vals).replace("{{CAMPOS}}", campos);
    });
    const docXml = M.head + corpo + M.tail;
    const enc = new TextEncoder();
    const files = [{ name: "[Content_Types].xml", data: b64(M.arquivos["[Content_Types].xml"]) }];
    for (const n in M.arquivos) if (n !== "[Content_Types].xml") files.push({ name: n, data: b64(M.arquivos[n]) });
    files.push({ name: "word/document.xml", data: enc.encode(docXml) });
    // propriedades do arquivo (Arquivo > Informações / Propriedades > Detalhes)
    const agora = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Parecer Descritivo</dc:title><dc:creator>Sistema de Pareceres - GustavoHBL</dc:creator><cp:lastModifiedBy>Sistema de Pareceres - GustavoHBL</cp:lastModifiedBy>' +
      '<dc:description>Gerado pelo Sistema de Pareceres, desenvolvido por GustavoHBL.</dc:description><cp:revision>1</cp:revision>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified></cp:coreProperties>`;
    const iCore = files.findIndex((f) => f.name === "docProps/core.xml");
    if (iCore >= 0) files[iCore] = { name: "docProps/core.xml", data: enc.encode(core) };
    return zip(files);
  }

  global.gerarDocx = gerarDocx;
})(typeof window !== "undefined" ? window : globalThis);
