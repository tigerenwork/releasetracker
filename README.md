# Release Orchestration & Tracking System

A web application to manage, track, and execute multi-customer deployment workflows across multiple Kubernetes clusters.

## Features

- **Multi-Cluster Support**: Manage multiple K8s clusters, each hosting one or more customers
- **Customer Management**: Organize customers by cluster with namespace isolation
- **Release Management**: Create and track releases of different types (onboarding, regular release, hotfix)
- **Step Templates**: Define common deployment and verification steps
- **Customer-Specific Customization**: Override or add custom steps per customer
- **Matrix View**: Visual progress tracking across all customers and clusters
- **Execution Tracking**: Mark steps as done, skipped, or reverted with notes

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: SQLite (local) or Turso (cloud)
- **ORM**: Drizzle ORM (supports both SQLite and LibSQL)
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Database

The application uses SQLite with a local database file stored in `data/app.db`. The database schema is automatically initialized on first run.

## Deployment

### Option 1: Docker Compose (Self-Hosted)

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f
```

Data is persisted in `./data/app.db` via Docker volume.

### Option 2: Vercel + Turso (Cloud)

1. Sign up at [Vercel](https://vercel.com) and [Turso](https://turso.tech)
2. Connect your Git repository to Vercel
3. Set environment variables in Vercel dashboard:
   - `DB_TYPE=turso`
   - `TURSO_URL=libsql://your-db.turso.io`
   - `TURSO_TOKEN=your-token`
4. Deploy automatically on git push

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed instructions.

## Usage

### 1. Setup Your Infrastructure

1. **Create Clusters**: Go to Clusters page and add your Kubernetes clusters
2. **Add Customers**: For each cluster, add customers with their namespaces

### 2. Create a Release

1. Go to Releases page and click "Create Release"
2. Choose release type:
   - **Onboarding**: For new customer setup
   - **Regular Release**: Standard deployment with version number
   - **Hotfix**: Emergency fixes
3. Define deployment and verification steps
4. Activate the release to generate customer steps

### 3. Track Progress

1. View the matrix visualization to see all customers' progress
2. Click on individual steps to mark them as done or skipped
3. Override step content for specific customers if needed

## Project Structure

```
my-app/
├── src/
│   ├── app/              # Next.js pages
│   ├── components/       # React components
│   ├── lib/
│   │   ├── actions/      # Server Actions
│   │   ├── db/           # Database schema and connection
│   │   └── utils/        # Utilities
├── data/                 # SQLite database
└── docs/                 # Documentation (FSD, TSD)
```

## Future Enhancements

- Auto-execution of bash/SQL scripts via K8s agents
- Multi-user support with authentication
- Audit logging
- Jenkins/Rancher API integrations
- Email notifications
- Scheduled releases

## License

MIT
