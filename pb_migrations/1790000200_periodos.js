/// Cadastro de períodos
migrate((app) => {
  const c = new Collection({
    type: "base", name: "periodos",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { type: "text", name: "nome", required: true, max: 200 },
      { type: "number", name: "ordem" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_periodos_nome ON periodos (nome)"],
  });
  app.save(c);
  const col = app.findCollectionByNameOrId("periodos");
  const nomes = ["1º TRIMESTRE", "2º TRIMESTRE", "3º TRIMESTRE"];
  // inclui períodos já usados em pareceres existentes
  app.findRecordsByFilter("pareceres", "periodo != ''", "created", 0, 0).forEach((p) => {
    const n = p.getString("periodo").trim();
    if (n && nomes.indexOf(n) < 0) nomes.push(n);
  });
  nomes.forEach((n, i) => {
    const r = new Record(col);
    r.set("nome", n); r.set("ordem", i + 1);
    app.save(r);
  });
}, (app) => {
  app.delete(app.findCollectionByNameOrId("periodos"));
});
