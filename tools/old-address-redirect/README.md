# Old address redirect

These files go in a new, public GitHub repo named `Godaigo.Elements`, after
the real game repo is renamed and made private. They keep the old address
(https://jakeseegers.github.io/Godaigo.Elements/) working: every visit is sent
to the same page on https://playgodaigo.com, with the query and #hash kept.

- `index.html`: the redirect page.
- `404.html`: the same page. GitHub Pages shows it for any path that does not
  exist, so old deep links (for example `/Godaigo.Elements/index.html?x=1`)
  redirect too.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

Setup:
1. Rename the real repo and make it private.
2. Create a new public repo named exactly `Godaigo.Elements`.
3. Upload these three files to it (Add file > Upload files; `.nojekyll` is
   hidden on some computers, and it is fine to skip it).
4. Settings > Pages > Source: Deploy from a branch, branch `main`, folder `/ (root)`.
5. After a minute, open the old address and check that it lands on playgodaigo.com.
