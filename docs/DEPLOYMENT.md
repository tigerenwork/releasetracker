# Deployment Guide

This document describes how to deploy the Release Tracker application using two different approaches:

1. **Docker Compose** (Self-Hosted) - Uses SQLite database
2. **Vercel** (Cloud) - Uses Turso (serverless SQLite)

## Quick Comparison

| Feature | Docker Compose | Vercel |
|---------|---------------|--------|
| **Database** | SQLite (local file) | Turso (serverless SQLite) |
| **Hosting** | Your own server | Vercel cloud |
| **Cost** | Free (server cost only) | Free tier available |
| **Setup complexity** | Medium | Low |
| **Data control** | Full | Database hosted by Turso |
| **Best for** | Single-user, internal tools | Multi-user, public access |

---

## Option 1: Docker Compose (Self-Hosted)

### Prerequisites

- Linux server (or macOS/Windows with Docker Desktop)
- Docker and Docker Compose installed
- (Optional) Intel Mac users: Docker Desktop supports linux/amd64 builds

### Deployment Steps

#### 1. Build and Run on Linux Server (Recommended)

```bash
# Clone or copy the project to your Linux server
git clone <your-repo> release-tracker
cd release-tracker

# Build the Docker image
sudo docker compose build

# Run the container
sudo docker compose up -d
```

#### 2. Build on Mac, Deploy to Linux

If you're on an Intel Mac and want to build locally then deploy to Linux:

```bash
# Build for linux/amd64 platform
docker build --platform linux/amd64 -t release-tracker:latest .

# Save the image
docker save release-tracker:latest | gzip > release-tracker.tar.gz

# Copy to Linux server
scp release-tracker.tar.gz user@linux-server:/tmp/

# On Linux server, load and run
ssh user@linux-server "cd /tmp && docker load < release-tracker.tar.gz"

# Create docker-compose.yml on Linux server and run
ssh user@linux-server "cd /opt/release-tracker && docker compose up -d"
```

#### 3. Data Persistence

The SQLite database is stored in `./data/app.db` and mounted as a volume. To backup:

```bash
# Backup
cp data/app.db backups/app.db.$(date +%Y%m%d)

# Restore
cp backups/app.db.20240101 data/app.db
sudo docker compose restart
```

### Environment Variables

Create a `.env` file in the project root:

```bash
# Database (SQLite is the only option for Docker)
DB_TYPE=sqlite
DATABASE_URL=file:./data/app.db

# Next.js
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
```

### Updating the Application

```bash
# Pull latest code
git pull

# Rebuild and restart
sudo docker compose down
sudo docker compose build --no-cache
sudo docker compose up -d
```

---

## Option 2: Vercel (Cloud)

### Prerequisites

- Vercel account (sign up at [vercel.com](https://vercel.com))
- Git repository (GitHub, GitLab, or Bitbucket)
- Turso account (sign up at [turso.tech](https://turso.tech))

### Step 1: Set Up Turso Database

1. Install Turso CLI:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```

2. Login to Turso:
   ```bash
   turso auth login
   ```

3. Create a database:
   ```bash
   turso db create release-tracker
   ```

4. Get the database URL:
   ```bash
   turso db show release-tracker
   ```
   Copy the "LibSQL URL" (looks like: `libsql://release-tracker-username.turso.io`)

5. Create an authentication token:
   ```bash
   turso db tokens create release-tracker
   ```
   Save this token securely.

### Step 2: Deploy to Vercel

1. **Connect Repository**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your Git repository

2. **Configure Build Settings**:
   - Framework Preset: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`

3. **Set Environment Variables**:
   In the Vercel dashboard, go to Project Settings → Environment Variables, add:

   | Variable | Value |
   |----------|-------|
   | `DB_TYPE` | `turso` |
   | `TURSO_URL` | Your Turso database URL |
   | `TURSO_TOKEN` | Your Turso auth token |

   > **Note**: The build process will automatically run database migrations using the `prebuild` script. Make sure the environment variables are set before the first build.

4. **Deploy**:
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - The build process will:
     1. Run `prebuild` script to create database tables
     2. Build the Next.js application
     3. Deploy to Vercel's edge network

### Updating on Vercel

Simply push to your Git repository:

```bash
git push origin main
```

Vercel will automatically rebuild and redeploy.

---

## Local Development

### Using SQLite (Default)

```bash
# Copy example env file
cp .env.local.example .env.local

# Install dependencies
npm install

# Run development server
npm run dev
```

### Using Turso (Optional, for testing)

```bash
# Copy example env file and edit
cp .env.local.example .env.local

# Edit .env.local:
DB_TYPE=turso
TURSO_URL=libsql://your-database-url
TURSO_TOKEN=your-token

# Run development server
npm run dev
```

---

## Troubleshooting

### Docker Issues

**Issue**: Container fails to start with permission errors  
**Solution**: The container runs as root (uid=0, gid=0) by default. If you have permission issues:

```bash
# Fix data directory permissions
sudo chown -R 0:0 ./data
sudo chmod -R 755 ./data
```

**Issue**: Database file is locked  
**Solution**: Stop the container, remove the lock files, and restart:

```bash
sudo docker compose down
rm -f data/*.db-wal data/*.db-shm
sudo docker compose up -d
```

### Vercel Issues

**Issue**: Build fails with "no such table" error  
**Solution**: This happens when the database tables don't exist during build. The `prebuild` script should create them automatically. If it fails:
   - Ensure `TURSO_URL` and `TURSO_TOKEN` are set in Vercel Environment Variables
   - Check that the Turso database exists and is accessible
   - Try running `npx drizzle-kit push` locally with the same credentials to verify

**Issue**: Build fails with database errors  
**Solution**: Ensure environment variables are set in Vercel dashboard (not just in `.env.local`)

**Issue**: Data doesn't persist between deployments  
**Solution**: This is expected with SQLite on Vercel. You must use Turso for persistence.

### Turso Issues

**Issue**: Connection refused or timeout  
**Solution**: Check your `TURSO_URL` and `TURSO_TOKEN` are correct. Turso databases may sleep after inactivity on free tier.

---

## Architecture Notes

### Database Abstraction

The application uses a database factory pattern (`src/lib/db/index.ts`) that automatically selects the appropriate database driver based on the `DB_TYPE` environment variable:

- `DB_TYPE=sqlite`: Uses `better-sqlite3` driver with local file
- `DB_TYPE=turso`: Uses `@libsql/client` driver with Turso

Both use the same Drizzle ORM schema, so no code changes are needed when switching between them.

### Data Migration Between Environments

To migrate data from local SQLite to Turso:

1. Export from SQLite:
   ```bash
   sqlite3 data/app.db .dump > backup.sql
   ```

2. Import to Turso:
   ```bash
   turso db shell release-tracker < backup.sql
   ```

Note: Some SQLite-specific syntax may need adjustment for Turso compatibility.

---

## Security Considerations

### Docker Deployment

- Container runs as root (uid=0) by design for simplicity
- SQLite database file is owned by root
- Ensure proper firewall rules on your server
- Consider using HTTPS reverse proxy (nginx/traefik)

### Vercel Deployment

- Turso provides encryption at rest and in transit
- Vercel provides HTTPS by default
- Keep `TURSO_TOKEN` secure and rotate periodically

---

## Backup Strategy

### Docker/SQLite

```bash
# Automated daily backup via cron
0 2 * * * cp /opt/release-tracker/data/app.db /backups/app.db.$(date +\%Y\%m\%d)
```

### Vercel/Turso

Turso provides automatic backups. You can also export manually:

```bash
turso db dump release-tracker > backup.sql
```

---

## Support

For issues specific to:
- **Docker**: Check Docker logs with `docker compose logs`
- **Vercel**: Check Vercel dashboard deployment logs
- **Turso**: Check Turso dashboard or run `turso db inspect release-tracker`
