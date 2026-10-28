# ADR 0008: CI deploys each green commit through a Render deploy hook, then measures it

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

- The Render service was created with the Deploy to Render button. Render does not auto-deploy a service created from a public repository URL, so two merges to `main` never reached the live server.
- Render's own auto-deploy waits for every check on a commit (`autoDeployTrigger: checksPass`). A check that waits for that same commit to be deployed therefore blocks the deploy. This happened when the live probe ran automatically and left a failed check on `main`.
- Changes to netcode only count once they are measured on the real deployment, not just in CI.

## Decision

- A **Deploy** workflow runs after CI succeeds on a push to `main`. It calls the service's deploy hook with `ref=<commit>`, so Render deploys exactly the commit CI tested.
- The hook URL is a repository secret, `RENDER_DEPLOY_HOOK_URL`. Without it the workflow leaves a notice and succeeds, so a fork or a fresh clone stays green.
- The workflow then calls the **Live probe** workflow, which waits until `/healthz` reports the deployed commit and measures it with bots and two real browsers. When called after a deploy, the probe fails if the commit never goes live. When started by hand, it only warns.
- Live probe and Load test never run on their own on a push.
- Deploys are serialized. A newer commit waits for the current deploy and its measurement to finish.

## Consequences

- Every green commit on `main` is deployed and measured with no manual steps once the secret exists. A deploy that fails or never goes live shows as a failed check on that commit.
- The deploy hook path does not depend on Render's auto-deploy or on GitHub checks, so it cannot deadlock on its own result.
- If the service is later connected to GitHub with auto-deploy on, Render may deploy the same commit a second time. That is harmless, but turn auto-deploy off in that case.
- Anyone with the hook URL can trigger deploys (not change code). Regenerate it in Render if it leaks.
