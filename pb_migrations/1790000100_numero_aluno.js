/// Número do aluno na turma (ordem de entrada)
migrate((app) => {
  const col = app.findCollectionByNameOrId("alunos");
  col.fields.add(new NumberField({ name: "numero", onlyInt: true, min: 0 }));
  app.save(col);
  // numera os alunos já cadastrados pela ordem em que foram cadastrados
  const alunos = app.findRecordsByFilter("alunos", "id != ''", "turma,created", 0, 0);
  const cont = {};
  alunos.forEach((a) => {
    const t = a.getString("turma");
    cont[t] = (cont[t] || 0) + 1;
    a.set("numero", cont[t]);
    app.save(a);
  });
}, (app) => {
  const col = app.findCollectionByNameOrId("alunos");
  col.fields.removeByName("numero");
  app.save(col);
});
