/*
  Sistema de Pareceres - Educação Infantil
  © 2026 GustavoHBL. Todos os direitos reservados.
  Desenvolvido por GustavoHBL - https://github.com/GustavoHBL/sistema-pareceres
  Uso, cópia, modificação ou distribuição somente com autorização do autor (veja LICENSE.txt).
*/
/// Respostas prontas para o campo Observação
migrate((app) => {
  const c = new Collection({
    type: "base", name: "obs_prontas",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { type: "text", name: "texto", required: true, max: 5000 },
      { type: "number", name: "ordem" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(c);
  const col = app.findCollectionByNameOrId("obs_prontas");
  [
    "A criança adaptou-se bem à rotina escolar.",
    "Demonstra estar em processo de adaptação à rotina escolar.",
    "É participativa nas atividades propostas.",
    "Apresentou frequência regular no período.",
    "Apresentou faltas frequentes no período, o que interferiu no seu desenvolvimento.",
  ].forEach((t, i) => {
    const r = new Record(col);
    r.set("texto", t); r.set("ordem", i + 1);
    app.save(r);
  });
}, (app) => {
  app.delete(app.findCollectionByNameOrId("obs_prontas"));
});
