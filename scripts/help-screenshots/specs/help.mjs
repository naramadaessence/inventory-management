export const shots = [
  { name: 'help-browse-home', login: 'admin', page: 'sales', run: async h => { await h.go('help'); } },
  { name: 'help-search-results', login: 'admin', page: 'help', run: async h => { await h.type('#help-search', 'record sale'); await h.wait(400); } },
  { name: 'help-search-article', login: 'admin', page: 'help', run: async h => {
      await h.page.evaluate(() => document.querySelector('[data-article="sales-record-bill"]')?.click());
      await h.wait(400);
      await h.page.evaluate(() => window.scrollTo(0, 0));
    } },
];
