# User guide

Image Assessment Lab is a **simulation**, not a medical device. Use only simulated images; do not upload real patient images or other sensitive information. The mock result and score must not be used for diagnosis or treatment.

## Get started

You need Node.js 22 or later, npm, and Docker with the Compose plugin. Start Docker before running the commands below. These instructions use PowerShell from the project root.

1. Copy the example configuration:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` and replace the database, root, admin, and user passwords. Account passwords must contain 12–128 characters. Use different email addresses for the admin and user accounts. Leave `DEMO_MODE=true` if you want to try the failure demonstration.
3. Install dependencies and start the database:

   ```powershell
   npm install
   docker compose --env-file .env -f infrastructure\docker\compose.yml up -d --wait
   ```

4. Open three separate PowerShell terminals in the project root. Run one command in each and leave all three running:

   ```powershell
   npm run dev:api
   ```

   ```powershell
   npm run dev:worker
   ```

   ```powershell
   npm run dev:web
   ```

5. Visit `http://127.0.0.1:5173` and sign in using the admin or user email and password from `.env`.

The API creates the configured accounts on its first startup if their email addresses do not already exist. Editing `.env` later does **not** change an existing account's password or role.

## Accounts and signing out

| Role | Access |
| --- | --- |
| User | Upload images and view their own jobs and results. |
| Admin | Upload images and view jobs and results from all users, including the owner column. |

Select **Log out** in the sidebar to return to the login page. The application attempts to revoke the current session; if it cannot, it displays a warning and the server session expires automatically. Sessions are held in browser memory, so refreshing the page also requires you to sign in again. There is no registration or password-reset screen.

## Upload an image

1. Under **Start an assessment**, select an image file. PNG and JPEG files are accepted, up to 5 MB.
2. Select **Create assessment**. Each upload creates a separate job, even if you upload the same image more than once.
3. Watch **Recent assessments** for its status and result. The dashboard refreshes automatically every three seconds; you can also select **Refresh**.

The upload checks the file size and PNG/JPEG signature, but does not fully decode or scan the image.

## Understand the dashboard

The summary cards count the jobs currently displayed, not necessarily every job in the database. The table shows up to the 200 most recent jobs available to your role.

| Status | Meaning |
| --- | --- |
| Queued | Waiting for a worker or for a scheduled retry. |
| Processing | A worker has claimed the job. |
| Completed | The mock assessment is available in the result and model columns. |
| Failed | All permitted attempts were exhausted. The table shows the last error. |

**Attempts** shows the number started and the maximum allowed. A completed result includes a simulated outcome, a score, and the mock model version used. These values have no clinical meaning. Changing `MODEL_VERSION` in `.env` and restarting the worker affects future processing; existing results retain their recorded version.

## Demonstrate a retry

1. Ensure `DEMO_MODE=true` in `.env` and restart the API if you changed it.
2. Choose a simulated image and check **Simulate a transient failure on the first attempt**.
3. Select **Create assessment**. The first attempt fails intentionally; the job returns to the queue and is retried after a short delay.
4. Watch the job complete with **2 / 3** attempts and one result. The worker terminal also shows the retry and completion events.

If a worker exits while it has claimed a job, a running worker can reclaim it after its lease expires. Jobs that exhaust their attempts appear as **Failed**. There is currently no dashboard action to retry a permanently failed job; a new upload creates a new job.

## Troubleshooting

- **Cannot sign in:** Check the configured email and password and that the API and database are running. After too many attempts, wait a minute before trying again. Remember that changing bootstrap credentials does not update an existing account.
- **Job stays queued:** Check that the worker terminal is running and connected to the same database. Look for errors in the worker terminal.
- **Upload rejected:** Use a PNG or JPEG under 5 MB. Failure simulation is available only when `DEMO_MODE=true` on the API.
- **Job failed:** Check the error shown in the table and the worker terminal. The worker retries automatically up to the maximum; it does not offer a manual retry for failed jobs.
- **Dashboard cannot load jobs:** Check the API terminal and database. If your session has expired, sign in again.

## Stop the application

Press `Ctrl+C` in each of the API, worker, and web terminals. To stop the database containers without deleting the database volume:

```powershell
docker compose --env-file .env -f infrastructure\docker\compose.yml down
```

Database data remains in the Docker volume, and uploaded files remain in the local `uploads` directory. There is no automatic retention or deletion policy.
