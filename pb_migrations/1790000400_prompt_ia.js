/// Texto (modelo) do prompt para gerar a observação com IA
migrate((app) => {
  const col = app.findCollectionByNameOrId("config");
  col.fields.add(new TextField({ name: "prompt_ia", max: 20000 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("config");
  col.fields.removeByName("prompt_ia");
  app.save(col);
});
