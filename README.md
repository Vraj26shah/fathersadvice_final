# Father's Advice - MERN Stack Application

A full-stack web application built with MongoDB, Express, React, and Node.js.

## Project Structure

```
fathersadvice/
├── server/              # Express.js backend
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   ├── models/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── config/
│   ├── package.json
│   └── .env.example
├── client/              # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
├── public/              # Static assets
├── docs/                # Documentation
├── .claude/             # Claude Code configuration
├── package.json         # Root scripts
└── README.md
```

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- MongoDB (local or cloud)

### Installation

1. Clone the repository
2. Install dependencies for all parts:
```bash
npm run install-all
```

Or install individually:
```bash
npm install
cd server && npm install
cd ../client && npm install
```

### Environment Setup

1. Create `.env` file in the `server/` directory:
```bash
cp server/.env.example server/.env
```

2. Update `server/.env` with your configuration (MongoDB URI, PORT, etc.)

### Development

Run both server and client concurrently:
```bash
npm run dev
```

Or run them separately:
```bash
npm run server   # Terminal 1 - runs on port 5000
npm run client   # Terminal 2 - runs on port 5173
```

### Build for Production

```bash
npm run build
```

## Available Scripts

### Root
- `npm run install-all` - Install dependencies for all parts
- `npm run dev` - Run server and client concurrently
- `npm run server` - Run server only
- `npm run client` - Run client only
- `npm run build` - Build client for production

### Server
- `npm start` - Run server in production
- `npm run dev` - Run server with nodemon (auto-restart on changes)

### Client
- `npm run dev` - Run Vite dev server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## API Endpoints

- `GET /api/health` - Health check endpoint

## Technologies Used

**Backend:**
- Node.js
- Express.js
- MongoDB
- Mongoose

**Frontend:**
- React
- Vite
- React Router DOM
- Axios

## License

ISC
