# AYSO Game Day

A comprehensive team management application for AYSO (American Youth Soccer Organization) coaches. Plan games, manage rosters, create fair rotations, and ensure AYSO compliance with ease.

## What It Does

AYSO Game Day helps soccer coaches streamline their team management with:

- **Team Management**: Create and manage multiple teams with different formats (7v7, 9v9, 11v11)
- **Player Roster Management**: Track players with profiles, photos, preferred positions, and notes
- **Game Planning**: Schedule games and organize lineups with formation templates
- **Fair Play Rotation Engine**: Auto-generate balanced rotations that comply with AYSO fair-play rules
- **Formation Templates**: Pre-configured formations based on traditional soccer numbering
- **Sit-out Tracking**: Ensure equal playing time and AYSO compliance
- **Image Uploads**: Player profile pictures with UploadThing integration

## Technology Stack

### Frontend
- **React Router v7** - Full-stack React framework with SSR
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Vite** - Fast build tooling

### Backend
- **Node.js** - Server runtime
- **React Router SSR** - Server-side rendering
- **Cookie-based sessions** - Authentication
- **bcryptjs** - Password hashing

### Database
- **Drizzle ORM** - Type-safe database toolkit
- **Turso/LibSQL** - Production database (with SQLite fallback for development)
- **SQLite** - Local development database

### File Storage
- **UploadThing** - Image upload and CDN hosting

### Key Features
- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎨 Tailwind CSS for styling
- 📊 Database ORM with Drizzle
- 🔐 Secure authentication system
- ☁️ Cloud database with local fallback

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ayso-game-day
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
# Copy example env file
cp .env.example .env

# Add your environment variables:
DATABASE_URL=file:./local.db
SESSION_SECRET=your-secret-key-here
UPLOADTHING_TOKEN=your-uploadthing-token
TURSO_URL=your-turso-url (optional)
TURSO_TOKEN=your-turso-token (optional)
```

4. Set up the database:
```bash
# Push schema to database
npm run db:push

# Seed with formation templates
npm run db:seed
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

### Database Commands

```bash
npm run db:push      # Apply schema changes
npm run db:generate  # Create migration files
npm run db:migrate   # Run migrations
npm run db:seed      # Seed initial data
npm run db:studio    # Open Drizzle Studio
```

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Project Structure

```
ayso-game-day/
├── app/
│   ├── components/          # Reusable UI components
│   ├── db/                 # Database schema and utilities
│   ├── routes/             # Route modules (pages)
│   ├── server/             # Server-side utilities
│   ├── utils/              # Utility functions
│   └── routes.ts           # Route configuration
├── public/                 # Static assets
├── drizzle/               # Database migrations
└── debug/                 # Debug scripts
```

## Key Features Explained

### Fair Play Rotation Engine
- Automatically generates balanced player rotations
- Ensures compliance with AYSO fair-play requirements
- Tracks sit-outs and playing time distribution
- Supports 7v7, 9v9, and 11v11 formats

### Formation System
- Pre-configured formations based on traditional soccer numbering
- Templates for different game formats
- Customizable position assignments
- Visual formation displays

### Team Management
- Multi-team support for coaches handling multiple teams
- Age group and season tracking
- AYSO region integration
- Comprehensive player profiles with photos

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Built for AYSO coaches who want to focus on coaching, not paperwork.
