# Local publish workflow

This repository uses two working branches:

- `db`: local work and test branch. All requested changes start here.
- `main`: stable GitHub publish branch. Only merge after local checks pass.

Vercel automatic Git deployments are disabled in `vercel.json` with `git.deploymentEnabled: false`.
Pushing to GitHub will not automatically publish to Vercel.

Before publishing to `main`, run syntax checks for changed JavaScript files, for example:

```powershell
node --check src/app.js
node --check api/receipts/index.js
node --check api/receipts/ocr.js
```

Recommended flow:

```powershell
git switch db
# make changes
node --check src/app.js
node --check api/receipts/index.js
node --check api/receipts/ocr.js
git add .
git commit -m "Describe the verified change"
git switch main
git merge --ff-only db
git push origin main
git switch db
```

Production Vercel deployment should be run manually only after `main` is verified.
