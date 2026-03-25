# CLAUDE.md — Fathers Advice
> Read this fully before touching any file. This is the single source of truth for how this project works.

---

## One Command to Run Everything

```bash
npm run dev
```

That's it. This single command starts both frontend and backend at the same time.

To set this up, install `concurrently` in the root folder:

```bash
# Run this once from the root (fathers-advice/) folder
npm init -y
npm install concurrently
```

Then your root `package.json` should look like this:

```json
{
  "name": "fathers-advice",
  "scripts": {
    "dev": "concurrently \"npm run server\" \"npm run client\"",
    "server": "cd server && npm run dev",
    "client": "cd client && npm run dev"
  },
  "dependencies": {
    "concurrently": "^8.0.0"
  }
}
```

Frontend runs at: `http://localhost:5173`
Backend runs at:  `http://localhost:5000`

---

## Project Structure — What Lives Where

```
fathers-advice/
├── package.json          ← root only, runs both servers
├── CLAUDE.md             ← you are reading this
├── client/               ← everything the user sees (React)
└── server/               ← everything the user never sees (Node.js)
```

---

## Naming Rules — Read Before Writing Any Code

These rules apply everywhere. No exceptions.

### Functions — always camelCase
```js
// CORRECT
function getTopMatches() {}
function createNewSession() {}
function sendEmailToUser() {}

// WRONG — never do this
function GetTopMatches() {}
function create_new_session() {}
function SEND_EMAIL() {}
```

### Variables — always camelCase
```js
// CORRECT
const mentorList = []
const currentUser = {}
const sessionRoomUrl = ''

// WRONG
const MentorList = []
const current_user = {}
const SESSIONROOMURL = ''
```

### Files — camelCase for all JS/JSX files
```
matchingAlgorithm.js    ✓
authController.js       ✓
MentorDashboard.jsx     ✓   (React components start with Capital)
useSocket.js            ✓

matching_algorithm.js   ✗
AuthController.js       ✗ (only React components are Capitalized)
```

### React Components only — start with Capital letter
```
MentorCard.jsx      ✓
LoginForm.jsx       ✓
ChatPanel.jsx       ✓
```

---

## Backend — server/

### Entry Point
```
server/server.js
```
This is the first file that runs. It connects to MongoDB, sets up Express, and starts Socket.io. If the server won't start, look here first.

### server/models/ — Database Shapes

These files define what gets saved to MongoDB.

---

#### `User.js`
Stores every person on the platform — both mentors and mentees in one collection. The `role` field tells them apart.

```js
// What a mentor looks like in the database
{
  name: "Arjun Rao",
  email: "arjun@gmail.com",
  password: "hashed_string",
  role: "mentor",                     // "mentor" or "mentee" — nothing else
  profileComplete: false,             // false until they finish setup page

  // mentor-only fields (leave empty for mentees)
  skills: ["Node.js", "AWS", "Docker"],
  domain: "Backend Engineering",
  experience: 8,                      // years
  availability: ["Mon 6pm", "Wed 7pm"],
  rate: 500,                          // per session in rupees
  rating: 4.8,                        // average from all past sessions
  totalSessions: 124,

  // mentee-only fields (leave empty for mentors)
  goals: "Get a backend job",
  weakAreas: ["System Design", "AWS"],
  preferredSlots: ["Mon 6pm", "Wed 7pm"],
  doubtsResolved: 12
}
```

---

#### `Session.js`
Every booked session between one mentor and one mentee.

```js
{
  mentor: ObjectId,                   // points to a User with role "mentor"
  mentee: ObjectId,                   // points to a User with role "mentee"
  slot: Date,                         // when the session happens
  status: "pending",                  // pending → confirmed → live → completed
  roomUrl: "https://daily.co/abc123", // video call link
  doubt: "I don't understand microservices",
  notes: "Covered service discovery and load balancing",
  rating: 5,                          // mentee gives this after session
  review: "Very clear explanation"
}
```

---

#### `Match.js`
Stores the result every time the algorithm runs for a mentee. Used for history and improving future matches.

```js
{
  mentor: ObjectId,
  mentee: ObjectId,
  score: 87,          // 0-100, calculated by matchingAlgorithm.js
  domain: "Backend Engineering",
  createdAt: Date
}
```

---

### server/services/ — Business Logic

These are the files that do the actual thinking. Not routes. Not controllers. Pure logic.

---

#### `matchingAlgorithm.js` — MOST IMPORTANT FILE IN THE PROJECT

This is the core of the entire platform. Understand this first.

**What it does:** Takes one mentee and scores every available mentor. Returns the top matches sorted by score.

**Functions inside:**

```js
/**
 * matchScore(mentor, mentee)
 *
 * PURPOSE: Give a number 0-100 showing how well a mentor fits a mentee.
 *
 * HOW IT WORKS:
 * - Checks how many of mentee's weak areas match mentor's skills (+15 each)
 * - Checks if mentor's domain matches mentee's goals (+25)
 * - Checks how many time slots overlap (+8 each)
 * - Adds points for mentor's rating (+4 per star)
 * - Adds points for experience, capped at 20 (+2 per year)
 *
 * EXAMPLE:
 * mentee.weakAreas = ["Node.js", "AWS"]
 * mentor.skills    = ["Node.js", "Docker", "AWS"]
 * overlap = 2 → score += 30
 *
 * INPUT:  mentor object, mentee object (both from MongoDB)
 * OUTPUT: single number between 0 and 100
 */
function matchScore(mentor, mentee) {}


/**
 * getTopMatches(mentee, limit)
 *
 * PURPOSE: Find the best mentors for a given mentee from the whole database.
 *
 * HOW IT WORKS:
 * - Fetches all mentors from MongoDB where profileComplete is true
 * - Runs matchScore() on each one
 * - Removes any mentor with score 0
 * - Sorts from highest to lowest score
 * - Returns only the top `limit` results (default 5)
 *
 * INPUT:  mentee object, optional limit number (default 5)
 * OUTPUT: array of { mentor, score } objects, sorted best first
 *
 * EXAMPLE OUTPUT:
 * [
 *   { mentor: { name: "Arjun" }, score: 98 },
 *   { mentor: { name: "Sneha" }, score: 87 },
 * ]
 */
async function getTopMatches(mentee, limit = 5) {}
```

---

#### `notificationService.js`

**Functions inside:**

```js
/**
 * sendEmailToUser(toEmail, subject, messageBody)
 *
 * PURPOSE: Send a plain email using Gmail SMTP via Nodemailer.
 * Used for: session confirmations, reminders, cancellations.
 *
 * NO security layer right now — raw open send.
 *
 * INPUT:  email string, subject string, message string
 * OUTPUT: nothing (just sends, logs error if it fails)
 */
function sendEmailToUser(toEmail, subject, messageBody) {}


/**
 * sendSessionReminder(session)
 *
 * PURPOSE: Send reminder emails to both mentor and mentee
 *          1 hour before their session starts.
 *
 * HOW IT WORKS:
 * - Takes a session object (with mentor and mentee populated)
 * - Calls sendEmailToUser() twice — once for each person
 *
 * INPUT:  session object with mentor and mentee fields populated
 * OUTPUT: nothing
 */
function sendSessionReminder(session) {}
```

---

### server/controllers/ — Route Handlers

Controllers receive the HTTP request, call the right service or model, and send back a response. Keep them thin — logic goes in services, not here.

---

#### `authController.js`

```js
/**
 * registerNewUser(req, res)
 *
 * PURPOSE: Create a new user account.
 * ROUTE:   POST /api/auth/register
 *
 * EXPECTS in req.body:
 * { name, email, password, role }
 *
 * RETURNS:
 * { _id, name, email, role, profileComplete, token }
 *
 * NOTE: No security layer yet. Password is hashed via bcrypt in User model
 *       pre-save hook automatically.
 */
function registerNewUser(req, res) {}


/**
 * loginUser(req, res)
 *
 * PURPOSE: Log in an existing user and return a JWT token.
 * ROUTE:   POST /api/auth/login
 *
 * EXPECTS in req.body:
 * { email, password }
 *
 * RETURNS:
 * { _id, name, role, profileComplete, token }
 *
 * HOW TOKEN WORKS:
 * Token contains { id, role } — frontend stores this in localStorage
 * and sends it in every request header as: Authorization: Bearer <token>
 */
function loginUser(req, res) {}
```

---

#### `matchController.js`

```js
/**
 * fetchMatchesForMentee(req, res)
 *
 * PURPOSE: Return the top mentor matches for the logged-in mentee.
 * ROUTE:   GET /api/match/my-matches
 *
 * HOW IT WORKS:
 * - Gets the mentee's user object from the database
 * - Passes it to getTopMatches() from matchingAlgorithm.js
 * - Returns sorted match array
 *
 * RETURNS:
 * [ { mentor: {...}, score: 94 }, { mentor: {...}, score: 87 } ]
 *
 * CONTEXT: This is called when mentee dashboard loads.
 *          The MatchList component renders what this returns.
 */
function fetchMatchesForMentee(req, res) {}
```

---

#### `sessionController.js`

```js
/**
 * bookNewSession(req, res)
 *
 * PURPOSE: Mentee books a session with a chosen mentor.
 * ROUTE:   POST /api/session/book
 *
 * EXPECTS in req.body:
 * { mentorId, slot, doubt }
 *
 * WHAT HAPPENS:
 * 1. Creates a Session document in MongoDB
 * 2. Generates a Daily.co room URL
 * 3. Sends confirmation email to both mentor and mentee
 * 4. Returns the created session
 *
 * RETURNS: full session object
 */
function bookNewSession(req, res) {}


/**
 * getMentorSessions(req, res)
 *
 * PURPOSE: Get all sessions for a mentor (their dashboard list).
 * ROUTE:   GET /api/session/mentor-sessions
 *
 * RETURNS: array of sessions with mentee details populated
 */
function getMentorSessions(req, res) {}


/**
 * getMenteeSessions(req, res)
 *
 * PURPOSE: Get all sessions for a mentee (their doubt history).
 * ROUTE:   GET /api/session/mentee-sessions
 *
 * RETURNS: array of sessions with mentor details populated
 */
function getMenteeSessions(req, res) {}


/**
 * updateSessionStatus(req, res)
 *
 * PURPOSE: Change session status — mentor confirms, marks live, completes.
 * ROUTE:   PUT /api/session/:sessionId/status
 *
 * EXPECTS in req.body:
 * { status }  →  "confirmed" | "live" | "completed" | "cancelled"
 *
 * RETURNS: updated session object
 */
function updateSessionStatus(req, res) {}


/**
 * submitSessionFeedback(req, res)
 *
 * PURPOSE: Mentee submits rating and review after session ends.
 * ROUTE:   PUT /api/session/:sessionId/feedback
 *
 * EXPECTS in req.body:
 * { rating, review }
 *
 * WHAT HAPPENS:
 * 1. Saves rating and review to session
 * 2. Recalculates mentor's average rating in User model
 * 3. This updated rating affects future match scores automatically
 *
 * RETURNS: updated session
 */
function submitSessionFeedback(req, res) {}
```

---

#### `userController.js`

```js
/**
 * saveUserProfile(req, res)
 *
 * PURPOSE: Save mentor or mentee profile details after first login.
 * ROUTE:   PUT /api/user/profile
 *
 * EXPECTS in req.body (mentor):
 * { skills, domain, experience, availability, rate }
 *
 * EXPECTS in req.body (mentee):
 * { goals, weakAreas, preferredSlots }
 *
 * WHAT HAPPENS:
 * Updates user document and sets profileComplete = true
 * After this, the frontend redirects to their dashboard
 *
 * RETURNS: updated user object
 */
function saveUserProfile(req, res) {}


/**
 * getUserProfile(req, res)
 *
 * PURPOSE: Fetch any user's public profile by their ID.
 * ROUTE:   GET /api/user/:userId
 *
 * RETURNS: user object (password field excluded)
 */
function getUserProfile(req, res) {}
```

---

### server/middleware/ — Request Interceptors

> ⚠ NO security enforced right now — these are scaffolded but not blocking.
> We will add real protection later when told to.

```js
// authMiddleware.js
/**
 * checkIfLoggedIn(req, res, next)
 *
 * PURPOSE: Read the JWT from the request header and attach user to req.
 * Currently just passes through — security added later.
 *
 * WHEN ADDED TO A ROUTE:
 * router.get('/my-matches', checkIfLoggedIn, fetchMatchesForMentee)
 */
function checkIfLoggedIn(req, res, next) {
  next() // no block right now — raw pass through
}


// roleMiddleware.js
/**
 * allowOnlyMentor(req, res, next)
 * allowOnlyMentee(req, res, next)
 *
 * PURPOSE: Block wrong role from accessing wrong dashboard.
 * Currently just passes through — security added later.
 */
function allowOnlyMentor(req, res, next) {
  next() // no block right now
}
function allowOnlyMentee(req, res, next) {
  next() // no block right now
}
```

---

### server/routes/ — URL Map

Quick reference of every API endpoint:

```
AUTH
POST   /api/auth/register          → registerNewUser
POST   /api/auth/login             → loginUser

USER
GET    /api/user/:userId           → getUserProfile
PUT    /api/user/profile           → saveUserProfile

MATCHING
GET    /api/match/my-matches       → fetchMatchesForMentee

SESSION
POST   /api/session/book           → bookNewSession
GET    /api/session/mentor-sessions → getMentorSessions
GET    /api/session/mentee-sessions → getMenteeSessions
PUT    /api/session/:id/status     → updateSessionStatus
PUT    /api/session/:id/feedback   → submitSessionFeedback
```

---

### server/config/

```js
// db.js
/**
 * connectToDatabase()
 *
 * PURPOSE: Connect to MongoDB Atlas using the URI in .env
 * Called once in server.js on startup.
 * If this fails, the whole server stops.
 */
function connectToDatabase() {}


// socket.js
/**
 * setupSocketEvents(io)
 *
 * PURPOSE: Define all real-time events for live sessions.
 *
 * EVENTS HANDLED:
 * "join-room"      → user joins a session room by roomId
 * "send-message"   → user sends a chat message inside a session
 * "session-started"→ mentor marks session as live, mentee gets notified
 * "disconnect"     → user leaves, others in room are notified
 */
function setupSocketEvents(io) {}
```

---

## Frontend — client/src/

---

### client/src/context/

```jsx
// AuthContext.jsx
/**
 * AuthProvider
 *
 * PURPOSE: Wrap the whole app so every component can access
 *          the current logged-in user without prop drilling.
 *
 * WHAT IT STORES:
 * - user object (from localStorage on refresh)
 * - login() function
 * - logout() function
 * - setUser() to update after profile save
 *
 * HOW TO USE IN ANY COMPONENT:
 * const { user, login, logout } = useAuth()
 */


// SocketContext.jsx
/**
 * SocketProvider
 *
 * PURPOSE: Create one shared Socket.io connection for the whole app.
 *          Live session chat and notifications use this.
 *
 * HOW TO USE IN ANY COMPONENT:
 * const socket = useSocket()
 * socket.emit('send-message', { roomId, message })
 */
```

---

### client/src/hooks/

```js
// useAuth.js
/**
 * useAuth()
 *
 * PURPOSE: Shortcut to access AuthContext from any component.
 *
 * RETURNS: { user, login, logout, setUser }
 *
 * USAGE:
 * const { user } = useAuth()
 * if (user.role === 'mentor') show mentor dashboard
 */


// useSocket.js
/**
 * useSocket()
 *
 * PURPOSE: Shortcut to access the shared Socket.io instance.
 *
 * RETURNS: socket object
 *
 * USAGE:
 * const socket = useSocket()
 * socket.on('receive-message', (msg) => setMessages([...messages, msg]))
 */


// useMatch.js
/**
 * useMatch()
 *
 * PURPOSE: Fetch and store the top mentor matches for the logged-in mentee.
 *          Calls GET /api/match/my-matches automatically on mount.
 *
 * RETURNS: { matches, loadingMatches, matchError }
 *
 * USAGE:
 * const { matches, loadingMatches } = useMatch()
 * show a loading spinner while loadingMatches is true
 * then map over matches to render MentorCard components
 */
```

---

### client/src/services/

These are the only files that talk to the backend. No component should call axios directly — always go through these.

```js
// api.js
/**
 * PURPOSE: One shared axios instance with the backend URL pre-set.
 * Every other service file imports from here.
 *
 * Base URL comes from .env: VITE_API_URL=http://localhost:5000/api
 */


// authService.js
/**
 * registerUser(name, email, password, role)
 * PURPOSE: Call POST /api/auth/register
 * RETURNS: user object with token
 *
 * loginUser(email, password)
 * PURPOSE: Call POST /api/auth/login
 * RETURNS: user object with token
 */


// matchService.js
/**
 * fetchMyMatches()
 * PURPOSE: Call GET /api/match/my-matches
 * RETURNS: array of { mentor, score } sorted best first
 */


// sessionService.js
/**
 * bookSession(mentorId, slot, doubt)
 * PURPOSE: Call POST /api/session/book
 * RETURNS: created session object with roomUrl
 *
 * fetchMentorSessions()
 * PURPOSE: Call GET /api/session/mentor-sessions
 * RETURNS: array of sessions for mentor dashboard
 *
 * fetchMenteeSessions()
 * PURPOSE: Call GET /api/session/mentee-sessions
 * RETURNS: array of sessions for mentee doubt history
 *
 * changeSessionStatus(sessionId, status)
 * PURPOSE: Call PUT /api/session/:id/status
 * RETURNS: updated session
 *
 * submitFeedback(sessionId, rating, review)
 * PURPOSE: Call PUT /api/session/:id/feedback
 * RETURNS: updated session
 */
```

---

### client/src/components/ — UI Building Blocks

---

#### common/

```jsx
// Navbar.jsx
// Shows: F|A logo, nav links, Login/Get Started buttons
// When logged in: shows user name + logout button instead

// Button.jsx
// Reusable button — accepts: label, onClick, variant ("primary"/"ghost"), loading state
// USAGE: <Button label="Find my mentor" onClick={handleClick} variant="primary" />

// Modal.jsx
// Reusable popup — accepts: isOpen, onClose, children
// USAGE: <Modal isOpen={showBooking} onClose={() => setShowBooking(false)}>...</Modal>

// Loader.jsx
// Simple centered spinner — show while any API call is loading
// USAGE: {loadingMatches && <Loader />}
```

---

#### auth/

```jsx
// LoginForm.jsx
// Fields: email, password
// On submit: calls loginUser() from authService → saves to AuthContext → redirects by role

// RegisterForm.jsx
// Fields: name, email, password, role (mentor/mentee toggle)
// On submit: calls registerUser() → saves to AuthContext → redirects to /setup

// RolePicker.jsx
// PURPOSE: The toggle between "I am a mentor" and "I am a mentee"
// Used inside RegisterForm — just a styled two-option selector
// Sets role in the form state when clicked
```

---

#### mentee/

```jsx
// MenteeDashboard.jsx
// Main layout for mentee — contains MatchList, DoubtHistory, ProgressTracker
// Calls useMatch() on load to get matches
// Shows profile completion banner if profileComplete is false

// MatchList.jsx
// PURPOSE: Show top matched mentors for the mentee
// RECEIVES: matches array from useMatch()
// RENDERS: one MentorCard per match
// Each card has a "Book Session" button that opens BookingModal

// MentorCard.jsx
// PURPOSE: Show one mentor's info — name, domain, skills, score, availability
// RECEIVES: mentor object + score number as props
// Has "Book Session" button

// BookingModal.jsx
// PURPOSE: Popup where mentee picks a time slot and describes their doubt
// RECEIVES: mentorId as prop
// On submit: calls bookSession() from sessionService
// On success: closes modal, shows confirmation

// DoubtHistory.jsx
// PURPOSE: List of all past sessions for the mentee
// Calls fetchMenteeSessions() on load
// Shows: mentor name, doubt, date, status, rating given

// ProgressTracker.jsx
// PURPOSE: Show mentee's growth numbers
// Shows: total doubts resolved, sessions completed, top domains studied
// All numbers come from the user object in AuthContext
```

---

#### mentor/

```jsx
// MentorDashboard.jsx
// Main layout for mentor — contains SessionRequests, AvailabilityCalendar, EarningsPanel

// SessionRequests.jsx
// PURPOSE: List of pending and confirmed sessions for the mentor
// Calls fetchMentorSessions() on load
// Each row has: mentee name, doubt preview, slot time, Confirm / Start Session buttons
// "Start Session" button calls changeSessionStatus(id, "live") then navigates to /session/:id

// AvailabilityCalendar.jsx
// PURPOSE: Let mentor set which time slots they are available
// On save: calls saveUserProfile() with updated availability array
// Simple grid of day + time checkboxes — no external calendar library needed

// EarningsPanel.jsx
// PURPOSE: Show mentor's total sessions and estimated earnings
// Calculates: totalSessions × rate from user object in AuthContext
// No payment integration yet — display only
```

---

#### session/

```jsx
// LiveSession.jsx
// PURPOSE: The full page for an active session
// Layout: VideoFrame on left, ChatPanel on right
// Fetches session by :id from URL params
// Contains the end session button → calls changeSessionStatus(id, "completed")
// After end: redirects mentee to feedback form

// VideoFrame.jsx
// PURPOSE: Embed the Daily.co video call iframe
// RECEIVES: roomUrl from session object
// Just renders: <iframe src={roomUrl} />
// No custom video logic — Daily.co handles everything

// ChatPanel.jsx
// PURPOSE: Real-time chat during a live session
// Uses useSocket() to send and receive messages
// On mount: socket.emit("join-room", sessionId)
// On send: socket.emit("send-message", { roomId: sessionId, message })
// On receive: socket.on("receive-message", addToMessageList)

// Whiteboard.jsx
// PURPOSE: Shared drawing space during session
// Embeds Excalidraw as an iframe — free and zero setup
// RENDER: <iframe src="https://excalidraw.com" />
```

---

## Environment Variables — Full List

```bash
# server/.env
PORT=5000
MONGO_URI=mongodb+srv://YOUR_USER:YOUR_PASS@cluster.mongodb.net/fathersadvice
JWT_SECRET=any_long_random_string_here
CLIENT_URL=http://localhost:5173
EMAIL_USER=yourgmail@gmail.com
EMAIL_PASS=your_gmail_app_password

# client/.env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

---

## First Time Setup — Complete Steps

```bash
# 1. Clone or create the project
mkdir fathers-advice && cd fathers-advice

# 2. Install root runner
npm init -y
npm install concurrently

# 3. Set up backend
cd server
npm init -y
npm install express mongoose jsonwebtoken bcryptjs dotenv cors socket.io nodemailer
npm install -D nodemon

# Add to server/package.json scripts:
# "dev": "nodemon server.js"

# 4. Set up frontend
cd ../client
npm create vite@latest . -- --template react
npm install axios react-router-dom socket.io-client

# 5. Fill in both .env files (see above)

# 6. Go back to root and run everything
cd ..
npm run dev
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `Cannot connect to MongoDB` | Wrong MONGO_URI in .env | Check Atlas cluster URL and whitelist your IP |
| `CORS error in browser` | CLIENT_URL in server .env is wrong | Make sure it matches exact frontend URL |
| `Socket not connecting` | VITE_SOCKET_URL is wrong | Should be `http://localhost:5000` not the API path |
| `profileComplete never true` | saveUserProfile not updating it | Make sure controller sets `profileComplete: true` |
| `Matches always empty` | Mentor has no skills set | Complete mentor profile setup first |
| `Video not loading` | roomUrl is null | Session must be confirmed before roomUrl is generated |

---

## Security Status

```
⚠ NO SECURITY LAYER ACTIVE RIGHT NOW

authMiddleware  → passes all requests through (next() only)
roleMiddleware  → passes all requests through (next() only)
JWT             → generated but NOT verified on protected routes yet
Passwords       → hashed by bcrypt in User model pre-save hook (this is on)

Security will be added only when explicitly asked.
Do not add any auth guards or rate limiting on your own.
```